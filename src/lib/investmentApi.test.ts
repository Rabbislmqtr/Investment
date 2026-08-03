import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT,
  getExitRequestPaidBdt,
  getApprovedContributionTotalsByCoveredMonth,
  getMonthlyPaymentCoverage,
  getPerMemberTarget,
} from "./investmentApi";

describe("getPerMemberTarget", () => {
  it("divides the fixed project target across planned members", () => {
    expect(getPerMemberTarget(1_000_000, 10)).toBe(100_000);
    expect(getPerMemberTarget(1_000_000, 4)).toBe(250_000);
  });

  it("returns zero when no members are planned", () => {
    expect(getPerMemberTarget(1_000_000, 0)).toBe(0);
  });
});

describe("getExitRequestPaidBdt", () => {
  it("adds every partial refund recorded against a settlement", () => {
    expect(getExitRequestPaidBdt({
      member_refunds: [
        { amount_bdt: 15_000 },
        { amount_bdt: 7_500 },
      ],
    })).toBe(22_500);
  });
});

describe("getMonthlyPaymentCoverage", () => {
  it("requires the same cumulative amount from the January 2026 start", () => {
    const coverage = getMonthlyPaymentCoverage(0, "2026-07");
    expect(coverage.dueMonths).toBe(7);
    expect(coverage.remainingDueBdt).toBe(7 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT);
  });

  it("applies bulk payments to old months before advance months", () => {
    const coverage = getMonthlyPaymentCoverage(9 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT, "2026-07");
    expect(coverage.paid).toBe(true);
    expect(coverage.paidThroughMonth).toBe("2026-09");
    expect(coverage.advanceMonths).toBe(2);
  });

  it("keeps partial money as credit toward the next month", () => {
    const coverage = getMonthlyPaymentCoverage(2 * DEFAULT_MONTHLY_MEMBER_CONTRIBUTION_BDT + 2500, "2026-03");
    expect(coverage.paid).toBe(false);
    expect(coverage.creditBdt).toBe(2500);
    expect(coverage.remainingDueBdt).toBe(7500);
  });

  it("uses each project's monthly amount and start month", () => {
    const coverage = getMonthlyPaymentCoverage(30_000, "2026-07", 15_000, "2026-06");
    expect(coverage.dueMonths).toBe(2);
    expect(coverage.paid).toBe(true);
    expect(coverage.paidThroughMonth).toBe("2026-07");
  });
});

describe("getApprovedContributionTotalsByCoveredMonth", () => {
  it("splits each member's approved bulk payment across the oldest uncovered months", () => {
    const totals = getApprovedContributionTotalsByCoveredMonth([
      {
        member_id: "member-a",
        payment_date: "2026-03-15",
        bdt_amount: 30_000,
        status: "approved",
        created_at: "2026-03-15T08:00:00.000Z",
      },
      {
        member_id: "member-b",
        payment_date: "2026-03-20",
        bdt_amount: 10_000,
        status: "approved",
        created_at: "2026-03-20T08:00:00.000Z",
      },
    ], 10_000, "2026-01");

    expect(Object.fromEntries(totals)).toEqual({
      "2026-01": 20_000,
      "2026-02": 10_000,
      "2026-03": 10_000,
    });
  });

  it("keeps partial payments in the month they partially cover", () => {
    const totals = getApprovedContributionTotalsByCoveredMonth([
      {
        member_id: "member-a",
        payment_date: "2026-04-01",
        bdt_amount: 25_000,
        status: "approved",
        created_at: "2026-04-01T08:00:00.000Z",
      },
    ]);

    expect(Object.fromEntries(totals)).toEqual({
      "2026-01": 10_000,
      "2026-02": 10_000,
      "2026-03": 5_000,
    });
  });
});
