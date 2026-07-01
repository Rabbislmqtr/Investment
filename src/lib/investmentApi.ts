import type { Contribution, DashboardTotals, InvestmentProject, PaymentReceipt, Profile } from "../types";
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

export async function getAdminContributions(): Promise<Contribution[]> {
  const { data, error } = await supabase
    .from("contributions")
    .select(
      "*, member:profiles!contributions_member_id_fkey(full_name, email), payment_receipts(id, contribution_id, uploaded_by, storage_bucket, storage_path, file_name, file_type, file_size, created_at)",
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
