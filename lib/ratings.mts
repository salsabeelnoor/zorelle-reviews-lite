import {
  HOME_REVIEWS,
  MAX_LIST_REFERENCES,
  RATING,
  RATING_COUNT,
  RATING_MAX,
  RATING_MIN,
  REVIEW_LIST,
  REVIEW_TYPE,
  REVIEWED_PRODUCTS,
  SHOW_ON_HOME_FIELD,
} from "./contract.mts";
import { assertNoUserErrors, gql, shopGid, type UserError } from "./shopify.mts";

/**
 * Recalculates every product's review metafields from the review metaobjects:
 *   reviews.rating          average of ACTIVE reviews (standard rating metafield)
 *   reviews.rating_count    number of ACTIVE reviews
 *   zorelle_reviews.list    ALL reviews, drafts included, newest first (max 128)
 * The list includes drafts on purpose: the storefront never shows draft entries, so a review
 * appears on the product page the moment it's set to Active. Only the average and count
 * wait for this job. Products with no reviews at all get all three metafields removed;
 * products with only drafts keep the list but lose the average and count.
 * Runs on a schedule, with no webhooks or database.
 */

const ALL_REVIEWS = `#graphql
  query AllReviews($type: String!, $after: String) {
    metaobjects(type: $type, first: 250, after: $after) {
      nodes {
        id
        createdAt
        capabilities { publishable { status } }
        product: field(key: "product") { value }
        rating: field(key: "rating") { jsonValue }
        submittedAt: field(key: "submitted_at") { value }
        showOnHome: field(key: "${SHOW_ON_HOME_FIELD}") { value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const REVIEWED_PRODUCTS_QUERY = `#graphql
  query ReviewedProducts($namespace: String!, $key: String!) {
    shop { metafield(namespace: $namespace, key: $key) { jsonValue } }
  }`;

const PRODUCT_LIST = `#graphql
  query ProductReviewList($id: ID!, $namespace: String!, $key: String!) {
    product(id: $id) { metafield(namespace: $namespace, key: $key) { jsonValue } }
  }`;

const SET_METAFIELDS = `#graphql
  mutation SetReviewMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key }
      userErrors { field message code }
    }
  }`;

const DELETE_METAFIELDS = `#graphql
  mutation DeleteReviewMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key }
      userErrors { field message }
    }
  }`;

interface ReviewNode {
  id: string;
  createdAt: string;
  capabilities: { publishable: { status: "ACTIVE" | "DRAFT" } | null };
  product: { value: string } | null;
  rating: { jsonValue: { value?: string } | null } | null;
  submittedAt: { value: string } | null;
  showOnHome: { value: string } | null;
}

function submittedTime(review: ReviewNode): number {
  const time = new Date(review.submittedAt?.value ?? review.createdAt).getTime();
  return Number.isNaN(time) ? new Date(review.createdAt).getTime() : time;
}

/** Shopify accepts up to 25 metafields per metafieldsSet / metafieldsDelete call. */
function chunks<T>(items: T[], size = 24): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) result.push(items.slice(start, start + size));
  return result;
}

export async function recalculateAll() {
  // 1. Every review, grouped by product.
  const byProduct = new Map<string, ReviewNode[]>();
  const allReviews: ReviewNode[] = [];
  let after: string | null = null;
  do {
    const data: {
      metaobjects: { nodes: ReviewNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await gql(ALL_REVIEWS, { type: REVIEW_TYPE, after });
    for (const review of data.metaobjects.nodes) {
      allReviews.push(review);
      const productId = review.product?.value;
      if (!productId) continue;
      byProduct.set(productId, [...(byProduct.get(productId) ?? []), review]);
    }
    after = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null;
  } while (after);

  // 2. Metafield values: the list for every product with reviews (drafts included), the
  //    average and count only where there are active reviews.
  const toSet: Record<string, unknown>[] = [];
  const toClear: { ownerId: string; namespace: string; key: string }[] = [];
  for (const [productId, reviews] of byProduct) {
    const newestFirst = [...reviews].sort((a, b) => submittedTime(b) - submittedTime(a));
    toSet.push({
      ownerId: productId,
      ...REVIEW_LIST,
      type: "list.metaobject_reference",
      value: JSON.stringify(newestFirst.slice(0, MAX_LIST_REFERENCES).map((review) => review.id)),
    });

    const ratings = newestFirst
      .filter((review) => review.capabilities.publishable?.status === "ACTIVE")
      .map((review) => Number(review.rating?.jsonValue?.value))
      .filter((value) => Number.isFinite(value) && value >= RATING_MIN && value <= RATING_MAX);
    if (!ratings.length) {
      toClear.push({ ownerId: productId, ...RATING }, { ownerId: productId, ...RATING_COUNT });
      continue;
    }

    const average = Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10;
    toSet.push(
      {
        ownerId: productId,
        ...RATING,
        type: "rating",
        value: JSON.stringify({ value: average.toFixed(1), scale_min: RATING_MIN.toFixed(1), scale_max: RATING_MAX.toFixed(1) }),
      },
      { ownerId: productId, ...RATING_COUNT, type: "number_integer", value: String(ratings.length) },
    );
  }

  // 3. Products that had review metafields last time but have no reviews at all now.
  const previous = await gql<{ shop: { metafield: { jsonValue: unknown } | null } }>(REVIEWED_PRODUCTS_QUERY, REVIEWED_PRODUCTS);
  const previousIds = Array.isArray(previous.shop.metafield?.jsonValue) ? (previous.shop.metafield.jsonValue as string[]) : [];
  for (const ownerId of previousIds.filter((id) => !byProduct.has(id))) {
    toClear.push(...[RATING, RATING_COUNT, REVIEW_LIST].map((identifier) => ({ ownerId, ...identifier })));
  }

  for (const batch of chunks(toSet)) {
    const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SET_METAFIELDS, { metafields: batch });
    assertNoUserErrors("Updating review metafields", data.metafieldsSet.userErrors);
  }

  for (const batch of chunks(toClear)) {
    const data = await gql<{ metafieldsDelete: { userErrors: UserError[] } }>(DELETE_METAFIELDS, { metafields: batch });
    assertNoUserErrors("Clearing review metafields", data.metafieldsDelete.userErrors);
  }

  // 4. Home slider list: reviews with the toggle on first, then the newest others.
  const newest = [...allReviews].sort((a, b) => submittedTime(b) - submittedTime(a));
  const featured = newest.filter((review) => review.showOnHome?.value === "true");
  const homeIds = [...new Set([...featured, ...newest].map((review) => review.id))].slice(0, MAX_LIST_REFERENCES);
  await setShopList(homeIds);

  // 5. Remember which products now carry review metafields.
  const saved = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SET_METAFIELDS, {
    metafields: [{ ownerId: await shopGid(), ...REVIEWED_PRODUCTS, type: "json", value: JSON.stringify([...byProduct.keys()]) }],
  });
  assertNoUserErrors("Saving reviewed products", saved.metafieldsSet.userErrors);

  return { products: byProduct.size, cleared: previousIds.filter((id) => !byProduct.has(id)).length };
}

async function setShopList(ids: string[]) {
  const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SET_METAFIELDS, {
    metafields: [{ ownerId: await shopGid(), ...HOME_REVIEWS, type: "list.metaobject_reference", value: JSON.stringify(ids) }],
  });
  assertNoUserErrors("Updating the home slider list", data.metafieldsSet.userErrors);
}

/** Adds a just-submitted review to the top of the home slider list (see HOME_REVIEWS). */
export async function addToHomeList(reviewId: string) {
  const data = await gql<{ shop: { metafield: { jsonValue: unknown } | null } }>(REVIEWED_PRODUCTS_QUERY, HOME_REVIEWS);
  const current = Array.isArray(data.shop.metafield?.jsonValue) ? (data.shop.metafield.jsonValue as string[]) : [];
  await setShopList([reviewId, ...current.filter((id) => id !== reviewId)].slice(0, MAX_LIST_REFERENCES));
}

/**
 * Adds a just-submitted (draft) review to the top of its product's review list, so it shows
 * the moment it's set to Active. The average and count are left to recalculateAll.
 */
export async function addToProductList(productId: string, reviewId: string) {
  const data = await gql<{ product: { metafield: { jsonValue: unknown } | null } | null }>(PRODUCT_LIST, {
    id: productId,
    ...REVIEW_LIST,
  });
  const current = Array.isArray(data.product?.metafield?.jsonValue) ? (data.product.metafield.jsonValue as string[]) : [];
  const list = [reviewId, ...current.filter((id) => id !== reviewId)].slice(0, MAX_LIST_REFERENCES);

  const saved = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SET_METAFIELDS, {
    metafields: [{ ownerId: productId, ...REVIEW_LIST, type: "list.metaobject_reference", value: JSON.stringify(list) }],
  });
  assertNoUserErrors("Adding the review to the product list", saved.metafieldsSet.userErrors);
}
