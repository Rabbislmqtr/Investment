import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

function isValidUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const hasSupabaseConfig = Boolean(isValidUrl(supabaseUrl) && supabaseKey);

if (!hasSupabaseConfig) {
  console.warn("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
}

export const supabase = createClient(
  hasSupabaseConfig ? supabaseUrl! : "https://placeholder.supabase.co",
  hasSupabaseConfig ? supabaseKey! : "placeholder-publishable-key",
);
