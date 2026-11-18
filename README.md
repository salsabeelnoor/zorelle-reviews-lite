# Zorelle Reviews (lite)

Product reviews for the Zorelle theme with **no installed app screens, no app proxy and no
database**. Three Netlify Functions do the work; reviews live in Shopify as
`zorelle_review` metaobjects, exactly as before, so existing reviews and the theme sections
keep working.

| Function | Address | Job |
|---|---|---|
| `eligibility` | `GET /api/eligibility` | Is this signed-in customer allowed to review this product? |
| `submit` | `POST /api/submit` | Check again, upload photos, save the review as a **Draft** |
| `recalculate` | every hour | Update each product's average, count and review list from **Active** reviews |

## How a review is protected

1. On the product page, **Liquid** (on Shopify's servers) signs
   `customer ID : product ID : time` with `hmac_sha256` and a secret stored in the shop
   metafield `zorelle_reviews.signing_secret` (storefront access off).
   Only the signature reaches the page, never the secret.
2. The browser sends the signature with the request. The function recalculates it with
   the same secret (`REVIEWS_SIGNING_SECRET` on Netlify). A wrong customer, product,
   an old page (over 24 h) or a made-up request is rejected.
3. The function then checks the customer's orders through the Admin API (verified buyers
   only) and that they haven't reviewed the product yet (one review per product).
4. The review is saved as a **Draft**: nothing appears on the site until you set it to
   **Active**.

**Where the secret lives:** your local `.env` (git-ignored), Netlify's environment
variables and the shop metafield. **Never** in the theme, the theme repo or this repo.

## Setup

### 1. Dev Dashboard app (gives the functions Admin API access)

Shopify no longer allows creating custom apps in the store admin. Use the Dev Dashboard:

1. Go to <https://dev.shopify.com> → **Apps** → **Create app** (name it e.g. "Zorelle Reviews API").
2. Create a **version** with these access scopes:
   `read_customers, read_orders, read_all_orders, read_products, write_products,
   read_metaobjects, write_metaobjects, write_files`
   - `read_all_orders` lets customers who bought more than 60 days ago review.
     If it isn't offered or approved, only orders from the last 60 days count.
   - Under **Protected customer data**, request access to customer **name** (the review
     shows "Jane D.").
3. **Install** the app on the store.
4. From **Settings → Credentials**, copy the **Client ID** and **Client secret**.

> **Important:** the functions get their token with the *client credentials grant*, which
> only works when **the store and the app are in the same Shopify organization** (both
> listed under the same org in the Dev Dashboard). For the client's own live store, create
> the Dev Dashboard app from the organization that owns that store.

### 2. Local `.env` (never committed)

```bash
cp .env.example .env
```

Fill in `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `ALLOWED_ORIGINS`, and a
new random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output as `REVIEWS_SIGNING_SECRET`.

### 3. Save the secret to Shopify and calculate ratings once

```bash
npm install
npm run setup
```

This creates the shop metafields with storefront access off, saves the secret (it is never
printed) and recalculates every product's ratings.

### 4. Deploy to Netlify

1. Put this folder in a **private** Git repo (or deploy with the Netlify CLI:
   `npx netlify deploy --prod`).
2. In Netlify → **Site configuration → Environment variables**, add the same six
   variables as in `.env`.
3. Deploy, and note the site address, e.g. `https://zorelle-reviews-api.netlify.app`.

`ALLOWED_ORIGINS` must list every address the store is opened on, comma separated,
for example:
`https://zorelle-lzs55yfo.myshopify.com,https://www.yourdomain.com,http://127.0.0.1:9292`

### 5. Connect the theme

Theme editor → **Theme settings → Product reviews → Reviews API address**: paste the
Netlify site address. The address is public and safe in the theme.

**Check:** sign in as a customer, open a product page, right-click → **View page source**,
and search for `data-signature`. If it's there, Liquid can read the secret. If it's
missing, the metafield wasn't saved: run `npm run setup` again.

### 6. Retire the old app

Once a test review works:

1. Uninstall the old **Zorelle Reviews** app. Reviews, the `zorelle_review` type and the
   product metafields are merchant-owned and **stay**.
2. Delete the old Netlify site and the Neon database it used.

## Home page slider toggle (one-time)

Content → Metaobjects → Zorelle review → **Manage definition** → **Add field** →
**True or false**. Name it **Show in home slider**, with the key **`show_on_home`**
(exactly), and save. Then turn it on for the reviews the home page "Reviews wall" should show.

The home page reads only the short shop list `zorelle_reviews.home` (reviews with the toggle
on, then the newest others, up to 128), never every review, so it stays fast with thousands
of reviews. Toggling shows straight away for any review in that list; new submissions are
added to it immediately, and the job refreshes it.

## Everyday use

- **Publish a review:** Content → Metaobjects → Zorelle review → open it → set **Active**.
- **Show it on the home page:** turn on **Show in home slider** (the review must also be Active).
- **Hide or delete:** set it to **Draft**, or delete it.
- Product averages and lists update **within the hour**. To update right away:
  Netlify → **Logs & metrics → Functions → recalculate → Run now**.
- Photos of a deleted review stay in **Content → Files**; delete them there if needed.

## Changing the secret

If the secret may have leaked (or every now and then):

1. Make a new one (step 2) and update `.env`.
2. `npm run setup`.
3. Update `REVIEWS_SIGNING_SECRET` in Netlify and redeploy.

Open product pages signed with the old secret stop working until they're reloaded.

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Save the secret to Shopify, create the metafield definitions, recalculate ratings |
| `npm run typecheck` | TypeScript check |
| `npm run dev` | Run the functions locally with the Netlify CLI |
