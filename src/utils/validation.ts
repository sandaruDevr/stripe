import { z } from 'zod';

export const createCheckoutSessionSchema = z.object({
  priceId: z.string().min(1),
  userId: z.string().min(1),
  returnUrl: z.string().url()
});

export const createPortalSessionSchema = z.object({
  customerId: z.string().min(1),
  returnUrl: z.string().url()
});

export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;
export type CreatePortalSessionInput = z.infer<typeof createPortalSessionSchema>;