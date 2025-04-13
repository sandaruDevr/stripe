import express from 'express';
import { stripe, STRIPE_PRO_PLAN_PRICE_ID } from '../config/stripe.js';
import { db } from '../config/firebase.js';
import { ValidationError, StripeError } from '../utils/errors.js';
import { createCheckoutSessionSchema, createPortalSessionSchema } from '../utils/validation.js';
import logger from '../utils/logger.js';
import type { CreateCheckoutSessionInput, CreatePortalSessionInput } from '../utils/validation.js';
import type { Stripe } from 'stripe';

const router = express.Router();

// Create a Stripe Checkout Session
router.post('/create-checkout-session', async (req, res, next) => {
  try {
    const input = createCheckoutSessionSchema.parse(req.body);
    logger.info('Creating checkout session', { userId: input.userId });

    // Get or create customer
    const userDoc = await db.collection('users').doc(input.userId).get();
    
    if (!userDoc.exists) {
      throw new ValidationError('User not found');
    }
    
    const userData = userDoc.data();
    let customerId = userData?.stripeCustomerId;
    
    try {
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { userId: input.userId },
        });
        customerId = customer.id;
        await db.collection('users').doc(input.userId).update({
          stripeCustomerId: customerId,
        });
      }
    } catch (error) {
      logger.error('Error creating/updating customer:', error);
      throw new StripeError('Failed to create or update customer');
    }

    // Create checkout session
    try {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: input.priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        subscription_data: {
          trial_period_days: 3,
        },
        success_url: `${input.returnUrl}?success=true`,
        cancel_url: `${input.returnUrl}?canceled=true`,
      });

      logger.info('Checkout session created', { sessionId: session.id });
      return res.json({ sessionId: session.id });
    } catch (error) {
      logger.error('Error creating checkout session:', error);
      throw new StripeError('Failed to create checkout session');
    }
  } catch (error) {
    next(error);
  }
});

// Create a Stripe Customer Portal Session
router.post('/create-portal-session', async (req, res, next) => {
  try {
    const input = createPortalSessionSchema.parse(req.body);
    logger.info('Creating portal session', { customerId: input.customerId });

    const session = await stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });

    return res.json({ url: session.url });
  } catch (error) {
    next(error);
  }
});

export default router;