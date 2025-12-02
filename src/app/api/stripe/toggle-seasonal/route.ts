import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/stripe";
// import { serverEnv } from "@/lib/env.server";
import { PRORATION_BEHAVIOR } from "@/lib/stripe/constants";
import {
  PRICE_BY_PLAN,
  type AccountType,
} from "@/features/payments/stripe/server/prices";
import { serverOnly } from "@/lib/validation/server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



type ProrationBehavior = "always_invoice" | "create_prorations" | "none";

type Body = {
  subscriptionId: string;
  delta: number;               // +/- integer
  proration?: ProrationBehavior;
};

const DEFAULT_PRORATION: ProrationBehavior =
  PRORATION_BEHAVIOR ?? "create_prorations";

export async function POST(req: Request) {
  serverOnly();
  const stripe = getStripe();

  try {
    const body = (await req.json()) as Partial<Body>;
    const { subscriptionId, delta, proration } = body ?? {};
    if (
      !subscriptionId ||
      typeof subscriptionId !== "string" ||
      typeof delta !== "number" ||
      !Number.isFinite(delta)
    ) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const proration_behavior: ProrationBehavior = proration ?? DEFAULT_PRORATION;

    // Retrieve subscription with expanded price info
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });

    const account: AccountType =
      sub.metadata?.signup_account_type === "business"
        ? "business"
        : "individual";
    const priceMap = PRICE_BY_PLAN[account];

    const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
    const seasonalItem = items.find(
      (item) => (item.price as Stripe.Price)?.id === priceMap.seasonal_2nd
    );

    const currentQty = seasonalItem?.quantity ?? 0;
    const newQty = Math.max(0, currentQty + delta);

    let updated = false;

    if (seasonalItem) {
      if (newQty === 0) {
        // Remove or set quantity to 0
        await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: seasonalItem.id, quantity: 0 }],
          proration_behavior,
        });
      } else {
        await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: seasonalItem.id, quantity: newQty }],
          proration_behavior,
        });
      }
      updated = true;
    } else if (newQty > 0) {
      // Add new seasonal item
      await stripe.subscriptions.update(subscriptionId, {
        items: [
          { price: priceMap.seasonal_2nd, quantity: newQty },
        ],
        proration_behavior,
      });
      updated = true;
    }
    return NextResponse.json({ subscriptionId, seasonalQuantity: newQty, updated });
  } catch (error) {
    console.error("toggle-seasonal error", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
