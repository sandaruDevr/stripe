import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import stripeRoutes from './routes/stripe.js';
import { verifyAuth } from './middleware/auth.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'], // Added OPTIONS explicitly
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'], // Added Accept header
  exposedHeaders: ['Content-Type', 'Authorization'], // Expose necessary headers
}));

// Parse JSON for all routes except Stripe webhooks
app.use((req, res, next) => {
  if (req.originalUrl === '/stripe/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Enable pre-flight requests for all routes
app.options('*', cors());

// Routes
app.use('/stripe', verifyAuth, stripeRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS enabled for origin: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
});
