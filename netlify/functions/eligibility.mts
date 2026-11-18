import type { Config } from "@netlify/functions";
import { eligibility } from "../../lib/eligibility.mts";
import { fail, handler, json } from "../../lib/http.mts";
import { verifiedCustomer } from "../../lib/signature.mts";

/**
 * GET /api/eligibility?product_id=&customer_id=&ts=&sig=
 * (customer_id, ts and sig come from the theme's Liquid signature)
 * -> { signedIn, canReview, reason: "signed_out" | "not_purchased" | "already_reviewed" | null }
 */
export default handler(async (request) => {
  if (request.method !== "GET") return fail(request, 405, "method_not_allowed", "Use GET.");
  const params = new URL(request.url).searchParams;
  const productId = params.get("product_id") ?? "";
  if (!/^\d+$/.test(productId)) return fail(request, 400, "invalid_product", "Missing or invalid product_id.");

  const customerId = verifiedCustomer({
    customerId: params.get("customer_id"),
    productId,
    timestamp: params.get("ts"),
    signature: params.get("sig"),
  });
  if (!customerId) return json(request, { signedIn: false, canReview: false, reason: "signed_out" });

  const reason = await eligibility(customerId, productId);
  return json(request, { signedIn: true, canReview: reason === null, reason });
});

export const config: Config = { path: "/api/eligibility" };
