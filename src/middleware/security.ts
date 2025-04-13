import helmet from 'helmet';
import { Express } from 'express';

export const configureSecurityMiddleware = (app: Express) => {
  // Basic security headers
  app.use(helmet());

  // HSTS
  app.use(helmet.hsts({
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }));

  // Prevent clickjacking
  app.use(helmet.frameguard({ action: 'deny' }));

  // XSS protection
  app.use(helmet.xssFilter());

  // Disable MIME type sniffing
  app.use(helmet.noSniff());

  // Hide X-Powered-By header
  app.disable('x-powered-by');
};