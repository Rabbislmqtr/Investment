import type { Contribution } from "../types";

export function formatBdtAmount(value: number): string {
  return new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBdt(value: number): string {
  return `BDT ${formatBdtAmount(value)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

export function fileSizeLabel(bytes: number | null): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function monthKey(value: string) {
  return value.slice(0, 7);
}

export function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function shortMonthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1));
}

export function formatDisplayName(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed !== trimmed.toLocaleUpperCase()) return trimmed;

  return trimmed
    .toLocaleLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

export function getContributionMemberName(contribution: Contribution) {
  const name = contribution.member?.full_name || contribution.profiles?.full_name;
  if (name) return formatDisplayName(name);
  return contribution.member?.email || contribution.profiles?.email || "Member";
}
