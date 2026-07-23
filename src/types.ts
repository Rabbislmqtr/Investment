export type ProfileRole = "member" | "admin" | "viewer";
export type ContributionStatus = "pending" | "approved" | "rejected";
export type MembershipStatus = "active" | "paused" | "left";
export type ProjectStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type MemberExitStatus = "requested" | "settlement_approved" | "refund_pending" | "completed" | "rejected" | "cancelled";

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  resident_country: string | null;
  role: ProfileRole;
};

export type InvestmentProject = {
  id: string;
  name: string;
  description: string | null;
  target_amount_bdt: number;
  currency_code: string;
  is_active: boolean;
  status: ProjectStatus;
  planned_member_count: number;
  monthly_contribution_bdt: number;
  contribution_start_month: string;
  created_at: string;
};

export type GroupMember = {
  id: string;
  project_id: string;
  user_id: string;
  member_code: string | null;
  joined_at: string;
  status: MembershipStatus;
  left_at: string | null;
  exit_request_id: string | null;
};

export type MemberRecord = Profile & {
  membership: GroupMember | null;
};

export type MemberPaymentStatus = {
  memberId: string;
  memberName: string;
  email: string | null;
  memberCode: string | null;
  joinedAt: string | null;
  membershipStatus: MembershipStatus;
  paid: boolean;
  approvedTotalBdt: number;
  paymentCount: number;
  dueMonths: number;
  paidMonths: number;
  overdueMonths: number;
  advanceMonths: number;
  creditBdt: number;
  remainingDueBdt: number;
  coveragePercent: number;
  paidThroughMonth: string | null;
  lastPaymentDate: string | null;
  lastPaymentMethod: string | null;
  receiptFileName: string | null;
  receiptStoragePath: string | null;
};

export type Contribution = {
  id: string;
  project_id: string;
  member_id: string;
  payment_date: string;
  bdt_amount: number;
  source_currency: string | null;
  source_amount: number | null;
  exchange_rate: number | null;
  sent_from_country: string | null;
  payment_method: string | null;
  notes: string | null;
  status: ContributionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  member?: Pick<Profile, "full_name" | "email" | "role"> | null;
  profiles?: Pick<Profile, "full_name" | "email" | "role"> | null;
  payment_receipts?: PaymentReceipt[];
};

export type PaymentReceipt = {
  id: string;
  contribution_id: string;
  uploaded_by: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
};

export type MemberRefund = {
  id: string;
  exit_request_id: string;
  project_id: string;
  member_id: string;
  amount_bdt: number;
  payment_date: string;
  payment_method: string;
  payment_reference: string | null;
  notes: string | null;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  paid_by: string;
  created_at: string;
};

export type MemberExitRequest = {
  id: string;
  project_id: string;
  member_id: string;
  preferred_exit_date: string | null;
  effective_exit_date: string | null;
  reason: string;
  status: MemberExitStatus;
  approved_contributions_bdt: number;
  allocated_profit_bdt: number;
  allocated_loss_bdt: number;
  deductions_bdt: number;
  exit_fee_bdt: number;
  settlement_amount_bdt: number;
  refund_due_date: string | null;
  member_notes: string | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  member?: Pick<Profile, "full_name" | "email"> | null;
  member_refunds?: MemberRefund[];
};

export type ProjectExitSummary = {
  refundsPaidBdt: number;
  refundsReservedBdt: number;
};

export type DashboardTotals = {
  approved: number;
  pending: number;
  rejected: number;
  totalCount: number;
};
