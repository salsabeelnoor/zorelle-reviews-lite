/** Environment configuration. Values live only in Netlify's environment variables. */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`Missing environment variable ${name}`);
  return value;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const config = {
  /** Store subdomain, e.g. "zorelle-lzs55yfo" (".myshopify.com" is stripped if present). */
  get shop() {
    return required("SHOPIFY_SHOP").replace(/\.myshopify\.com$/, "");
  },
  get clientId() {
    return required("SHOPIFY_CLIENT_ID");
  },
  get clientSecret() {
    return required("SHOPIFY_CLIENT_SECRET");
  },
  get apiVersion() {
    return process.env.SHOPIFY_API_VERSION?.trim() || "2026-07";
  },
  get signingSecret() {
    const secret = required("REVIEWS_SIGNING_SECRET");
    if (secret.length < 32) throw new ConfigError("REVIEWS_SIGNING_SECRET must be at least 32 characters");
    return secret;
  },
  /** Storefront origins allowed by CORS. */
  get allowedOrigins(): string[] {
    return (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean);
  },
};
