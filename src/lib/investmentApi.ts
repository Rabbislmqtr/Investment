import type {
  Contribution,
  DashboardTotals,
  InvestmentProject,
  MemberPaymentStatus,
  MemberRecord,
  MembershipStatus,
  Profile,
  ProfileRole,
} from "../types";
import { supabase } from "./supabase";

const RECEIPT_BUCKET = "payment-receipts";
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const PROJECT_START_MONTH = "2026-01";
export const MONTHLY_MEMBER_CONTRIBUTION_BDT = 10000;
export const BASE_TARGET_MEMBER_COUNT = 10;

function monthSerial(month: string) {
  const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
  return year * 12 + monthNumber - 1;
}

function monthFromSerial(serial: number) {
  const year = Math.floor(serial / 12);
  const month = serial % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function getScaledProjectTarget(baseTargetBdt: number, activeMemberCount: number) {
  if (baseTargetBdt <= 0) return 0;
  if (activeMemberCount <= BASE_TARGET_MEMBER_COUNT) return baseTargetBdt;
  const baseTargetPerMember = baseTargetBdt / BASE_TARGET_MEMBER_COUNT;
  return Math.round(baseTargetPerMember * activeMemberCount);
}

export function getMonthlyPaymentCoverage(totalApprovedBdt: number, selectedMonth: string) {
  const startSerial = monthSerial(PROJECT_START_MONTH);
  const selectedSerial = monthSerial(selectedMonth);
  const dueMonths = Math.max(0, selectedSerial - startSerial + 1);
  const paidMonths = Math.floor(Math.max(0, totalApprovedBdt) / MONTHLY_MEMBER_CONTRIBUTION_BDT);
  const paidThroughMonth = paidMonths > 0 ? monthFromSerial(startSerial + paidMonths - 1) : null;
  const requiredBySelectedMonth = dueMonths * MONTHLY_MEMBER_CONTRIBUTION_BDT;
  const remainingDueBdt = Math.max(0, requiredBySelectedMonth - totalApprovedBdt);
  const coveragePercent = requiredBySelectedMonth > 0
    ? Math.min(100, (totalApprovedBdt / requiredBySelectedMonth) * 100)
    : 100;

  return {
    paid: paidMonths >= dueMonths,
    dueMonths,
    paidMonths,
    overdueMonths: Math.max(0, dueMonths - paidMonths),
    advanceMonths: Math.max(0, paidMonths - dueMonths),
    creditBdt: Math.max(0, totalApprovedBdt % MONTHLY_MEMBER_CONTRIBUTION_BDT),
    remainingDueBdt,
    coveragePercent,
    paidThroughMonth,
  };
}

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

export async function getProjectMemberCount(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .neq("status", "left");

  if (error) throw error;
  return count ?? 0;
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
  const { error } = await supabase.rpc("admin_update_member_record", {
    p_project_id: input.projectId,
    p_user_id: input.userId,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_resident_country: input.residentCountry,
    p_role: input.role,
    p_member_code: input.memberCode,
    p_joined_at: input.joinedAt,
    p_status: input.status,
  });

  if (error) throw error;
}

export async function getMemberContributions(memberId: string, projectId: string): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select(
      "*, payment_receipts(id, contribution_id, uploaded_by, storage_bucket, storage_path, file_name, file_type, file_size, created_at)",
    )
    .eq("member_id", memberId)
    .eq("project_id", projectId)
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
    : supabase
        .from("contributions")
        .select("id, member_id, payment_date, bdt_amount, payment_method")
        .eq("project_id", projectId)
        .eq("status", "approved");

  const [{ data: directory, error: directoryError }, contributionResult] = await Promise.all([
    supabase.rpc("get_project_member_directory", { target_project_id: projectId }),
    contributionQuery,
  ]);

  if (directoryError) throw directoryError;
  if (contributionResult.error) throw contributionResult.error;

  type StatusContribution = {
    id: string;
    member_id: string;
    payment_date: string;
    bdt_amount: number | null;
    payment_method?: string | null;
    payment_receipts?: Array<{ file_name: string | null; storage_path: string | null }> | null;
  };

  type MemberDirectoryRow = { id: string; full_name: string };
  const directoryRows = (directory ?? []) as MemberDirectoryRow[];
  const profileById = new Map(directoryRows.map((profile) => [profile.id, profile]));
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
      const approvedTotalBdt = memberContributions.reduce((sum, contribution) => sum + Number(contribution.bdt_amount ?? 0), 0);
      const coverage = getMonthlyPaymentCoverage(approvedTotalBdt, month);
      const lastContribution = sortedContributions[0];
      const receipt = options.includeFinancialDetails ? lastContribution?.payment_receipts?.[0] : null;

      return {
        memberId: membership.user_id,
        memberName: profile?.full_name || "Member",
        email: null,
        memberCode: membership.member_code,
        membershipStatus: membership.status,
        paid: coverage.paid,
        approvedTotalBdt,
        paymentCount: memberContributions.length,
        dueMonths: coverage.dueMonths,
        paidMonths: coverage.paidMonths,
        overdueMonths: coverage.overdueMonths,
        advanceMonths: coverage.advanceMonths,
        creditBdt: coverage.creditBdt,
        remainingDueBdt: coverage.remainingDueBdt,
        coveragePercent: coverage.coveragePercent,
        paidThroughMonth: coverage.paidThroughMonth,
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

export async function getAdminContributions(projectId: string): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select(
      "*, member:profiles!contributions_member_id_fkey(full_name, email, role), payment_receipts(id, contribution_id, uploaded_by, storage_bucket, storage_path, file_name, file_type, file_size, created_at)",
    )
    .eq("project_id", projectId)
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
  if (input.receipt.size > MAX_RECEIPT_BYTES) {
    throw new Error("Receipt must be 10 MB or smaller.");
  }
  const ext = input.receipt.name.split(".").pop()?.toLowerCase() ?? "file";
  const filePath = `${input.memberId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(filePath, input.receipt, {
    cacheControl: "3600",
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { error: contributionError } = await supabase.rpc("create_pending_contribution_with_receipt", {
    p_project_id: input.projectId,
    p_payment_date: input.paymentDate,
    p_bdt_amount: input.bdtAmount,
    p_source_currency: input.sourceCurrency || null,
    p_source_amount: input.sourceAmount ?? null,
    p_exchange_rate: input.exchangeRate ?? null,
    p_sent_from_country: input.sentFromCountry || null,
    p_payment_method: input.paymentMethod || null,
    p_notes: input.notes || null,
    p_storage_bucket: RECEIPT_BUCKET,
    p_storage_path: filePath,
    p_file_name: input.receipt.name,
    p_file_type: input.receipt.type,
    p_file_size: input.receipt.size,
  });

  if (contributionError) {
    if (contributionError.code) await supabase.storage.from(RECEIPT_BUCKET).remove([filePath]);
    throw contributionError;
  }
}

async function getAdminSessionToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Admin session is required.");
  return token;
}

async function postAdminFunction<T>(path: string, body: unknown): Promise<T> {
  const token = await getAdminSessionToken();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Admin action failed.");
  }

  return result as T;
}

export async function createAdminMember(input: {
  projectId: string;
  fullName: string;
  email: string;
  password: string;
  phone?: string | null;
  residentCountry?: string | null;
  memberCode?: string | null;
  joinedAt: string;
  status: MembershipStatus;
}) {
  return postAdminFunction<{ memberId: string }>("/.netlify/functions/admin-create-member", input);
}

export async function submitAdminApprovedContribution(input: {
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
  if (input.receipt.size > MAX_RECEIPT_BYTES) {
    throw new Error("Receipt must be 10 MB or smaller.");
  }
  const extension = input.receipt.name.split(".").pop()?.toLowerCase() || "file";
  const storagePath = `${input.memberId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(storagePath, input.receipt, {
    contentType: input.receipt.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;

  return postAdminFunction<{ contributionId: string }>("/.netlify/functions/admin-submit-member-payment", {
    ...input,
    receipt: undefined,
    storagePath,
    fileSize: input.receipt.size,
    fileName: input.receipt.name,
    fileType: input.receipt.type,
  });
}

export async function reviewContribution(input: {
  contributionId: string;
  status: "approved" | "rejected";
  rejectionReason?: string;
}) {
  const { error } = await supabase.rpc("review_contribution", {
    p_contribution_id: input.contributionId,
    p_status: input.status,
    p_rejection_reason: input.rejectionReason ?? null,
  });

  if (error) throw error;
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
