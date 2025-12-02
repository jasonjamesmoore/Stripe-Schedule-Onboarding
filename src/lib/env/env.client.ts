import { z } from "zod";

const ClientEnvSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1, "Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
});

export const clientEnv = ClientEnvSchema.parse({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
});
