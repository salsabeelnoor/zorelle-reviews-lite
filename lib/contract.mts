/**
 * Data contract shared with the Zorelle theme, which reads these names directly in Liquid.
 * Unchanged from the original Zorelle Reviews app, so existing reviews keep working.
 */

/** Merchant-owned metaobject type (Shopify reserves `product_review` for its standard one). */
export const REVIEW_TYPE = "zorelle_review";

/** Product metafields recalculated from ACTIVE reviews. */
export const RATING = { namespace: "reviews", key: "rating" } as const;
export const RATING_COUNT = { namespace: "reviews", key: "rating_count" } as const;
export const REVIEW_LIST = { namespace: "zorelle_reviews", key: "list" } as const;

/**
 * Shop metafield (JSON list of product GIDs) remembering which products have review
 * metafields, so the hourly recalculation can clear a product whose last review was deleted.
 */
export const REVIEWED_PRODUCTS = { namespace: "zorelle_reviews", key: "products" } as const;

/**
 * Shop metafield (list of review references) the home page "Reviews wall" reads: every review
 * with the "Show in home slider" toggle (field `show_on_home`) on, then the newest others,
 * up to 128. The theme checks the toggle itself, so switching it on or off shows straight
 * away for any review in this list, and the home page never has to load every review.
 */
export const HOME_REVIEWS = { namespace: "zorelle_reviews", key: "home" } as const;
export const SHOW_ON_HOME_FIELD = "show_on_home";

/** Shopify limits list metafields to 128 references; the newest are kept. */
export const MAX_LIST_REFERENCES = 128;

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const TITLE_MAX = 120;
export const BODY_MIN = 10;
export const BODY_MAX = 2000;
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** How long a theme signature stays valid (pages may sit open for a while). */
export const SIGNATURE_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Deterministic handle: one review per customer per product, enforced by Shopify. */
export function reviewHandle(productId: string, customerId: string): string {
  return `review-${productId}-${customerId}`;
}
