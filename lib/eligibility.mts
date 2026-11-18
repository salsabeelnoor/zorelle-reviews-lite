import { REVIEW_TYPE, reviewHandle } from "./contract.mts";
import { customerGid, gql, productGid } from "./shopify.mts";

const EXISTING_REVIEW = `#graphql
  query ExistingReview($handle: MetaobjectHandleInput!, $type: String!, $query: String!) {
    metaobjectByHandle(handle: $handle) { id }
    metaobjects(type: $type, first: 1, query: $query) { nodes { id } }
  }`;

const CUSTOMER_ORDER_PRODUCTS = `#graphql
  query CustomerOrderProducts($customerId: ID!, $after: String) {
    customer(id: $customerId) {
      orders(first: 10, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes {
          lineItems(first: 50) { nodes { product { id } } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

/**
 * Orders scanned per check (newest first, 10 per page). Orders older than 60 days are only
 * visible when the Dev Dashboard app has the read_all_orders scope.
 */
const MAX_ORDER_PAGES = 10;

export type IneligibleReason = "not_purchased" | "already_reviewed";

/** Whether this customer already has a review (draft or published) for the product. */
export async function hasReviewed(customerId: string, productId: string): Promise<boolean> {
  const data = await gql<{
    metaobjectByHandle: { id: string } | null;
    metaobjects: { nodes: { id: string }[] };
  }>(EXISTING_REVIEW, {
    handle: { type: REVIEW_TYPE, handle: reviewHandle(productId, customerId) },
    type: REVIEW_TYPE,
    query: `fields.customer_id:"${customerId}" AND fields.product:"${productGid(productId)}"`,
  });
  return Boolean(data.metaobjectByHandle || data.metaobjects.nodes.length);
}

/** Whether any of the customer's orders contains the product. */
export async function hasPurchased(customerId: string, productId: string): Promise<boolean> {
  const target = productGid(productId);
  let after: string | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const data: {
      customer: {
        orders: {
          nodes: { lineItems: { nodes: { product: { id: string } | null }[] } }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    } = await gql(CUSTOMER_ORDER_PRODUCTS, { customerId: customerGid(customerId), after });
    if (!data.customer) return false;
    for (const order of data.customer.orders.nodes) {
      if (order.lineItems.nodes.some((line) => line.product?.id === target)) return true;
    }
    if (!data.customer.orders.pageInfo.hasNextPage) return false;
    after = data.customer.orders.pageInfo.endCursor;
  }
  return false;
}

/** Eligibility for a verified customer; the cheaper duplicate check runs first. */
export async function eligibility(customerId: string, productId: string): Promise<IneligibleReason | null> {
  if (await hasReviewed(customerId, productId)) return "already_reviewed";
  if (!(await hasPurchased(customerId, productId))) return "not_purchased";
  return null;
}
