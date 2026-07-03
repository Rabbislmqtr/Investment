import { cleanString, jsonResponse, readJson, RECEIPT_BUCKET, requireAdmin } from "./_shared/admin-utils.mjs";

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
    const fileBase64 = cleanString(body.fileBase64);
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
    if (!fileName || !fileBase64) return jsonResponse({ error: "Receipt file is required." }, 400);
    if (!ALLOWED_RECEIPT_TYPES.has(fileType)) return jsonResponse({ error: "Receipt must be PDF, JPG, or PNG." }, 400);

    const fileBuffer = Buffer.from(fileBase64, "base64");
    if (fileBuffer.byteLength > MAX_RECEIPT_BYTES) {
      return jsonResponse({ error: "Receipt must be 10 MB or smaller." }, 400);
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

    const extension = fileName.split(".").pop()?.toLowerCase() || "file";
    const filePath = `${memberId}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await service.storage.from(RECEIPT_BUCKET).upload(filePath, fileBuffer, {
      contentType: fileType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const reviewedAt = new Date().toISOString();
    const { data: contribution, error: contributionError } = await service
      .from("contributions")
      .insert({
        project_id: projectId,
        member_id: memberId,
        payment_date: paymentDate,
        bdt_amount: bdtAmount,
        source_currency: sourceCurrency,
        source_amount: sourceAmount,
        exchange_rate: exchangeRate,
        sent_from_country: sentFromCountry,
        payment_method: paymentMethod,
        notes,
        status: "approved",
        reviewed_by: auth.adminUser.id,
        reviewed_at: reviewedAt,
      })
      .select("id")
      .single();
    if (contributionError) throw contributionError;

    const { error: receiptError } = await service.from("payment_receipts").insert({
      contribution_id: contribution.id,
      uploaded_by: memberId,
      storage_bucket: RECEIPT_BUCKET,
      storage_path: filePath,
      file_name: fileName,
      file_type: fileType,
      file_size: fileBuffer.byteLength,
    });
    if (receiptError) throw receiptError;

    await service.from("audit_logs").insert({
      actor_id: auth.adminUser.id,
      project_id: projectId,
      contribution_id: contribution.id,
      action: "admin_member_payment_approved",
      details: { memberId, fileName },
    });

    return jsonResponse({ contributionId: contribution.id });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not submit member payment." }, 500);
  }
};
