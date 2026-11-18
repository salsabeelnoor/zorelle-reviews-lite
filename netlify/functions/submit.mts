import type { Config } from "@netlify/functions";
import { fail, handler, json } from "../../lib/http.mts";
import { verifiedCustomer } from "../../lib/signature.mts";
import { parseReviewForm, submitReview } from "../../lib/submit.mts";

/** Netlify caps request bodies at about 6 MB; the theme downscales photos before sending. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * POST /api/submit (multipart/form-data)
 * Fields: product_id, rating (1-5), title?, body (10-2000), photos (0-3 jpg/png/webp),
 *         customer_id, ts, sig (the theme's Liquid signature).
 * -> { ok: true } or { ok: false, error, message } with the matching HTTP status.
 */
export default handler(async (request) => {
  if (request.method !== "POST") return fail(request, 405, "method_not_allowed", "Use POST to submit a review.");

  const length = Number(request.headers.get("content-length"));
  if (length > MAX_BODY_BYTES) {
    return fail(request, 413, "invalid_photos", "Your photos are too large. Please use smaller images.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(request, 400, "invalid_request", "The review could not be read. Please try again.");
  }

  const input = parseReviewForm(form);
  if ("ok" in input) return fail(request, input.status, input.error, input.message);

  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === "string" ? entry : null;
  };
  const customerId = verifiedCustomer({
    customerId: value("customer_id"),
    productId: input.productId,
    timestamp: value("ts"),
    signature: value("sig"),
  });
  if (!customerId) return fail(request, 401, "signed_out", "Please sign in to write a review.");

  const result = await submitReview(customerId, input);
  return result.ok ? json(request, { ok: true }) : fail(request, result.status, result.error, result.message);
});

export const config: Config = { path: "/api/submit" };
