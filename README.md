# Zorelle Reviews (lite)

Netlify Functions for Zorelle product reviews. No app UI, no database; reviews are stored as Shopify metaobjects (`zorelle_review`).

| Function | Purpose |
|---|---|
| `GET /api/eligibility` | Can this signed-in customer review the product? |
| `POST /api/submit` | Save a review as a draft |
| `recalculate` (hourly) | Update product ratings and review lists |

Requests are signed by the theme (Liquid `hmac_sha256`) with a secret kept in a shop metafield, never in the theme or this repo.

## Setup

1. Create an app in the [Dev Dashboard](https://dev.shopify.com) with scopes `read_customers, read_orders, read_products, write_products, read_metaobjects, write_metaobjects, write_files`, and install it on the store (same organization).
2. `cp .env.example .env` and fill in the values.
3. `npm install` then `npm run setup`.
4. Deploy to Netlify with the same environment variables.
5. In the theme: **Theme settings → Product reviews → Reviews API address**.

## Commands

| Command | Purpose |
|---|---|
| `npm run setup` | Save the secret to Shopify and recalculate ratings |
| `npm run recalculate` | Update ratings now |
| `npm run typecheck` | TypeScript check |
