import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.mts";
import { SIGNATURE_MAX_AGE_SECONDS } from "./contract.mts";

/**
 * Verifies the signature the theme makes on Shopify's servers with Liquid:
 *
 *   {{ customer.id | append: ':' | append: product.id | append: ':' | append: ts
 *      | hmac_sha256: shop.metafields.zorelle_reviews.signing_secret }}
 *
 * The secret never reaches the browser, so a valid signature proves Shopify rendered this
 * page for that signed-in customer and that product, within the last 24 hours.
 * Returns the trusted customer ID, or null when the request isn't signed correctly.
 */
export function verifiedCustomer(input: {
  customerId: string | null;
  productId: string;
  timestamp: string | null;
  signature: string | null;
}): string | null {
  const { customerId, productId, timestamp, signature } = input;
  if (!customerId || !/^\d+$/.test(customerId)) return null;
  if (!/^\d+$/.test(productId) || !timestamp || !/^\d+$/.test(timestamp)) return null;
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return null;

  const age = Date.now() / 1000 - Number(timestamp);
  // Allow 5 minutes of clock difference in the future.
  if (age > SIGNATURE_MAX_AGE_SECONDS || age < -300) return null;

  const expected = createHmac("sha256", config.signingSecret)
    .update(`${customerId}:${productId}:${timestamp}`)
    .digest();
  const given = Buffer.from(signature.toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? customerId : null;
}
