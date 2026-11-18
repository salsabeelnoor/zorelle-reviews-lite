import { BODY_MAX, BODY_MIN, RATING_MAX, RATING_MIN, REVIEW_TYPE, reviewHandle, TITLE_MAX } from "./contract.mts";
import { eligibility } from "./eligibility.mts";
import { deleteFiles, PhotoError, readPhotos, uploadPhotos } from "./photos.mts";
import { addToHomeList, addToProductList } from "./ratings.mts";
import { customerGid, gql, productGid, ShopifyError, type UserError } from "./shopify.mts";

const REVIEWER_CONTEXT = `#graphql
  query ReviewerContext($productId: ID!, $customerId: ID!) {
    product(id: $productId) { id title }
    customer(id: $customerId) { id firstName lastName }
  }`;

const CREATE_REVIEW = `#graphql
  mutation CreateReview($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id }
      userErrors { field message code }
    }
  }`;

export interface ReviewInput {
  productId: string;
  rating: number;
  title: string;
  body: string;
  photos: File[];
}

export type SubmitFailure = { ok: false; status: number; error: string; message: string };
export type SubmitResult = { ok: true } | SubmitFailure;

const failure = (status: number, error: string, message: string): SubmitFailure => ({ ok: false, status, error, message });

/** Parses and validates the review fields of the multipart form. */
export function parseReviewForm(form: FormData): ReviewInput | SubmitFailure {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const productId = text("product_id");
  if (!/^\d+$/.test(productId)) return failure(400, "invalid_product", "This product could not be found.");

  const rating = Number(text("rating"));
  if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) {
    return failure(400, "invalid_rating", "Please choose a rating from 1 to 5 stars.");
  }

  const title = text("title").replace(/\s+/g, " ");
  if (title.length > TITLE_MAX) return failure(400, "invalid_title", `Please keep the title under ${TITLE_MAX} characters.`);

  const body = text("body").replace(/\r\n/g, "\n");
  if (body.length < BODY_MIN || body.length > BODY_MAX) {
    return failure(400, "invalid_body", `Your review must be between ${BODY_MIN} and ${BODY_MAX} characters.`);
  }

  const photos = form.getAll("photos").filter((value): value is File => value instanceof File);
  return { productId, rating, title, body, photos };
}

/** "Jane D." from the customer record; never the email or other contact details. */
function displayName(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.trim();
  const initial = lastName?.trim().charAt(0);
  if (first) return initial ? `${first} ${initial.toUpperCase()}.` : first;
  return "Verified buyer";
}

/** Saves a review as a DRAFT metaobject for a verified customer. */
export async function submitReview(customerId: string, input: ReviewInput): Promise<SubmitResult> {
  const context = await gql<{
    product: { id: string; title: string } | null;
    customer: { id: string; firstName: string | null; lastName: string | null } | null;
  }>(REVIEWER_CONTEXT, { productId: productGid(input.productId), customerId: customerGid(customerId) });
  if (!context.product) return failure(400, "invalid_product", "This product could not be found.");
  if (!context.customer) return failure(401, "signed_out", "Please sign in to write a review.");

  const reason = await eligibility(customerId, input.productId);
  if (reason === "already_reviewed") return failure(409, "already_reviewed", "You have already reviewed this product. Thank you!");
  if (reason === "not_purchased") return failure(403, "not_purchased", "Only customers who bought this product can review it.");

  let fileIds: string[] = [];
  try {
    fileIds = await uploadPhotos(await readPhotos(input.photos), `Customer photo of ${context.product.title}`);
  } catch (error) {
    if (error instanceof PhotoError) return failure(error.status, "invalid_photos", error.message);
    throw error;
  }

  const fields = [
    { key: "product", value: context.product.id },
    { key: "customer_name", value: displayName(context.customer.firstName, context.customer.lastName) },
    { key: "rating", value: JSON.stringify({ value: input.rating.toFixed(1), scale_min: "1.0", scale_max: "5.0" }) },
    { key: "body", value: input.body },
    { key: "verified", value: "true" },
    { key: "submitted_at", value: new Date().toISOString() },
    { key: "customer_id", value: customerId },
    ...(input.title ? [{ key: "title", value: input.title }] : []),
    ...(fileIds.length ? [{ key: "images", value: JSON.stringify(fileIds) }] : []),
  ];

  let created;
  try {
    created = await gql<{ metaobjectCreate: { metaobject: { id: string } | null; userErrors: UserError[] } }>(
      CREATE_REVIEW,
      {
        metaobject: {
          type: REVIEW_TYPE,
          handle: reviewHandle(input.productId, customerId),
          // Drafts are never visible on the storefront; publish by setting the entry to Active.
          capabilities: { publishable: { status: "DRAFT" } },
          fields,
        },
      },
    );
  } catch (error) {
    await deleteFiles(fileIds);
    throw error;
  }

  const { metaobject, userErrors } = created.metaobjectCreate;
  if (!metaobject) {
    await deleteFiles(fileIds);
    // The handle is unique per customer and product, so a double submit ends here.
    if (userErrors.some((error) => error.code === "TAKEN")) {
      return failure(409, "already_reviewed", "You have already reviewed this product. Thank you!");
    }
    throw new ShopifyError(`metaobjectCreate failed: ${userErrors.map((e) => e.message).join("; ")}`, userErrors);
  }

  // Put the draft at the top of the product's review list now. The storefront skips drafts,
  // so it stays hidden until it's set to Active, then shows immediately with no job needed.
  // If this fails, the hourly job adds it to the list anyway.
  try {
    await addToProductList(context.product.id, metaobject.id);
  } catch (error) {
    console.error("Could not add the review to the product's list:", error);
  }
  // Same for the home slider list, so turning on "Show in home slider" shows it at once.
  try {
    await addToHomeList(metaobject.id);
  } catch (error) {
    console.error("Could not add the review to the home slider list:", error);
  }

  return { ok: true };
}
