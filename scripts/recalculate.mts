/**
 * Recalculates every product's review metafields right away (the same work the hourly
 * Netlify function does). Run after publishing or deleting reviews when you don't want to
 * wait:  npm run recalculate
 */
import { recalculateAll } from "../lib/ratings.mts";

const result = await recalculateAll();
console.log(`✓ Ratings recalculated: ${result.products} products with reviews, ${result.cleared} cleared`);
