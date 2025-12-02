// src/lib/env.server.ts
import { z } from "zod";

// Define the shape once
const ServerEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1, "Missing STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "Missing STRIPE_WEBHOOK_SECRET"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

// Lazy, memoized validator — called only when explicitly asked for
let _cached: z.infer<typeof ServerEnvSchema> | null = null;

export function getServerEnv() {
  if (_cached) return _cached;
  const parsed = ServerEnvSchema.safeParse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.message).join(", ");
    throw new Error(`Missing server env vars: ${missing}`);
  }
  _cached = parsed.data;
  return _cached;
}

// Narrow helpers — only validate the single key needed
export function requireStripeKey() {
  const v = process.env.STRIPE_SECRET_KEY;
  if (!v) throw new Error("Missing STRIPE_SECRET_KEY");
  return v;
}

export function requireWebhookSecret() {
  const v = process.env.STRIPE_WEBHOOK_SECRET;
  if (!v) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  return v;
}
