"use client";
import { loadStripe } from "@stripe/stripe-js";
import { clientEnv } from "@/lib/env/env.client";

export const stripePromise = loadStripe(clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
