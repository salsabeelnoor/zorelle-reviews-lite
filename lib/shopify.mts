import { config } from "./config.mts";

/**
 * Admin GraphQL client using the client credentials grant: the function exchanges the Dev
 * Dashboard app's client ID and secret for a 24-hour token. The token is kept in memory
 * only (reused while the function instance is warm), so nothing has to be stored.
 * Works only when the store and the app belong to the same Shopify organization.
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  // Refresh five minutes early so a token never expires mid-request.
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60 * 1000) return cachedToken.value;

  const response = await fetch(`https://${config.shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!response.ok) {
    // Body may explain (e.g. shop_not_permitted); never log the credentials themselves.
    throw new ShopifyError(`Token request failed with HTTP ${response.status}: ${await response.text()}`);
  }
  const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

export class ShopifyError extends Error {
  readonly userErrors: UserError[];

  constructor(message: string, userErrors: UserError[] = []) {
    super(message);
    this.name = "ShopifyError";
    this.userErrors = userErrors;
  }
}

/** Runs an Admin GraphQL operation and returns `data`, throwing on top-level errors. */
export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401) cachedToken = null;
  if (!response.ok) throw new ShopifyError(`Shopify API request failed with HTTP ${response.status}`);

  const json = (await response.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new ShopifyError(`Shopify API error: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new ShopifyError("Shopify API returned no data");
  return json.data;
}

/** Throws when a mutation returned userErrors. */
export function assertNoUserErrors(operation: string, userErrors: UserError[] | null | undefined) {
  if (userErrors?.length) {
    const detail = userErrors
      .map((error) => (error.field?.length ? `${error.field.join(".")}: ` : "") + error.message)
      .join("; ");
    throw new ShopifyError(`${operation} failed: ${detail}`, userErrors);
  }
}

export const productGid = (id: string | number) => `gid://shopify/Product/${id}`;
export const customerGid = (id: string | number) => `gid://shopify/Customer/${id}`;
export const shopGid = async () => (await gql<{ shop: { id: string } }>(`{ shop { id } }`)).shop.id;
