import { cleanString, jsonResponse, readJson, requireAdmin, serverError } from "./_shared/admin-utils.mjs";

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
    const joinedAt = cleanString(body.joinedAt);
    const status = ["active", "paused", "left"].includes(body.status) ? body.status : "active";

    if (!projectId) return jsonResponse({ error: "Project is required." }, 400);
    if (!fullName) return jsonResponse({ error: "Full name is required." }, 400);
    if (!email || !email.includes("@")) return jsonResponse({ error: "Valid email is required." }, 400);
    if (password.length < 8) return jsonResponse({ error: "Password must be at least 8 characters." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedAt)) return jsonResponse({ error: "Valid joined date is required." }, 400);

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

    const { error: completionError } = await service.rpc("complete_admin_member_creation", {
      p_actor_id: auth.adminUser.id,
      p_project_id: projectId,
      p_user_id: userId,
      p_full_name: fullName,
      p_email: email,
      p_phone: phone,
      p_resident_country: residentCountry,
      p_member_code: memberCode,
      p_joined_at: joinedAt,
      p_status: status,
    });
    if (completionError) {
      await service.auth.admin.deleteUser(userId);
      throw completionError;
    }

    return jsonResponse({ memberId: userId });
  } catch (error) {
    return serverError(error, "Could not create member.");
  }
};
