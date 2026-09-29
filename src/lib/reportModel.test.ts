import { describe, expect, it } from "vitest";
import type { Contribution, InvestmentProject, MemberRecord, MembershipStatus, ProfileRole } from "../types";
import { DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT, getMonthlyPaymentCoverage } from "./investmentApi";
import { CALENDAR_MONTHS_PER_BLOCK, REPORT_ALL, buildReportModel, monthRangeKeys } from "./reportModel";

const PROJECT: InvestmentProject = {
  id: "project-1",
  name: "Home Investment",
  description: null,
  target_amount_bdt: 3_000_000,
  currency_code: "BDT",
  is_active: true,
  status: "active",
  planned_member_count: 10,
  monthly_contribution_bdt: DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT,
  contribution_start_month: "2026-01-01",
  created_at: "2026-01-01T00:00:00.000Z",
};

function member(
  id: string,
  fullName: string,
  options: { role?: ProfileRole; status?: MembershipStatus | null; memberCode?: string | null } = {},
): MemberRecord {
  const { role = "member", status = "active", memberCode = null } = options;
  return {
    id,
    full_name: fullName,
    email: `${id}@example.com`,
    phone: null,
    resident_country: null,
    role,
    membership:
      status === null
        ? null
        : {
            id: `membership-${id}`,
            project_id: PROJECT.id,
            user_id: id,
            member_code: memberCode,
            joined_at: "2026-01-01T00:00:00.000Z",
            status,
            left_at: null,
            exit_request_id: null,
          },
  };
}

let contributionSequence = 0;

function contribution(
  memberId: string,
  paymentDate: string,
  amountBdt: number,
  options: { status?: Contribution["status"]; role?: ProfileRole; memberName?: string; receipts?: number } = {},
): Contribution {
  const { status = "approved", role = "member", memberName = memberId, receipts = 0 } = options;
  contributionSequence += 1;
  return {
    id: `contribution-${contributionSequence}`,
    project_id: PROJECT.id,
    member_id: memberId,
    payment_date: paymentDate,
    bdt_amount: amountBdt,
    source_currency: null,
    source_amount: null,
    exchange_rate: null,
    sent_from_country: null,
    payment_method: "Bank transfer",
    notes: null,
    status,
    reviewed_by: null,
    reviewed_at: `${paymentDate}T10:00:00.000Z`,
    rejection_reason: null,
    created_at: `${paymentDate}T09:00:00.000Z`,
    member: { full_name: memberName, email: `${memberId}@example.com`, role },
    payment_receipts: Array.from({ length: receipts }, (_unused, index) => ({
      id: `receipt-${contributionSequence}-${index}`,
      contribution_id: `contribution-${contributionSequence}`,
      uploaded_by: memberId,
      storage_bucket: "payment-receipts",
      storage_path: `${memberId}/receipt-${index}.pdf`,
      file_name: `receipt-${index}.pdf`,
      file_type: "application/pdf",
      file_size: 1024,
      created_at: `${paymentDate}T09:00:00.000Z`,
    })),
  };
}

const EXIT_SUMMARY = { refundsPaidBdt: 0, refundsReservedBdt: 0 };

function build(input: {
  contributions: Contribution[];
  members: MemberRecord[];
  month?: string;
  memberId?: string;
  todayMonth?: string;
  exitSummary?: { refundsPaidBdt: number; refundsReservedBdt: number };
}) {
  return buildReportModel({
    contributions: input.contributions,
    members: input.members,
    project: PROJECT,
    exitSummary: input.exitSummary ?? EXIT_SUMMARY,
    scope: { month: input.month ?? REPORT_ALL, memberId: input.memberId ?? REPORT_ALL },
    generatedAt: new Date(2026, 8, 29, 14, 32),
    todayMonth: input.todayMonth ?? "2026-09",
  });
}

describe("monthRangeKeys", () => {
  it("enumerates every month inclusively", () => {
    expect(monthRangeKeys("2026-01", "2026-04")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("returns a single month when start and end match", () => {
    expect(monthRangeKeys("2026-03", "2026-03")).toEqual(["2026-03"]);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(monthRangeKeys("2026-06", "2026-01")).toEqual([]);
  });
});

describe("member accounts sheet", () => {
  it("lists a member who has paid nothing alongside members who have", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [contribution("a", "2026-07-05", 10_000)],
    });

    expect(model.roster.rows).toHaveLength(2);
    const unpaid = model.roster.rows.find((row) => row.memberId === "b");
    expect(unpaid?.paid).toBe(false);
    expect(unpaid?.paidToDateBdt).toBe(0);
    expect(unpaid?.overdueMonths).toBe(9);
    expect(unpaid?.requiredToDateBdt).toBe(9 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
    expect(unpaid?.remainingDueBdt).toBe(9 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
  });

  it("never lists admins, left members, or members with no membership record", () => {
    const model = build({
      members: [
        member("a", "Ada Rahman"),
        member("admin", "Group Admin", { role: "admin" }),
        member("left", "Former Member", { status: "left" }),
        member("paused", "Paused Member", { status: "paused" }),
        member("none", "Unassigned Member", { status: null }),
      ],
      contributions: [],
    });

    expect(model.roster.rows.map((row) => row.memberId)).toEqual(["a"]);
  });

  it("sorts unpaid members ahead of paid ones, worst shortfall first", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury"), member("c", "Chandra Das")],
      contributions: [
        contribution("a", "2026-01-05", 9 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT),
        contribution("b", "2026-01-05", 2 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT),
      ],
    });

    expect(model.roster.rows.map((row) => row.memberId)).toEqual(["c", "b", "a"]);
  });

  it("reuses getMonthlyPaymentCoverage for the balance, advance and credit figures", () => {
    const bulk = 9 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT;
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [
        contribution("a", "2026-01-05", bulk),
        contribution("b", "2026-01-05", 2 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT + 2_500),
      ],
    });

    const advance = model.roster.rows.find((row) => row.memberId === "a");
    const expectedAdvance = getMonthlyPaymentCoverage(bulk, "2026-09");
    expect(advance?.advanceMonths).toBe(expectedAdvance.advanceMonths);
    expect(advance?.paidThroughMonth).toBe(expectedAdvance.paidThroughMonth);
    expect(advance?.remainingDueBdt).toBe(0);

    const credit = model.roster.rows.find((row) => row.memberId === "b");
    const expectedCredit = getMonthlyPaymentCoverage(2 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT + 2_500, "2026-09");
    expect(credit?.creditBdt).toBe(expectedCredit.creditBdt);
    expect(credit?.remainingDueBdt).toBe(expectedCredit.remainingDueBdt);
  });

  it("totals every column so the footer foots to the rows above it", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury"), member("c", "Chandra Das")],
      contributions: [
        contribution("a", "2026-02-05", 30_000),
        contribution("b", "2026-03-05", 12_500.4),
        contribution("c", "2026-04-05", 7_499.6),
      ],
    });

    const { rows, totals } = model.roster;
    expect(totals.paidToDateBdt).toBe(rows.reduce((sum, row) => sum + row.paidToDateBdt, 0));
    expect(totals.requiredToDateBdt).toBe(rows.reduce((sum, row) => sum + row.requiredToDateBdt, 0));
    expect(totals.remainingDueBdt).toBe(rows.reduce((sum, row) => sum + row.remainingDueBdt, 0));
    expect(totals.paidCount + totals.overdueCount).toBe(rows.length);
    // Fractional taka would otherwise make the printed column stop adding up.
    expect(rows.every((row) => Number.isInteger(row.paidToDateBdt))).toBe(true);
  });

  it("adds the paid-in-month column only when a month is selected", () => {
    const contributions = [
      contribution("a", "2026-07-05", 10_000),
      contribution("a", "2026-08-05", 10_000),
    ];
    const unfiltered = build({ members: [member("a", "Ada Rahman")], contributions });
    expect(unfiltered.roster.rows[0].paidInScopeMonthBdt).toBeNull();

    const filtered = build({ members: [member("a", "Ada Rahman")], contributions, month: "2026-07" });
    expect(filtered.roster.rows[0].paidInScopeMonthBdt).toBe(10_000);
    expect(filtered.roster.totals.paidInScopeMonthBdt).toBe(10_000);
  });

  it("freezes the account at the as-of month instead of counting later payments", () => {
    const contributions = [
      contribution("a", "2026-07-05", 10_000),
      contribution("a", "2026-08-05", 10_000),
    ];
    const filtered = build({ members: [member("a", "Ada Rahman")], contributions, month: "2026-07" });
    expect(filtered.roster.rows[0].paidToDateBdt).toBe(10_000);

    const unfiltered = build({ members: [member("a", "Ada Rahman")], contributions });
    expect(unfiltered.roster.rows[0].paidToDateBdt).toBe(20_000);
  });
});

describe("payment calendar sheet", () => {
  it("places each member's payments in the right month column", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [
        contribution("a", "2026-02-05", 10_000),
        contribution("a", "2026-04-05", 10_000),
        contribution("b", "2026-04-09", 20_000),
      ],
    });

    const months = model.calendar.months.map((month) => month.key);
    expect(months).toEqual(monthRangeKeys("2026-01", "2026-09"));

    // January through June is the first block; July through September is the second.
    const [firstBlock, secondBlock] = model.calendar.blocks;
    expect(firstBlock.months.map((month) => month.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(secondBlock.months.map((month) => month.key)).toEqual(["2026-07", "2026-08", "2026-09"]);

    const ada = firstBlock.rows.find((row) => row.memberId === "a");
    const bilal = firstBlock.rows.find((row) => row.memberId === "b");
    expect(ada?.cells.map((cell) => cell.amountBdt)).toEqual([0, 10_000, 0, 10_000, 0, 0]);
    expect(ada?.paidMonths).toBe(2);
    expect(bilal?.cells[3].amountBdt).toBe(20_000);
    expect(bilal?.cells[3].paymentCount).toBe(1);
    expect(secondBlock.totalBdt).toBe(0);
  });

  it("carries month totals and a grand total that foots to the roster", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [
        contribution("a", "2026-02-05", 10_000),
        contribution("a", "2026-03-05", 5_000),
        contribution("b", "2026-03-05", 5_000),
      ],
    });

    const block = model.calendar.blocks[0];
    const marchIndex = block.months.findIndex((month) => month.key === "2026-03");
    expect(block.monthTotalsBdt[marchIndex]).toBe(10_000);
    expect(block.totalBdt).toBe(20_000);
    expect(model.calendar.totalBdt).toBe(model.roster.totals.paidToDateBdt);
  });

  it("bounds the final column by the selected month", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [contribution("a", "2026-02-05", 10_000)],
      month: "2026-04",
    });

    expect(model.calendar.months.map((month) => month.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(model.calendar.months.filter((month) => month.isScopeMonth).map((month) => month.key)).toEqual(["2026-04"]);
  });

  it("splits a long project into repeat-blocks that repeat the member column", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [contribution("a", "2026-02-05", 10_000)],
      todayMonth: "2028-06",
    });

    // January 2026 through June 2028 is thirty months, six to a block.
    expect(model.calendar.months).toHaveLength(30);
    expect(model.calendar.blocks).toHaveLength(5);
    expect(model.calendar.blocks[0].months).toHaveLength(CALENDAR_MONTHS_PER_BLOCK);
    expect(model.calendar.blocks[1].months[0].key).toBe("2026-07");
    expect(model.calendar.blocks.every((block) => block.rows.length === 1)).toBe(true);
    expect(model.calendar.totalBdt).toBe(10_000);
  });

  it("narrows to a single member when the report is filtered to one", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [
        contribution("a", "2026-02-05", 10_000, { memberName: "Ada Rahman" }),
        contribution("b", "2026-03-05", 10_000, { memberName: "Bilal Chowdhury" }),
      ],
      memberId: "b",
    });

    expect(model.roster.rows.map((row) => row.memberId)).toEqual(["b"]);
    expect(model.calendar.blocks[0].rows.map((row) => row.memberId)).toEqual(["b"]);
    expect(model.ledger.groups[0].entries.map((entry) => entry.memberName)).toEqual(["Bilal Chowdhury"]);
    expect(model.masthead.memberFilterLabel).toBe("Bilal Chowdhury");
  });
});

describe("ledger detail sheet", () => {
  it("orders months oldest first and carries a running total", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [
        contribution("a", "2026-03-05", 30_000),
        contribution("a", "2026-01-05", 10_000),
        contribution("a", "2026-02-05", 20_000),
      ],
    });

    expect(model.ledger.groups.map((group) => group.monthKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(model.ledger.groups.map((group) => group.subtotalBdt)).toEqual([10_000, 20_000, 30_000]);
    expect(model.ledger.groups.map((group) => group.cumulativeBdt)).toEqual([10_000, 30_000, 60_000]);
    expect(model.ledger.groups[2].entries[0].runningTotalBdt).toBe(60_000);
    expect(model.ledger.totals.totalBdt).toBe(60_000);
  });

  it("subtotals each month and foots to the same figure as the fund position", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [
        contribution("a", "2026-01-05", 10_000),
        contribution("b", "2026-01-20", 10_000),
        contribution("b", "2026-02-20", 10_000),
      ],
    });

    const groupTotals = model.ledger.groups.reduce((sum, group) => sum + group.subtotalBdt, 0);
    expect(groupTotals).toBe(model.ledger.totals.totalBdt);
    expect(model.ledger.totals.totalBdt).toBe(model.fund.approvedBdt);
    expect(model.reconciliation.ledgerReconcilesToFund).toBe(true);
  });

  it("counts entries, distinct members and receipt-backed rows", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [
        contribution("a", "2026-01-05", 10_000, { receipts: 2 }),
        contribution("a", "2026-02-05", 10_000),
        contribution("b", "2026-02-20", 10_000, { receipts: 1 }),
      ],
    });

    expect(model.ledger.totals.entryCount).toBe(3);
    expect(model.ledger.totals.memberCount).toBe(2);
    expect(model.ledger.totals.receiptBackedCount).toBe(2);
  });

  it("flattens the labels the sheet needs and keeps a single-month range honest", () => {
    const single = build({
      members: [member("a", "Ada Rahman")],
      contributions: [contribution("a", "2026-03-05", 10_000)],
      month: "2026-03",
    });
    expect(single.masthead.ledgerRangeLabel).toBe("March 2026");

    const multiple = build({
      members: [member("a", "Ada Rahman")],
      contributions: [contribution("a", "2026-02-05", 10_000), contribution("a", "2026-05-05", 10_000)],
    });
    expect(multiple.masthead.ledgerRangeLabel).toBe("February 2026 – May 2026");
  });

  it("never lists pending or rejected payments", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [
        contribution("a", "2026-01-05", 10_000, { status: "pending" }),
        contribution("a", "2026-02-05", 10_000, { status: "rejected" }),
        contribution("a", "2026-03-05", 10_000),
      ],
    });

    expect(model.ledger.totals.entryCount).toBe(1);
    expect(model.ledger.totals.totalBdt).toBe(10_000);
  });

  it("never counts payments the admin made themselves", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("admin", "Group Admin", { role: "admin" })],
      contributions: [
        contribution("a", "2026-01-05", 10_000),
        contribution("admin", "2026-01-05", 500_000, { role: "admin", memberName: "Group Admin" }),
      ],
    });

    expect(model.ledger.totals.totalBdt).toBe(10_000);
    expect(model.fund.approvedBdt).toBe(10_000);
    expect(model.roster.rows).toHaveLength(1);
  });
});

describe("fund position and reconciliation", () => {
  it("reports refunds, reserves and the available fund", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [contribution("a", "2026-01-05", 100_000)],
      exitSummary: { refundsPaidBdt: 30_000, refundsReservedBdt: 20_000 },
    });

    expect(model.fund).toEqual({
      approvedBdt: 100_000,
      refundsPaidBdt: 30_000,
      refundsReservedBdt: 20_000,
      availableBdt: 50_000,
    });
  });

  it("explains money held for members the roster cannot list", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [
        contribution("a", "2026-01-05", 10_000),
        contribution("left", "2026-01-05", 40_000, { memberName: "Former Member" }),
      ],
    });

    expect(model.roster.rows).toHaveLength(1);
    expect(model.reconciliation.rosterTotalBdt).toBe(10_000);
    expect(model.reconciliation.fundApprovedBdt).toBe(50_000);
    expect(model.reconciliation.unlistedMemberCount).toBe(1);
    expect(model.reconciliation.unlistedTotalBdt).toBe(40_000);
    expect(model.reconciliation.ledgerReconcilesToFund).toBe(true);
  });

  it("does not claim reconciliation once a filter narrows the scope", () => {
    const model = build({
      members: [member("a", "Ada Rahman"), member("b", "Bilal Chowdhury")],
      contributions: [contribution("a", "2026-01-05", 10_000), contribution("b", "2026-02-05", 10_000)],
      month: "2026-01",
    });

    expect(model.reconciliation.scopeIsComplete).toBe(false);
    expect(model.reconciliation.ledgerReconcilesToFund).toBe(false);
    expect(model.reconciliation.ledgerTotalBdt).toBe(10_000);
    expect(model.reconciliation.fundApprovedBdt).toBe(20_000);
  });

  it("clamps the as-of month to the project start and derives labels from it", () => {
    const model = build({
      members: [member("a", "Ada Rahman")],
      contributions: [],
      todayMonth: "2025-06",
    });

    expect(model.masthead.asOfMonth).toBe("2026-01");
    expect(model.masthead.asOfLabel).toBe("January 2026");
    expect(model.calendar.months.map((month) => month.key)).toEqual(["2026-01"]);
  });

  it("falls back to the default monthly amount and project start when no project is loaded", () => {
    const model = buildReportModel({
      contributions: [],
      members: [member("a", "Ada Rahman")],
      project: null,
      exitSummary: EXIT_SUMMARY,
      scope: { month: REPORT_ALL, memberId: REPORT_ALL },
      todayMonth: "2026-03",
    });

    expect(model.masthead.projectName).toBe("Home Investment");
    expect(model.masthead.monthlyContributionBdt).toBe(DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
    expect(model.masthead.periodStartMonth).toBe("2026-01");
    expect(model.roster.totals.requiredToDateBdt).toBe(3 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
  });

  it("uses each project's own monthly amount and start month", () => {
    const model = buildReportModel({
      contributions: [],
      members: [member("a", "Ada Rahman")],
      project: { ...PROJECT, monthly_contribution_bdt: 15_000, contribution_start_month: "2026-06-01" },
      exitSummary: EXIT_SUMMARY,
      scope: { month: REPORT_ALL, memberId: REPORT_ALL },
      todayMonth: "2026-07",
    });

    expect(model.roster.rows[0].requiredToDateBdt).toBe(30_000);
    expect(model.calendar.months.map((month) => month.key)).toEqual(["2026-06", "2026-07"]);
  });

  it("reads the member's code onto the roster and the ledger rows", () => {
    const model = build({
      members: [member("a", "Ada Rahman", { memberCode: "HI-004" })],
      contributions: [contribution("a", "2026-01-05", 10_000)],
    });

    expect(model.roster.rows[0].memberCode).toBe("HI-004");
    expect(model.ledger.groups[0].entries[0].memberCode).toBe("HI-004");
  });
});
