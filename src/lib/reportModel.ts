import type {
  Contribution,
  InvestmentProject,
  MemberRecord,
  MembershipStatus,
  ProjectExitSummary,
} from "../types";
import {
  DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT,
  DEFAULT_PROJECT_START_MONTH,
  getMonthlyPaymentCoverage,
} from "./investmentApi";
import { formatDisplayName, getContributionMemberName, monthKey, monthLabel, shortMonthLabel } from "./format";

/** Sentinel the report filters use for "no filter selected". */
export const REPORT_ALL = "all";

/**
 * Month columns are split into repeat-blocks so a long-running project still fits a portrait
 * sheet with the member column repeated. Six months keeps every amount legible on paper at
 * 7 pt; twelve would force the cells down to a squint.
 */
export const CALENDAR_MONTHS_PER_BLOCK = 6;

/* -------------------------------------------------------------------------- */
/* Domain predicates — the single source of truth for what a member/payment is */
/* -------------------------------------------------------------------------- */

export function isMemberAccount(member: MemberRecord) {
  return member.role !== "admin";
}

export function getEffectiveMembershipStatus(member: MemberRecord): MembershipStatus {
  if (member.role === "admin") return "left";
  return member.membership?.status ?? "left";
}

export function isActiveMemberAccount(member: MemberRecord) {
  return isMemberAccount(member) && getEffectiveMembershipStatus(member) === "active";
}

export function isContributionFromAdmin(contribution: Contribution) {
  return contribution.member?.role === "admin" || contribution.profiles?.role === "admin";
}

/** Only approved member payments ever reach a statement; admin top-ups and unapproved rows never do. */
export function isCountedContribution(contribution: Contribution) {
  return contribution.status === "approved" && !isContributionFromAdmin(contribution);
}

/**
 * Statements must foot. BDT is a whole-taka currency and every figure on the sheet is
 * rendered with zero decimals, so amounts are rounded to whole taka as they enter the
 * model — that keeps every subtotal, total and running total exactly equal to the sum
 * of the rows above it instead of drifting by a taka on rounding.
 */
export function toBdt(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

/* -------------------------------------------------------------------------- */
/* Month helpers                                                              */
/* -------------------------------------------------------------------------- */

function monthSerial(month: string) {
  const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
  if (!year || !monthNumber) return Number.NaN;
  return year * 12 + monthNumber - 1;
}

function monthFromSerial(serial: number) {
  const year = Math.floor(serial / 12);
  const month = serial % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRangeKeys(startMonth: string, endMonth: string) {
  const start = monthSerial(startMonth);
  const end = monthSerial(endMonth);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_unused, index) => monthFromSerial(start + index));
}

function chunk<T>(items: T[], size: number) {
  const blocks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    blocks.push(items.slice(index, index + size));
  }
  return blocks;
}

/** "January 2026 – September 2026", or the single month, or the whole period when empty. */
function describeRange(labels: string[], asOfMonth: string, periodStartMonth: string) {
  if (labels.length === 0) {
    return asOfMonth === periodStartMonth
      ? monthLabel(asOfMonth)
      : `${monthLabel(periodStartMonth)} \u2013 ${monthLabel(asOfMonth)}`;
  }
  if (labels.length === 1) return labels[0];
  return `${labels[0]} \u2013 ${labels[labels.length - 1]}`;
}

/* -------------------------------------------------------------------------- */
/* Model types                                                                */
/* -------------------------------------------------------------------------- */

export type ReportScope = {
  /** "all" or a "YYYY-MM" month. */
  month: string;
  /** "all" or a member id. */
  memberId: string;
};

export type ReportInput = {
  contributions: Contribution[];
  members: MemberRecord[];
  project: InvestmentProject | null;
  exitSummary: ProjectExitSummary;
  scope: ReportScope;
  generatedAt?: Date;
  /** Injectable clock so the model stays deterministic in tests. */
  todayMonth?: string;
};

export type ReportMasthead = {
  projectName: string;
  targetAmountBdt: number;
  monthlyContributionBdt: number;
  /** "all", or the member id the statement is narrowed to. */
  memberFilterId: string;
  memberFilterLabel: string;
  /** null when every month is in scope, otherwise the single "YYYY-MM" selected. */
  monthFilterKey: string | null;
  monthFilterLabel: string;
  asOfMonth: string;
  asOfLabel: string;
  periodStartMonth: string;
  periodStartLabel: string;
  calendarStartMonth: string;
  ledgerRangeLabel: string;
  generatedAt: Date;
};

export type ReportFund = {
  approvedBdt: number;
  refundsPaidBdt: number;
  refundsReservedBdt: number;
  availableBdt: number;
};

export type ReportRosterRow = {
  memberId: string;
  memberName: string;
  memberCode: string | null;
  joinedAt: string | null;
  requiredToDateBdt: number;
  paidToDateBdt: number;
  /** Only populated when the report is filtered to a single month. */
  paidInScopeMonthBdt: number | null;
  remainingDueBdt: number;
  overdueMonths: number;
  advanceMonths: number;
  creditBdt: number;
  paidThroughMonth: string | null;
  paidThroughLabel: string | null;
  lastPaymentDate: string | null;
  coveragePercent: number;
  paid: boolean;
};

export type ReportRoster = {
  rows: ReportRosterRow[];
  totals: {
    requiredToDateBdt: number;
    paidToDateBdt: number;
    remainingDueBdt: number;
    paidInScopeMonthBdt: number;
    overdueCount: number;
    paidCount: number;
  };
  monthlyContributionBdt: number;
};

export type ReportCalendarMonth = {
  key: string;
  label: string;
  shortLabel: string;
  isScopeMonth: boolean;
};

export type ReportCalendarCell = {
  monthKey: string;
  amountBdt: number;
  paymentCount: number;
};

export type ReportCalendarRow = {
  memberId: string;
  memberName: string;
  cells: ReportCalendarCell[];
  paidMonths: number;
  totalBdt: number;
};

export type ReportCalendarBlock = {
  months: ReportCalendarMonth[];
  rows: ReportCalendarRow[];
  monthTotalsBdt: number[];
  totalBdt: number;
};

export type ReportCalendar = {
  blocks: ReportCalendarBlock[];
  months: ReportCalendarMonth[];
  totalBdt: number;
  monthCount: number;
};

export type ReportLedgerEntry = {
  id: string;
  paymentDate: string;
  memberName: string;
  memberCode: string | null;
  amountBdt: number;
  method: string | null;
  sentFromCountry: string | null;
  sourceCurrency: string | null;
  sourceAmount: number | null;
  exchangeRate: number | null;
  notes: string | null;
  hasReceipt: boolean;
  runningTotalBdt: number;
};

export type ReportLedgerGroup = {
  monthKey: string;
  label: string;
  entries: ReportLedgerEntry[];
  subtotalBdt: number;
  cumulativeBdt: number;
};

export type ReportLedger = {
  groups: ReportLedgerGroup[];
  totals: {
    totalBdt: number;
    entryCount: number;
    receiptBackedCount: number;
    memberCount: number;
  };
};

/**
 * The numbers a statement needs to explain itself. `unlisted*` is what the roster cannot
 * show because it only lists currently active members — a member who has since left still
 * holds money in the fund, and the sheet has to say so rather than silently not foot.
 */
export type ReportReconciliation = {
  fundApprovedBdt: number;
  rosterTotalBdt: number;
  ledgerTotalBdt: number;
  unfilteredLedgerTotalBdt: number;
  unlistedMemberCount: number;
  unlistedTotalBdt: number;
  scopeIsComplete: boolean;
  ledgerReconcilesToFund: boolean;
};

export type ReportModel = {
  masthead: ReportMasthead;
  fund: ReportFund;
  roster: ReportRoster;
  calendar: ReportCalendar;
  ledger: ReportLedger;
  reconciliation: ReportReconciliation;
};

/* -------------------------------------------------------------------------- */
/* Builder                                                                    */
/* -------------------------------------------------------------------------- */

type ContributionMeta = {
  contribution: Contribution;
  memberId: string;
  memberName: string;
  amountBdt: number;
  month: string;
};

function describeContribution(contribution: Contribution): ContributionMeta {
  return {
    contribution,
    memberId: contribution.member_id,
    memberName: getContributionMemberName(contribution),
    amountBdt: toBdt(contribution.bdt_amount),
    month: monthKey(contribution.payment_date),
  };
}

export function buildReportModel(input: ReportInput): ReportModel {
  const { contributions, members, project, exitSummary, scope } = input;
  const generatedAt = input.generatedAt ?? new Date();

  const monthlyContributionBdt = Math.max(
    1,
    Number(project?.monthly_contribution_bdt ?? DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT),
  );
  const periodStartMonth = project?.contribution_start_month?.slice(0, 7) || DEFAULT_PROJECT_START_MONTH;
  const projectName = project?.name?.trim() || "Home Investment";

  /* ---- every counted payment, before any sheet filter is applied ---- */
  const counted = contributions.filter(isCountedContribution).map(describeContribution);
  const fundApprovedBdt = counted.reduce((sum, entry) => sum + entry.amountBdt, 0);

  /* ---- the roster: active member accounts, never admins, never left members ---- */
  const rosterMembers = members
    .filter(isActiveMemberAccount)
    .filter((member) => scope.memberId === REPORT_ALL || member.id === scope.memberId)
    .map((member) => ({
      member,
      memberId: member.id,
      memberName: formatDisplayName(member.full_name) || member.email || "Member",
      memberCode: member.membership?.member_code ?? null,
      joinedAt: member.membership?.joined_at ?? null,
    }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));

  const rosterIds = new Set(rosterMembers.map((row) => row.memberId));

  /* ---- the as-of month anchors the roster, the calendar and the coverage maths ---- */
  const memberScoped = counted.filter((entry) => scope.memberId === REPORT_ALL || entry.memberId === scope.memberId);
  const monthFilter = scope.month === REPORT_ALL ? null : scope.month;
  const todayMonth = input.todayMonth ?? currentMonthKey(generatedAt);
  // A selected month is the statement date; only an unfiltered report may run on to the
  // latest month that has data, so a month in the past never reports later payments.
  const latestScopeMonth = monthFilter === null
    ? memberScoped.reduce<string | null>(
        (latest, entry) => (latest === null || entry.month > latest ? entry.month : latest),
        null,
      )
    : null;

  let asOfMonth = monthFilter ?? todayMonth;
  if (latestScopeMonth && latestScopeMonth > asOfMonth) asOfMonth = latestScopeMonth;
  if (monthSerial(asOfMonth) < monthSerial(periodStartMonth)) asOfMonth = periodStartMonth;

  /* ---- sheet 1 · member accounts ---- */
  const contributionsByMember = new Map<string, ContributionMeta[]>();
  counted.forEach((entry) => {
    const bucket = contributionsByMember.get(entry.memberId);
    if (bucket) bucket.push(entry);
    else contributionsByMember.set(entry.memberId, [entry]);
  });

  const rosterRows: ReportRosterRow[] = rosterMembers.map((row) => {
    const allEntries = contributionsByMember.get(row.memberId) ?? [];
    // An "as of September" account must not count October's payment, or the sheet
    // claims a balance the member had not yet settled on the date it names.
    const entriesToDate = allEntries.filter((entry) => entry.month <= asOfMonth);
    const paidToDateBdt = entriesToDate.reduce((sum, entry) => sum + entry.amountBdt, 0);
    const coverage = getMonthlyPaymentCoverage(
      paidToDateBdt,
      asOfMonth,
      monthlyContributionBdt,
      periodStartMonth,
    );
    const lastEntry = entriesToDate.reduce<ContributionMeta | null>(
      (latest, entry) =>
        latest === null || entry.contribution.payment_date > latest.contribution.payment_date ? entry : latest,
      null,
    );

    return {
      memberId: row.memberId,
      memberName: row.memberName,
      memberCode: row.memberCode,
      joinedAt: row.joinedAt,
      requiredToDateBdt: coverage.dueMonths * monthlyContributionBdt,
      paidToDateBdt,
      paidInScopeMonthBdt: monthFilter === null
        ? null
        : allEntries
            .filter((entry) => entry.month === monthFilter)
            .reduce((sum, entry) => sum + entry.amountBdt, 0),
      remainingDueBdt: coverage.remainingDueBdt,
      overdueMonths: coverage.overdueMonths,
      advanceMonths: coverage.advanceMonths,
      creditBdt: coverage.creditBdt,
      paidThroughMonth: coverage.paidThroughMonth,
      paidThroughLabel: coverage.paidThroughMonth ? monthLabel(coverage.paidThroughMonth) : null,
      lastPaymentDate: lastEntry?.contribution.payment_date ?? null,
      coveragePercent: coverage.coveragePercent,
      paid: coverage.paid,
    };
  });

  // Unpaid first, worst shortfall at the top: the sheet should open on who is behind.
  rosterRows.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    if (!a.paid && a.remainingDueBdt !== b.remainingDueBdt) return b.remainingDueBdt - a.remainingDueBdt;
    return a.memberName.localeCompare(b.memberName);
  });

  const rosterTotals = rosterRows.reduce(
    (totals, row) => ({
      requiredToDateBdt: totals.requiredToDateBdt + row.requiredToDateBdt,
      paidToDateBdt: totals.paidToDateBdt + row.paidToDateBdt,
      remainingDueBdt: totals.remainingDueBdt + row.remainingDueBdt,
      paidInScopeMonthBdt: totals.paidInScopeMonthBdt + (row.paidInScopeMonthBdt ?? 0),
      overdueCount: totals.overdueCount + (row.paid ? 0 : 1),
      paidCount: totals.paidCount + (row.paid ? 1 : 0),
    }),
    {
      requiredToDateBdt: 0,
      paidToDateBdt: 0,
      remainingDueBdt: 0,
      paidInScopeMonthBdt: 0,
      overdueCount: 0,
      paidCount: 0,
    },
  );

  /* ---- sheet 2 · payment calendar ---- */
  const calendarMonthKeys = monthRangeKeys(periodStartMonth, asOfMonth);
  const calendarMonths: ReportCalendarMonth[] = calendarMonthKeys.map((key) => ({
    key,
    label: monthLabel(key),
    shortLabel: shortMonthLabel(key),
    isScopeMonth: key === monthFilter,
  }));

  const amountByMemberMonth = new Map<string, { amountBdt: number; paymentCount: number }>();
  counted.forEach((entry) => {
    if (!rosterIds.has(entry.memberId)) return;
    if (entry.month < periodStartMonth || entry.month > asOfMonth) return;
    const key = `${entry.memberId}|${entry.month}`;
    const cell = amountByMemberMonth.get(key) ?? { amountBdt: 0, paymentCount: 0 };
    cell.amountBdt += entry.amountBdt;
    cell.paymentCount += 1;
    amountByMemberMonth.set(key, cell);
  });

  const calendarBlocks: ReportCalendarBlock[] = chunk(calendarMonths, CALENDAR_MONTHS_PER_BLOCK).map((monthBlock) => {
    const rows: ReportCalendarRow[] = rosterRows.map((row) => {
      const cells = monthBlock.map((month) => {
        const cell = amountByMemberMonth.get(`${row.memberId}|${month.key}`);
        return {
          monthKey: month.key,
          amountBdt: cell?.amountBdt ?? 0,
          paymentCount: cell?.paymentCount ?? 0,
        };
      });
      return {
        memberId: row.memberId,
        memberName: row.memberName,
        cells,
        paidMonths: cells.filter((cell) => cell.amountBdt > 0).length,
        totalBdt: cells.reduce((sum, cell) => sum + cell.amountBdt, 0),
      };
    });

    return {
      months: monthBlock,
      rows,
      monthTotalsBdt: monthBlock.map((_month, index) =>
        rows.reduce((sum, row) => sum + row.cells[index].amountBdt, 0),
      ),
      totalBdt: rows.reduce((sum, row) => sum + row.totalBdt, 0),
    };
  });

  const calendarTotalBdt = calendarBlocks.reduce((sum, block) => sum + block.totalBdt, 0);
  const memberCodeById = new Map(rosterMembers.map((row) => [row.memberId, row.memberCode]));

  /* ---- sheet 3 · chronological ledger ---- */
  const ledgerMeta = memberScoped
    .filter((entry) => monthFilter === null || entry.month === monthFilter)
    .sort((a, b) => {
      const byDate = a.contribution.payment_date.localeCompare(b.contribution.payment_date);
      if (byDate !== 0) return byDate;
      return a.contribution.created_at.localeCompare(b.contribution.created_at);
    });

  let runningTotalBdt = 0;
  const ledgerGroups: ReportLedgerGroup[] = [];
  ledgerMeta.forEach((entry) => {
    runningTotalBdt += entry.amountBdt;
    let group = ledgerGroups[ledgerGroups.length - 1];
    if (!group || group.monthKey !== entry.month) {
      group = {
        monthKey: entry.month,
        label: monthLabel(entry.month),
        entries: [],
        subtotalBdt: 0,
        cumulativeBdt: runningTotalBdt,
      };
      ledgerGroups.push(group);
    }
    group.entries.push({
      id: entry.contribution.id,
      paymentDate: entry.contribution.payment_date,
      memberName: entry.memberName,
      memberCode: memberCodeById.get(entry.memberId) ?? null,
      amountBdt: entry.amountBdt,
      method: entry.contribution.payment_method,
      sentFromCountry: entry.contribution.sent_from_country,
      sourceCurrency: entry.contribution.source_currency,
      sourceAmount: entry.contribution.source_amount,
      exchangeRate: entry.contribution.exchange_rate,
      notes: entry.contribution.notes,
      hasReceipt: (entry.contribution.payment_receipts?.length ?? 0) > 0,
      runningTotalBdt,
    });
    group.subtotalBdt += entry.amountBdt;
    group.cumulativeBdt = runningTotalBdt;
  });

  const ledgerTotalBdt = ledgerGroups.reduce((sum, group) => sum + group.subtotalBdt, 0);
  const ledgerEntryCount = ledgerGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const ledgerReceiptBackedCount = ledgerGroups.reduce(
    (sum, group) => sum + group.entries.filter((entry) => entry.hasReceipt).length,
    0,
  );
  const ledgerMemberCount = new Set(
    ledgerGroups.flatMap((group) => group.entries.map((entry) => entry.memberName)),
  ).size;

  /* ---- reconciliation: what the sheets cannot show on their own ---- */
  const unlistedEntries = counted.filter((entry) => !rosterIds.has(entry.memberId));
  const scopeIsComplete = monthFilter === null && scope.memberId === REPORT_ALL;
  const selectedMember = members.find((member) => member.id === scope.memberId);

  return {
    masthead: {
      projectName,
      targetAmountBdt: toBdt(project?.target_amount_bdt),
      monthlyContributionBdt,
      memberFilterId: scope.memberId,
      memberFilterLabel:
        scope.memberId === REPORT_ALL
          ? "All members"
          : formatDisplayName(selectedMember?.full_name ?? "") || "Selected member",
      monthFilterKey: monthFilter,
      monthFilterLabel: monthFilter ? monthLabel(monthFilter) : "All months",
      asOfMonth,
      asOfLabel: monthLabel(asOfMonth),
      periodStartMonth,
      periodStartLabel: monthLabel(periodStartMonth),
      calendarStartMonth: calendarMonthKeys[0] ?? periodStartMonth,
      ledgerRangeLabel: describeRange(ledgerGroups.map((group) => group.label), asOfMonth, periodStartMonth),
      generatedAt,
    },
    fund: {
      approvedBdt: fundApprovedBdt,
      refundsPaidBdt: toBdt(exitSummary.refundsPaidBdt),
      refundsReservedBdt: toBdt(exitSummary.refundsReservedBdt),
      availableBdt: Math.max(
        0,
        fundApprovedBdt - toBdt(exitSummary.refundsPaidBdt) - toBdt(exitSummary.refundsReservedBdt),
      ),
    },
    roster: {
      rows: rosterRows,
      totals: rosterTotals,
      monthlyContributionBdt,
    },
    calendar: {
      blocks: calendarBlocks,
      months: calendarMonths,
      totalBdt: calendarTotalBdt,
      monthCount: calendarMonths.length,
    },
    ledger: {
      groups: ledgerGroups,
      totals: {
        totalBdt: ledgerTotalBdt,
        entryCount: ledgerEntryCount,
        receiptBackedCount: ledgerReceiptBackedCount,
        memberCount: ledgerMemberCount,
      },
    },
    reconciliation: {
      fundApprovedBdt,
      rosterTotalBdt: rosterTotals.paidToDateBdt,
      ledgerTotalBdt,
      unfilteredLedgerTotalBdt: fundApprovedBdt,
      unlistedMemberCount: new Set(unlistedEntries.map((entry) => entry.memberId)).size,
      unlistedTotalBdt: unlistedEntries.reduce((sum, entry) => sum + entry.amountBdt, 0),
      scopeIsComplete,
      ledgerReconcilesToFund: scopeIsComplete && ledgerTotalBdt === fundApprovedBdt,
    },
  };
}
