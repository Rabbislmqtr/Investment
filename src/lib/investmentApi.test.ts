import { describe, expect, it } from "vitest";
import {
  MONTHLY_MEMBER_CONTRIBUTION_BDT,
  getMonthlyPaymentCoverage,
  getScaledProjectTarget,
} from "./investmentApi";

describe("getScaledProjectTarget", () => {
  it("keeps the base target through ten members", () => {
    expect(getScaledProjectTarget(1_000_000, 10)).toBe(1_000_000);
    expect(getScaledProjectTarget(1_000_000, 4)).toBe(1_000_000);
  });

  it("scales the target for membership above ten", () => {
    expect(getScaledProjectTarget(1_000_000, 12)).toBe(1_200_000);
  });
});

describe("getMonthlyPaymentCoverage", () => {
  it("requires the same cumulative amount from the January 2026 start", () => {
    const coverage = getMonthlyPaymentCoverage(0, "2026-07");
    expect(coverage.dueMonths).toBe(7);
    expect(coverage.remainingDueBdt).toBe(7 * MONTHLY_MEMBER_CONTRIBUTION_BDT);
  });

  it("applies bulk payments to old months before advance months", () => {
    const coverage = getMonthlyPaymentCoverage(9 * MONTHLY_MEMBER_CONTRIBUTION_BDT, "2026-07");
    expect(coverage.paid).toBe(true);
    expect(coverage.paidThroughMonth).toBe("2026-09");
    expect(coverage.advanceMonths).toBe(2);
  });

  it("keeps partial money as credit toward the next month", () => {
    const coverage = getMonthlyPaymentCoverage(2 * MONTHLY_MEMBER_CONTRIBUTION_BDT + 2500, "2026-03");
    expect(coverage.paid).toBe(false);
    expect(coverage.creditBdt).toBe(2500);
    expect(coverage.remainingDueBdt).toBe(7500);
  });
});
