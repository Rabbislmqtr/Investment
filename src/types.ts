export type ProfileRole = "member" | "admin" | "viewer";
export type ContributionStatus = "pending" | "approved" | "rejected";
export type MembershipStatus = "active" | "paused" | "left";

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
};

export type GroupMember = {
  id: string;
  project_id: string;
  user_id: string;
  member_code: string | null;
  joined_at: string;
  status: MembershipStatus;
};

export type MemberRecord = Profile & {
  membership: GroupMember | null;
};

export type MemberPaymentStatus = {
  memberId: string;
  memberName: string;
  email: string | null;
  memberCode: string | null;
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

export type DashboardTotals = {
  approved: number;
  pending: number;
  rejected: number;
  totalCount: number;
};
