// ─────────────────────────────────────────────────────────────────────────────
// Stripe Service
// Handles Checkout sessions, webhook verification, and refunds.
// No card data ever touches our server — all via Stripe Checkout hosted page.
// ─────────────────────────────────────────────────────────────────────────────

let stripe;

function getStripe() {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
    }
    const Stripe = require('stripe');
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Create a Stripe Checkout Session for a product
 * @param {object} product - product from state
 * @param {number} quantity
 * @param {string} baseUrl - e.g. http://localhost:3001
 * @returns {object} { url, sessionId }
 */
async function createCheckoutSession(product, quantity = 1, baseUrl) {
  const s = getStripe();

  // If product has a Stripe price ID, use it; otherwise use inline price_data
  const lineItem = product.stripe_price_id
    ? { price: product.stripe_price_id, quantity }
    : {
        price_data: {
          currency: process.env.CURRENCY || 'usd',
          product_data: {
            name: product.name,
            description: product.description || '',
            images: product.images && product.images.length ? [product.images[0]] : []
          },
          unit_amount: product.price_cents
        },
        quantity
      };

  const session = await s.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [lineItem],
    mode: 'payment',
    success_url: `${baseUrl}/storefront/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/storefront/index.html`,
    shipping_address_collection: {
      allowed_countries: ['US', 'CA', 'GB', 'AU']
    },
    metadata: {
      product_id: product.id,
      quantity: String(quantity)
    }
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Verify a Stripe webhook signature and return the event
 * @param {Buffer} rawBody
 * @param {string} signature - from Stripe-Signature header
 * @returns {object} Stripe event
 */
function verifyWebhook(rawBody, signature) {
  const s = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return s.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Retrieve a completed checkout session with line items and customer details
 * @param {string} sessionId
 */
async function getCheckoutSession(sessionId) {
  const s = getStripe();
  return s.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'customer_details', 'payment_intent']
  });
}

/**
 * Issue a refund for a payment intent
 * @param {string} paymentIntentId
 * @param {number|null} amountCents - null for full refund
 * @returns {object} Stripe refund object
 */
async function issueRefund(paymentIntentId, amountCents = null) {
  const s = getStripe();
  const params = { payment_intent: paymentIntentId };
  if (amountCents) params.amount = amountCents;
  return s.refunds.create(params);
}

/**
 * Create a Stripe product and price
 * @param {object} localProduct - product from state
 * @returns {object} { stripeProductId, stripePriceId }
 */
async function createStripeProduct(localProduct) {
  const s = getStripe();

  const stripeProduct = await s.products.create({
    name: localProduct.name,
    description: localProduct.description || '',
    images: localProduct.images || [],
    metadata: { local_product_id: localProduct.id }
  });

  const stripePrice = await s.prices.create({
    product: stripeProduct.id,
    unit_amount: localProduct.price_cents,
    currency: process.env.CURRENCY || 'usd'
  });

  return {
    stripeProductId: stripeProduct.id,
    stripePriceId: stripePrice.id
  };
}

module.exports = {
  createCheckoutSession,
  verifyWebhook,
  getCheckoutSession,
  issueRefund,
  createStripeProduct
};
