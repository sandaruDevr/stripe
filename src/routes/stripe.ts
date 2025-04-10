import express from 'express';
import { stripe, STRIPE_PRO_PLAN_PRICE_ID } from '../config/stripe.js';
import { db } from '../config/firebase.js';
import type { CreateCheckoutSessionBody, CreatePortalSessionBody } from '../types/index.js';
import type { Stripe as StripeType } from 'stripe';

const router = express.Router();

// Create a Stripe Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceId, userId, returnUrl }: CreateCheckoutSessionBody = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (!returnUrl) {
      return res.status(400).json({ error: 'Return URL is required' });
    }

    // Get or create customer
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    let customerId = userData?.stripeCustomerId;
    
    try {
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: {
            userId,
          },
        });
        customerId = customer.id;
        await db.collection('users').doc(userId).update({
          stripeCustomerId: customerId,
        });
      }
    } catch (error) {
      console.error('Error creating/updating customer:', error);
      return res.status(500).json({ error: 'Failed to create or update customer' });
    }

    // Create checkout session
    try {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        subscription_data: {
          trial_period_days: 3,
        },
        success_url: `${returnUrl}?success=true`,
        cancel_url: `${returnUrl}?canceled=true`,
      });

      res.setHeader('Content-Type', 'application/json');
      return res.json({ sessionId: session.id });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return res.status(500).json({ error: 'Failed to create checkout session' });
    }
  } catch (error) {
    console.error('Unexpected error in create-checkout-session:', error);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Create a Stripe Customer Portal Session
router.post('/create-portal-session', async (req, res) => {
  try {
    const { customerId, returnUrl }: CreatePortalSessionBody = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    if (!returnUrl) {
      return res.status(400).json({ error: 'Return URL is required' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    res.setHeader('Content-Type', 'application/json');
    return res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Handle Stripe Webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET || !sig) {
    return res.status(400).json({ error: 'Webhook secret is required' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as StripeType.Subscription;
        const customerId = subscription.customer as string;
        
        // Get user by customer ID
        const usersSnapshot = await db.collection('users')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (usersSnapshot.empty) {
          return res.status(404).json({ error: 'No user found for customer' });
        }

        const userId = usersSnapshot.docs[0].id;
        
        // Update subscription in Firestore
        await db.collection('users').doc(userId).update({
          subscription: {
            subscriptionId: subscription.id,
            priceId: subscription.items.data[0].price.id,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            trialEnd: subscription.trial_end,
          },
          plan: subscription.status === 'active' ? 'pro' : 'free',
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as StripeType.Subscription;
        const customerId = subscription.customer as string;
        
        const usersSnapshot = await db.collection('users')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          const userId = usersSnapshot.docs[0].id;
          await db.collection('users').doc(userId).update({
            'subscription': null,
            'plan': 'free',
          });
        }
        break;
      }
    }

    res.setHeader('Content-Type', 'application/json');
    return res.json({ received: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});

export default router;
