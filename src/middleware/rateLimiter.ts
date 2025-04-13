import rateLimit from 'express-rate-limit';
import env from '../config/env';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 100 : 0, // Limit each IP to 100 requests per windowMs
  message: {
    error: {
      message: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: env.NODE_ENV === 'production' ? 50 : 0,
  message: {
    error: {
      message: 'Too many webhook requests',
      code: 'WEBHOOK_RATE_LIMIT_EXCEEDED'
    }
  }
});