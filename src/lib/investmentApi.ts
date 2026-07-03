import type {
  Contribution,
  DashboardTotals,
  InvestmentProject,
  MemberPaymentStatus,
  MemberRecord,
  MembershipStatus,
  PaymentReceipt,
  Profile,
  ProfileRole,
} from "../types";
import { supabase } from "./supabase";

const RECEIPT_BUCKET = "payment-receipts";

export async function getCurrentProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, resident_country, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateProfile(profile: Pick<Profile, "id" | "full_name" | "phone" | "resident_country">) {
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: profile.full_name,
      phone: profile.phone,
      resident_country: profile.resident_country,
    })
    .eq("id", profile.id)
    .select("id")
    .single();

  if (error) throw error;
}

export async function getActiveProject(): Promise<InvestmentProject | null> {
  const { data, error } = await supabase
    .from("investment_projects")
    .select("id, name, description, target_amount_bdt, currency_code, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateProjectSettings(input: {
  id: string;
  name: string;
  description: string | null;
  targetAmountBdt: number;
}) {
  const { error } = await supabase
    .from("investment_projects")
    .update({
      name: input.name,
      description: input.description,
      target_amount_bdt: input.targetAmountBdt,
    })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error) throw error;
}

export async function getAdminMembers(projectId: string): Promise<MemberRecord[]> {
  const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, phone, resident_country, role")
      .order("full_name", { ascending: true }),
    supabase
      .from("group_members")
      .select("id, project_id, user_id, member_code, joined_at, status")
      .eq("project_id", projectId),
  ]);

  if (profilesError) throw profilesError;
  if (membershipsError) throw membershipsError;

  const membershipByUser = new Map((memberships ?? []).map((membership) => [membership.user_id, membership]));

  return (profiles ?? []).map((profile) => ({
    ...profile,
    membership: membershipByUser.get(profile.id) ?? null,
  })) as MemberRecord[];
}

export async function updateMemberRecord(input: {
  projectId: string;
  userId: string;
  fullName: string;
  phone: string | null;
  residentCountry: string | null;
  role: ProfileRole;
  memberCode: string | null;
  joinedAt: string;
  status: MembershipStatus;
}) {
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone,
      resident_country: input.residentCountry,
      role: input.role,
    })
    .eq("id", input.userId)
    .select("id")
    .single();

  if (profileError) throw profileError;

  if (input.role === "admin") {
    const { error: membershipDeleteError } = await supabase
      .from("group_members")
      .delete()
      .eq("project_id", input.projectId)
      .eq("user_id", input.userId);

    if (membershipDeleteError) throw membershipDeleteError;
    return;
  }

  const { error: membershipError } = await supabase
    .from("group_members")
    .upsert(
      {
        project_id: input.projectId,
        user_id: input.userId,
        member_code: input.memberCode,
        joined_at: input.joinedAt,
        status: input.status,
      },
      { onConflict: "project_id,user_id" },
    )
    .select("id")
    .single();

  if (membershipError) throw membershipError;
}

export async function getMemberContributions(memberId: string): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select(
      "*, payment_receipts(id, contribution_id, uploaded_by, storage_bucket, storage_path, file_name, file_type, file_size, created_at)",
    )
    .eq("member_id", memberId)
    .order("payment_date", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getProjectApprovedContributions(projectId: string): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select(
      "id, project_id, member_id, payment_date, bdt_amount, source_currency, source_amount, exchange_rate, sent_from_country, payment_method, notes, status, reviewed_by, reviewed_at, rejection_reason, created_at",
    )
    .eq("project_id", projectId)
    .eq("status", "approved")
    .order("payment_date", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Contribution[];
}

export async function getMemberPaymentStatus(
  projectId: string,
  month: string,
  options: { includeFinancialDetails?: boolean } = {},
): Promise<MemberPaymentStatus[]> {
  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStart = nextMonth.toISOString().slice(0, 10);

  const { data: memberships, error: membershipsError } = await supabase
    .from("group_members")
    .select("id, project_id, user_id, member_code, joined_at, status")
    .eq("project_id", projectId)
    .neq("status", "left")
    .order("member_code", { ascending: true });

  if (membershipsError) throw membershipsError;

  const memberIds = (memberships ?? []).map((membership) => membership.user_id);
  if (memberIds.length === 0) return [];

  const contributionQuery = options.includeFinancialDetails
    ? supabase
        .from("contributions")
        .select("id, member_id, payment_date, bdt_amount, payment_method, payment_receipts(file_name, storage_path)")
        .eq("project_id", projectId)
        .eq("status", "approved")
        .gte("payment_date", monthStart)
        .lt("payment_date", nextMonthStart)
    : supabase
        .from("contributions")
        .select("id, member_id, payment_date")
        .eq("project_id", projectId)
        .eq("status", "approved")
        .gte("payment_date", monthStart)
        .lt("payment_date", nextMonthStart);

  const [{ data: profiles, error: profilesError }, contributionResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, phone, resident_country, role")
      .in("id", memberIds),
    contributionQuery,
  ]);

  if (profilesError) throw profilesError;
  if (contributionResult.error) throw contributionResult.error;

  type StatusContribution = {
    id: string;
    member_id: string;
    payment_date: string;
    bdt_amount?: number | null;
    payment_method?: string | null;
    payment_receipts?: Array<{ file_name: string | null; storage_path: string | null }> | null;
  };

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const contributionsByMember = new Map<string, StatusContribution[]>();
  const statusContributions = (contributionResult.data ?? []) as unknown as StatusContribution[];

  statusContributions.forEach((contribution) => {
    const entries = contributionsByMember.get(contribution.member_id) ?? [];
    entries.push(contribution);
    contributionsByMember.set(contribution.member_id, entries);
  });

  return (memberships ?? [])
    .map((membership) => {
      const profile = profileById.get(membership.user_id);
      const memberContributions = contributionsByMember.get(membership.user_id) ?? [];
      const sortedContributions = memberContributions
        .slice()
        .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
      const approvedTotalBdt = options.includeFinancialDetails
        ? memberContributions.reduce((sum, contribution) => sum + Number(contribution.bdt_amount ?? 0), 0)
        : 0;
      const lastContribution = sortedContributions[0];
      const receipt = options.includeFinancialDetails ? lastContribution?.payment_receipts?.[0] : null;

      return {
        memberId: membership.user_id,
        memberName: profile?.full_name || profile?.email || "Member",
        email: profile?.email ?? null,
        memberCode: membership.member_code,
        membershipStatus: membership.status,
        paid: memberContributions.length > 0,
        approvedTotalBdt,
        paymentCount: memberContributions.length,
        lastPaymentDate: lastContribution?.payment_date ?? null,
        lastPaymentMethod: lastContribution?.payment_method ?? null,
        receiptFileName: receipt?.file_name ?? null,
        receiptStoragePath: receipt?.storage_path ?? null,
      };
    })
    .sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? -1 : 1;
      return a.memberName.localeCompare(b.memberName);
    });
}

export async function getAdminContributions(): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select(
      "*, member:profiles!contributions_member_id_fkey(full_name, email, role), payment_receipts(id, contribution_id, uploaded_by, storage_bucket, storage_path, file_name, file_type, file_size, created_at)",
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Contribution[];
}

export async function getSignedReceiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}

export async function submitContribution(input: {
  projectId: string;
  memberId: string;
  paymentDate: string;
  bdtAmount: number;
  sourceCurrency?: string;
  sourceAmount?: number;
  exchangeRate?: number;
  sentFromCountry?: string;
  paymentMethod?: string;
  notes?: string;
  receipt: File;
}) {
  const ext = input.receipt.name.split(".").pop()?.toLowerCase() ?? "file";
  const filePath = `${input.memberId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(filePath, input.receipt, {
    cacheControl: "3600",
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { data: contribution, error: contributionError } = await supabase
    .from("contributions")
    .insert({
      project_id: input.projectId,
      member_id: input.memberId,
      payment_date: input.paymentDate,
      bdt_amount: input.bdtAmount,
      source_currency: input.sourceCurrency || null,
      source_amount: input.sourceAmount || null,
      exchange_rate: input.exchangeRate || null,
      sent_from_country: input.sentFromCountry || null,
      payment_method: input.paymentMethod || null,
      notes: input.notes || null,
      status: "pending",
    })
    .select("id")
    .single();

  if (contributionError) throw contributionError;

  const receipt: Omit<PaymentReceipt, "id" | "created_at"> = {
    contribution_id: contribution.id,
    uploaded_by: input.memberId,
    storage_bucket: RECEIPT_BUCKET,
    storage_path: filePath,
    file_name: input.receipt.name,
    file_type: input.receipt.type,
    file_size: input.receipt.size,
  };

  const { error: receiptError } = await supabase.from("payment_receipts").insert(receipt);
  if (receiptError) throw receiptError;
}

export async function reviewContribution(input: {
  contributionId: string;
  reviewerId: string;
  projectId: string;
  status: "approved" | "rejected";
  rejectionReason?: string;
}) {
  const { error } = await supabase
    .from("contributions")
    .update({
      status: input.status,
      reviewed_by: input.reviewerId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: input.status === "rejected" ? input.rejectionReason || "Not approved" : null,
    })
    .eq("id", input.contributionId);

  if (error) throw error;

  await supabase.from("audit_logs").insert({
    actor_id: input.reviewerId,
    project_id: input.projectId,
    contribution_id: input.contributionId,
    action: `contribution_${input.status}`,
    details: { rejectionReason: input.rejectionReason || null },
  });
}

export function calculateTotals(contributions: Contribution[]): DashboardTotals {
  return contributions.reduce<DashboardTotals>(
    (totals, contribution) => {
      if (contribution.status === "approved") totals.approved += Number(contribution.bdt_amount);
      if (contribution.status === "pending") totals.pending += Number(contribution.bdt_amount);
      if (contribution.status === "rejected") totals.rejected += Number(contribution.bdt_amount);
      totals.totalCount += 1;
      return totals;
    },
    { approved: 0, pending: 0, rejected: 0, totalCount: 0 },
  );
}
