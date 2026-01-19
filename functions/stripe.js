'use strict';

const Stripe = require('stripe');

/**
 * Stripe client factory
 * - Firebase Functions の環境変数/Secrets で STRIPE_SECRET_KEY を渡す想定
 */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

/**
 * Create Checkout Session
 * @param {Object} params
 * @param {string} params.priceId Stripe Price ID (prod)
 * @param {string} params.customerEmail optional
 * @param {string} params.successUrl required
 * @param {string} params.cancelUrl required
 * @returns {Promise<{id:string, url:string}>}
 */
async function createCheckoutSession(params) {
  const stripe = getStripe();

  const {
    priceId,
    customerEmail,
    successUrl,
    cancelUrl,
  } = params || {};

  if (!priceId) throw new Error('Missing priceId');
  if (!successUrl) throw new Error('Missing successUrl');
  if (!cancelUrl) throw new Error('Missing cancelUrl');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    allow_promotion_codes: true,
  });

  return { id: session.id, url: session.url };
}

/**
 * Create Billing Portal Session
 * @param {Object} params
 * @param {string} params.customerId Stripe Customer ID
 * @param {string} params.returnUrl required
 * @returns {Promise<{url:string}>}
 */
async function createBillingPortalSession(params) {
  const stripe = getStripe();

  const { customerId, returnUrl } = params || {};
  if (!customerId) throw new Error('Missing customerId');
  if (!returnUrl) throw new Error('Missing returnUrl');

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Webhook handler (raw body needed)
 * @param {Buffer|string} rawBody
 * @param {string} signature Stripe-Signature header
 * @returns {{event:any}}
 */
function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  }
  if (!signature) {
    throw new Error('Missing Stripe-Signature');
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  return { event };
}

module.exports = {
  createCheckoutSession,
  createBillingPortalSession,
  constructWebhookEvent,
};
