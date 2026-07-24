import { cleanString, jsonResponse, readJson, requireAdmin, serverError } from "./_shared/admin-utils.mjs";

const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%";
const PASSWORD_ALPHABET = `${UPPERCASE}${LOWERCASE}${DIGITS}${SYMBOLS}`;

function randomCharacter(alphabet) {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return alphabet[values[0] % alphabet.length];
}

export function generateTemporaryPassword() {
  const characters = [
    randomCharacter(UPPERCASE),
    randomCharacter(LOWERCASE),
    randomCharacter(DIGITS),
    randomCharacter(SYMBOLS),
  ];
  while (characters.length < 16) characters.push(randomCharacter(PASSWORD_ALPHABET));

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    const swapIndex = values[0] % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join("");
}

function recoveryRedirectUrl(request) {
  const configuredUrl = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL");
  return new URL("/", configuredUrl || request.url).toString();
}

async function recordPasswordAudit(service, actorId, projectId, memberId, action) {
  const { error } = await service.from("audit_logs").insert({
    actor_id: actorId,
    project_id: projectId || null,
    action,
    details: { memberId },
  });
  if (error) console.error("Could not record password administration audit.", error);
}

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await readJson(request);
    if (!body) return jsonResponse({ error: "Invalid JSON body." }, 400);

    const action = cleanString(body.action);
    const userId = cleanString(body.userId);
    const projectId = cleanString(body.projectId);
    if (!userId) return jsonResponse({ error: "Member is required." }, 400);
    if (!projectId) return jsonResponse({ error: "Project is required." }, 400);
    if (!["send_reset_link", "generate_temporary_password"].includes(action)) {
      return jsonResponse({ error: "Unsupported password action." }, 400);
    }
    if (userId === auth.adminUser.id) {
      return jsonResponse({ error: "Use your own Profile page to change or recover the current admin password." }, 400);
    }

    const { service } = auth;
    const { data: member, error: memberError } = await service
      .from("profiles")
      .select("id, email, role")
      .eq("id", userId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return jsonResponse({ error: "Member account was not found." }, 404);
    if (member.role === "admin") {
      return jsonResponse({ error: "Administrator passwords must be changed or recovered from their own Profile page." }, 400);
    }
    if (!member.email) return jsonResponse({ error: "Member account does not have an email address." }, 400);

    if (action === "send_reset_link") {
      const { error } = await service.auth.resetPasswordForEmail(member.email, {
        redirectTo: recoveryRedirectUrl(request),
      });
      if (error) throw error;
      await recordPasswordAudit(service, auth.adminUser.id, projectId, userId, "admin_password_reset_email_sent");
      return jsonResponse({ email: member.email });
    }

    const temporaryPassword = generateTemporaryPassword();
    const { error: passwordError } = await service.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
    });
    if (passwordError) throw passwordError;
    await recordPasswordAudit(service, auth.adminUser.id, projectId, userId, "admin_temporary_password_generated");

    return jsonResponse({ email: member.email, temporaryPassword });
  } catch (error) {
    return serverError(error, "Could not complete the password action.");
  }
};
