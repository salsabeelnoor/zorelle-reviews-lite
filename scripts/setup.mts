/**
 * One-time setup (and secret rotation), run on your own computer:
 *
 *   npm run setup
 *
 * Reads REVIEWS_SIGNING_SECRET and the Shopify credentials from your local .env, then:
 *   1. creates the shop metafield definitions zorelle_reviews.signing_secret,
 *      zorelle_reviews.products and zorelle_reviews.home with storefront access OFF (Liquid
 *      can still read them on Shopify's servers; the Storefront API and the browser can't);
 *   2. saves the signing secret into zorelle_reviews.signing_secret;
 *   3. recalculates every product's review metafields once.
 * The secret is never printed, and never written to the theme or to git.
 */
import { HOME_REVIEWS, REVIEW_LIST, REVIEWED_PRODUCTS } from "../lib/contract.mts";
import { config } from "../lib/config.mts";
import { recalculateAll } from "../lib/ratings.mts";
import { assertNoUserErrors, gql, shopGid, type UserError } from "../lib/shopify.mts";

const SECRET = { namespace: "zorelle_reviews", key: "signing_secret" } as const;

const CREATE_DEFINITION = `#graphql
  mutation CreateShopDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }`;

const SET_METAFIELDS = `#graphql
  mutation SetShopMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key }
      userErrors { field message code }
    }
  }`;

async function ensureDefinition(
  name: string,
  identifier: { namespace: string; key: string },
  type: string,
  validations: { name: string; value: string }[] = [],
) {
  const data = await gql<{ metafieldDefinitionCreate: { userErrors: UserError[] } }>(CREATE_DEFINITION, {
    definition: {
      name,
      ...identifier,
      type,
      ownerType: "SHOP",
      access: { storefront: "NONE" },
      validations,
    },
  });
  const errors = data.metafieldDefinitionCreate.userErrors.filter((error) => error.code !== "TAKEN");
  assertNoUserErrors(`Creating ${identifier.namespace}.${identifier.key}`, errors);
  console.log(`✓ Definition ${identifier.namespace}.${identifier.key} ready (storefront access off)`);
}

await ensureDefinition("Reviews signing secret", SECRET, "single_line_text_field");
await ensureDefinition("Reviewed products", REVIEWED_PRODUCTS, "json");

// The review type's ID, taken from the product review list definition (made with the type).
const listDefinition = await gql<{
  metafieldDefinitions: { nodes: { validations: { name: string; value: string }[] }[] };
}>(`{ metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "${REVIEW_LIST.namespace}", key: "${REVIEW_LIST.key}") { nodes { validations { name value } } } }`);
const reviewTypeId = listDefinition.metafieldDefinitions.nodes[0]?.validations.find(
  (validation) => validation.name === "metaobject_definition_id",
)?.value;
if (!reviewTypeId) throw new Error("Product metafield zorelle_reviews.list has no review type; was the review type set up?");
await ensureDefinition("Home slider reviews", HOME_REVIEWS, "list.metaobject_reference", [
  { name: "metaobject_definition_id", value: reviewTypeId },
]);

const saved = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SET_METAFIELDS, {
  metafields: [{ ownerId: await shopGid(), ...SECRET, type: "single_line_text_field", value: config.signingSecret }],
});
assertNoUserErrors("Saving the signing secret", saved.metafieldsSet.userErrors);
console.log("✓ Signing secret saved to the shop metafield (value not shown)");

const result = await recalculateAll();
console.log(`✓ Ratings recalculated: ${result.products} products with reviews, ${result.cleared} cleared`);
