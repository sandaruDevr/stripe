import express from 'express';
import cors from 'cors';
import env from './config/env.js';
import corsConfig from './config/cors.js';
import stripeRoutes from './routes/stripe.js';
import { verifyAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { apiLimiter, webhookLimiter } from './middleware/rateLimiter.js';
import { configureSecurityMiddleware } from './middleware/security.js';
import logger from './utils/logger.js';
import { stripe } from './config/stripe.js';
import { db } from './config/firebase.js';

const app = express();

// Security middleware
configureSecurityMiddleware(app);

// CORS - Allow all origins
app.use(cors(corsConfig()));

// Rate limiting
app.use('/api/', apiLimiter);
app.use('/webhooks/', webhookLimiter);

// Parse JSON for all routes except Stripe webhooks
app.use((req, res, next) => {
  if (req.originalUrl === '/webhooks/stripe') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Routes
app.use('/api/stripe', verifyAuth, stripeRoutes);

// Stripe webhook endpoint (no auth required)
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig || '',
      env.STRIPE_WEBHOOK_SECRET
    );

    logger.info('Processing webhook event', { type: event.type });

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        const usersSnapshot = await db.collection('users')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (usersSnapshot.empty) {
          throw new Error('No user found for customer');
        }

        const userId = usersSnapshot.docs[0].id;
        
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

        logger.info('Subscription updated', { userId, subscriptionId: subscription.id });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
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
          logger.info('Subscription deleted', { userId });
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook error:', err);
    return res.status(400).json({ 
      error: {
        message: 'Webhook signature verification failed',
        code: 'WEBHOOK_SIGNATURE_ERROR'
      }
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info('CORS enabled for all origins');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});