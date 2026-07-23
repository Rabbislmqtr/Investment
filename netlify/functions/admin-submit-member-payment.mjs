import { cleanString, jsonResponse, readJson, RECEIPT_BUCKET, requireAdmin, serverError } from "./_shared/admin-utils.mjs";

const ALLOWED_RECEIPT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg"]);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

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
    const memberId = cleanString(body.memberId);
    const paymentDate = cleanString(body.paymentDate);
    const bdtAmount = Number(body.bdtAmount);
    const fileName = cleanString(body.fileName);
    const fileType = cleanString(body.fileType);
    const storagePath = cleanString(body.storagePath);
    const fileSize = Number(body.fileSize);
    const sourceCurrency = cleanString(body.sourceCurrency) || null;
    const sourceAmount = body.sourceAmount ? Number(body.sourceAmount) : null;
    const exchangeRate = body.exchangeRate ? Number(body.exchangeRate) : null;
    const sentFromCountry = cleanString(body.sentFromCountry) || null;
    const paymentMethod = cleanString(body.paymentMethod) || null;
    const notes = cleanString(body.notes) || null;

    if (!projectId) return jsonResponse({ error: "Project is required." }, 400);
    if (!memberId) return jsonResponse({ error: "Member is required." }, 400);
    if (!paymentDate) return jsonResponse({ error: "Payment date is required." }, 400);
    if (!Number.isFinite(bdtAmount) || bdtAmount <= 0) return jsonResponse({ error: "BDT amount must be greater than zero." }, 400);
    if (!fileName || !storagePath) return jsonResponse({ error: "Receipt file is required." }, 400);
    if (!ALLOWED_RECEIPT_TYPES.has(fileType)) return jsonResponse({ error: "Receipt must be PDF, JPG, or PNG." }, 400);
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_RECEIPT_BYTES) {
      return jsonResponse({ error: "Receipt must be 10 MB or smaller." }, 400);
    }
    if (!storagePath.startsWith(`${memberId}/`) || storagePath.includes("..")) {
      return jsonResponse({ error: "Receipt path does not match the selected member." }, 400);
    }

    const { service } = auth;
    const { data: membership, error: membershipError } = await service
      .from("group_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", memberId)
      .neq("status", "left")
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership) return jsonResponse({ error: "Selected member is not active in this project." }, 400);

    const objectName = storagePath.slice(memberId.length + 1);
    const { data: objects, error: objectError } = await service.storage.from(RECEIPT_BUCKET).list(memberId, {
      search: objectName,
      limit: 10,
    });
    if (objectError) throw objectError;
    const storedObject = objects?.find((object) => object.name === objectName);
    if (!storedObject) return jsonResponse({ error: "Uploaded receipt could not be verified." }, 400);

    const { data: contributionId, error: contributionError } = await service.rpc(
      "create_admin_approved_contribution_with_receipt",
      {
        p_project_id: projectId,
        p_member_id: memberId,
        p_payment_date: paymentDate,
        p_bdt_amount: bdtAmount,
        p_source_currency: sourceCurrency,
        p_source_amount: sourceAmount,
        p_exchange_rate: exchangeRate,
        p_sent_from_country: sentFromCountry,
        p_payment_method: paymentMethod,
        p_notes: notes,
        p_storage_bucket: RECEIPT_BUCKET,
        p_storage_path: storagePath,
        p_file_name: fileName,
        p_file_type: fileType,
        p_file_size: fileSize,
      },
    );
    if (contributionError) {
      await service.storage.from(RECEIPT_BUCKET).remove([storagePath]);
      throw contributionError;
    }

    return jsonResponse({ contributionId });
  } catch (error) {
    return serverError(error, "Could not submit member payment.");
  }
};
