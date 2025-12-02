// src/lib/stripe.ts
import Stripe from "stripe";
import { requireStripeKey } from "@/lib/env/env.server";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function getStripe() {
  if (!globalForStripe.stripe) {
    globalForStripe.stripe = new Stripe(requireStripeKey(), {
      apiVersion: "2025-07-30.basil", // or omit to use account default
    });
  }
  return globalForStripe.stripe;
}

export type { Stripe };
