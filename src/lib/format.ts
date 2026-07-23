export function formatBdt(value: number): string {
  const amount = new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: 0,
  }).format(value);

  return `BDT ${amount}`;
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
