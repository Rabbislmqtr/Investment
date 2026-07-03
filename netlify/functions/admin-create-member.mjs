import { cleanString, jsonResponse, readJson, requireAdmin } from "./_shared/admin-utils.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await readJson(request);
    if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);

    const projectId = cleanString(body.projectId);
    const fullName = cleanString(body.fullName);
    const email = cleanString(body.email).toLowerCase();
    const password = cleanString(body.password);
    const phone = cleanString(body.phone) || null;
    const residentCountry = cleanString(body.residentCountry) || null;
    const memberCode = cleanString(body.memberCode) || null;
    const joinedAt = cleanString(body.joinedAt) || new Date().toISOString().slice(0, 10);
    const status = ["active", "paused", "left"].includes(body.status) ? body.status : "active";

    if (!projectId) return jsonResponse({ error: "Project is required." }, 400);
    if (!fullName) return jsonResponse({ error: "Full name is required." }, 400);
    if (!email || !email.includes("@")) return jsonResponse({ error: "Valid email is required." }, 400);
    if (password.length < 6) return jsonResponse({ error: "Password must be at least 6 characters." }, 400);

    const { service } = auth;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createError) throw createError;
    const userId = created.user?.id;
    if (!userId) return jsonResponse({ error: "Supabase did not return the created user." }, 500);

    const { error: profileError } = await service.from("profiles").upsert({
      id: userId,
      full_name: fullName,
      email,
      phone,
      resident_country: residentCountry,
      role: "member",
    });
    if (profileError) throw profileError;

    const { error: memberError } = await service.from("group_members").upsert(
      {
        project_id: projectId,
        user_id: userId,
        member_code: memberCode,
        joined_at: joinedAt,
        status,
      },
      { onConflict: "project_id,user_id" },
    );
    if (memberError) throw memberError;

    await service.from("audit_logs").insert({
      actor_id: auth.adminUser.id,
      project_id: projectId,
      action: "admin_member_created",
      details: { memberId: userId, email, memberCode },
    });

    return jsonResponse({ memberId: userId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not create member." }, 500);
  }
};
