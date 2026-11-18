import type { Config } from "@netlify/functions";
import { recalculateAll } from "../../lib/ratings.mts";

/**
 * Scheduled every hour: recalculates each product's average rating, review count and
 * review list from the ACTIVE review metaobjects (see lib/ratings.mts). This is what makes
 * approving, hiding or deleting reviews in Shopify admin show up on the storefront.
 * Can also be run on demand from Netlify: Logs & metrics > Functions > recalculate > Run now.
 */
export default async () => {
  const result = await recalculateAll();
  console.log(`Review ratings recalculated: ${result.products} products updated, ${result.cleared} cleared.`);
};

export const config: Config = { schedule: "@hourly" };
