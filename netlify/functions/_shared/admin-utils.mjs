import { createClient } from "@supabase/supabase-js";

export const RECEIPT_BUCKET = "payment-receipts";

export function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function requireEnv(name, alternatives = []) {
  const keys = [name, ...alternatives];
  const value = keys.map((key) => Netlify.env.get(key)).find(Boolean);
  if (!value) throw new Error(`Missing ${keys.join(" or ")} environment variable.`);
  return value;
}

export function createServiceClient() {
  return createClient(
    requireEnv("SUPABASE_URL", ["VITE_SUPABASE_URL"]),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function requireAdmin(request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return { error: jsonResponse({ error: "Admin session is required." }, 401) };
  }

  const supabaseUrl = requireEnv("SUPABASE_URL", ["VITE_SUPABASE_URL"]);
  const publicKey = requireEnv("SUPABASE_PUBLISHABLE_KEY", ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"]);
  const service = createServiceClient();
  const userClient = createClient(supabaseUrl, publicKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return { error: jsonResponse({ error: "Admin session is invalid." }, 401) };
  }

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (profile?.role !== "admin") {
    return { error: jsonResponse({ error: "Only admins can use this action." }, 403) };
  }

  return { service, adminUser: userData.user };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function serverError(error, fallback) {
  console.error(error);
  return jsonResponse({ error: fallback }, 500);
}
