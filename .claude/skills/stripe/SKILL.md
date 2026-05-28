---
name: stripe
description: Guidelines for integrating Stripe payments into web applications — setup, webhooks, products, subscriptions, and checkout flows.
---

# Stripe Skill

Integrate Stripe payments using the official Stripe SDK and standard webhook patterns.

## Prerequisites

1. Install the Stripe package:
   ```bash
   npm install stripe
   # or for TypeScript types
   npm install stripe @types/stripe
   ```

2. Add credentials to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   Get these from the [Stripe Dashboard](https://dashboard.stripe.com/apikeys).

3. Ensure a PostgreSQL database exists for storing application data.

## Project Structure

- **Scripts directory**: `scripts/` at the project root (e.g., `scripts/seed-products.ts`)
- **Run a script**: `npx tsx scripts/<script>.ts`
- **API server**: `server/`
- **Client app**: `client/`

## Initial Setup: Step-by-Step

### 1. Create the Stripe client

Create `server/stripeClient.ts`:

```typescript
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});
```

### 2. Set up the database

Create application tables that reference Stripe IDs:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Do not** create tables to duplicate Stripe-managed data (products, prices, subscriptions). Query the Stripe SDK or use webhooks to keep your own tables in sync.

### 3. Create a webhook handler

Create `server/webhookHandlers.ts`:

```typescript
import Stripe from 'stripe';
import { stripe } from './stripeClient';

export async function processWebhook(payload: Buffer, signature: string) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err}`);
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      // Update your users table
      // await db.execute(sql`UPDATE users SET stripe_subscription_id = ${sub.id} WHERE stripe_customer_id = ${sub.customer}`)
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      // Handle cancellation
      break;
    }
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Fulfill the purchase
      break;
    }
  }
}
```

### 4. Register the webhook route

**Critical:** Register the webhook route BEFORE `express.json()` middleware:

```typescript
import express from 'express';
import { processWebhook } from './webhookHandlers';

const app = express();

// Webhook route MUST come BEFORE express.json()
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });

    const sig = Array.isArray(signature) ? signature[0] : signature;

    try {
      await processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  }
);

// JSON middleware for other routes
app.use(express.json());
```

### 5. Create a checkout route

```typescript
app.post('/api/checkout', async (req, res) => {
  const { priceId, userId } = req.body;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL}/pricing`,
    metadata: { userId },
  });

  res.json({ url: session.url });
});
```

### 6. Create a product seeding script

Create `scripts/seed-products.ts` to create products in Stripe:

```typescript
import { stripe } from '../server/stripeClient';

async function createProducts() {
  // Check if product already exists (idempotent)
  const existing = await stripe.products.search({ query: "name:'Pro Plan'" });
  if (existing.data.length > 0) {
    console.log('Pro Plan already exists:', existing.data[0].id);
    return;
  }

  const product = await stripe.products.create({
    name: 'Pro Plan',
    description: 'Professional subscription',
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 2900, // $29.00
    currency: 'usd',
    recurring: { interval: 'month' },
  });

  console.log('Created:', product.id, price.id);
}

createProducts();
```

Run it: `npx tsx scripts/seed-products.ts`

## Local Webhook Testing

For local development, use the Stripe CLI to forward webhooks to localhost:

```bash
# Install: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

The CLI prints a webhook signing secret (`whsec_...`) — add it to `.env` as `STRIPE_WEBHOOK_SECRET`.

Or use ngrok:
```bash
ngrok http 3000
# Use the HTTPS URL in Stripe Dashboard → Webhooks
```

## Querying Products and Prices

Query Stripe directly via the SDK — no need to mirror products in your database:

```typescript
// List active products with prices
const products = await stripe.products.list({ active: true });
const prices = await stripe.prices.list({ active: true });

// Get a specific product's price
const price = await stripe.prices.retrieve('price_1ABC...');
```

For high-traffic apps that need fast product listings, cache with Redis or an in-memory store. Don't create duplicate product tables.

## Checkout Flow (Frontend)

```typescript
// Redirect to Stripe Checkout
const res = await fetch('/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ priceId: 'price_1ABC...', userId: user.id }),
});
const { url } = await res.json();
window.location.href = url;
```

## Going Live

1. Get live API keys from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
2. Update `.env` with `sk_live_...` and `pk_live_...`
3. Create a webhook endpoint in Stripe Dashboard pointing to your production URL
4. Add the new `whsec_...` as `STRIPE_WEBHOOK_SECRET` in your production environment

## Key Rules

**DO:**
- Create products via Stripe API or Dashboard — never with SQL INSERT
- Use real Stripe price IDs (`price_1ABC...`) in checkout line items
- Register webhook route BEFORE `express.json()` middleware
- Verify webhook signatures with `stripe.webhooks.constructEvent()`
- Store `stripe_customer_id` and `stripe_subscription_id` in your users table

**DO NOT:**
- Create tables to duplicate Stripe products/prices — query the SDK directly
- Use `price_data` in checkout (use real price IDs from seeding)
- Hardcode price amounts in checkout — always reference by price ID
- Expose `STRIPE_SECRET_KEY` to the frontend

## Common Mistakes

**Webhook route ordering:**

```typescript
// WRONG - Webhook after express.json()
app.use(express.json());
app.post('/api/stripe/webhook', ...);  // Body already parsed, signature fails

// CORRECT - Webhook BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handler);
app.use(express.json());
```

**Frontend — must parse JSON:**

```typescript
// WRONG
const response = await fetch('/api/checkout', { method: 'POST', ... });
return response; // Response object, not data

// CORRECT
const response = await fetch('/api/checkout', { method: 'POST', ... });
return await response.json();
```

## References

- `./references/code-templates.md` — Full code templates for Stripe setup. Only read during initial setup.
