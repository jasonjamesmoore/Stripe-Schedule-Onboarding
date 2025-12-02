import type Stripe from "stripe";
import {
  PRICE_BY_PLAN,
  type AccountType,
} from "@/features/payments/stripe/server/prices";
import { buildSeasonalTimeline, readAddrRulesFromMeta } from "@/lib/stripe/phaseBuilder";

type PhaseUpdate = Stripe.SubscriptionScheduleUpdateParams.Phase & {
  iterations?: number;
};

export const hasIterations = (p: { iterations?: unknown }): boolean =>
  typeof p.iterations === "number";

/**
 * Only attach/update a schedule if not already attached per metadata or Stripe.
 */
export async function ensureScheduleAttached(subId: string, stripe: Stripe) {
  const sub = await stripe.subscriptions.retrieve(subId, {
    expand: ["schedule"],
  });
  if (sub.metadata?.schedule_attached === "1" || sub.schedule) {
    console.log("[WH] schedule already attached, skipping");
    return;
  }
  await upsertScheduleFromSubscription(subId, stripe);
}

/**
 * Create a schedule from a subscription, preserve the current phase verbatim,
 * then append future phases (optional base gap → bounded in-season → open-ended base tail).
 * Ensures exactly one open-ended base-only phase at the end.
 */
export async function upsertScheduleFromSubscription(
  subId: string,
  stripe: Stripe
) {
  console.log("[WH] upsertScheduleFromSubscription start:", subId);

  const sub = (await stripe.subscriptions.retrieve(subId, {
    expand: ["schedule"],
  })) as Stripe.Subscription & { metadata?: Record<string, string> };

  console.log("[WH] sub.status:", sub.status, "has schedule?", !!sub.schedule);
  console.log("[WH] sub.metadata:", JSON.stringify(sub.metadata, null, 2));
  const initialAddrRules = readAddrRulesFromMeta(sub.metadata);
  console.log("[WH] addrRules:", JSON.stringify(initialAddrRules, null, 2));
  console.log("[WH] schedule_attached:", sub.metadata?.schedule_attached);

  if (sub.metadata?.schedule_attached === "1") {
    console.log("[WH] schedule already attached, skipping");
    return;
  }
  if (sub.schedule) return;

  // Determine which price map to use (business vs individual)
  const account: AccountType =
    sub.metadata?.signup_account_type === "business"
      ? "business"
      : "individual";
  const priceMap = PRICE_BY_PLAN[account];
  const BASE_PRICE: string = priceMap.trash;
  const SEASONAL_PRICE: string = priceMap.seasonal_2nd;

  // Reconstruct phases using addr_rules and timeline logic
  if (!initialAddrRules.length) {
    console.warn("[WH] No addr_rules found on subscription; cannot build schedule phases");
    return;
  }
  // Retrieve preservedCurrent from schedule
  let preservedCurrent: Stripe.SubscriptionSchedule.Phase | undefined;
  let scheduleObj: Stripe.SubscriptionSchedule | undefined =
    sub.schedule && typeof sub.schedule === "object"
      ? (sub.schedule as unknown as Stripe.SubscriptionSchedule)
      : undefined;
  if (scheduleObj && Array.isArray(scheduleObj.phases) && scheduleObj.phases.length > 0) {
    preservedCurrent = scheduleObj.phases[0];
  } else {
    // If no schedule, create one and retrieve current phase
    let createdSchedule: Stripe.SubscriptionSchedule;
    try {
      createdSchedule = await stripe.subscriptionSchedules.create(
        { from_subscription: subId }
      );
    } catch (err) {
      console.error("[WH] schedule.create ERROR:", (err as Error)?.message, err);
      return;
    }
    const fresh = await stripe.subscriptionSchedules.retrieve(
      createdSchedule.id,
      { expand: ["phases"] }
    );
    preservedCurrent = fresh.phases?.[0];
    if (!preservedCurrent || typeof preservedCurrent.start_date !== "number") {
      throw new Error("Schedule has no current phase with a numeric start_date");
    }
    // Continue with created schedule
    scheduleObj = fresh;
  }
  let preservedBaseQty = 1;
  if (preservedCurrent && Array.isArray(preservedCurrent.items)) {
    for (const item of preservedCurrent.items) {
      if (typeof item.price === "string" && item.price === BASE_PRICE && typeof item.quantity === "number") {
        preservedBaseQty = item.quantity;
        break;
      }
    }
  }
  // Check if user actually selected seasonal service
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  let userSelectedSeasonal = false;
  
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer && !customer.deleted && customer.metadata) {
        // Check for service_addresses metadata
        const serviceAddressesJson = customer.metadata.service_addresses || 
                                    customer.metadata.service_addresses_1 || "[]";
        const serviceAddresses = JSON.parse(serviceAddressesJson);
        userSelectedSeasonal = serviceAddresses.some((addr: { seasonal_selected?: boolean }) => addr.seasonal_selected === true);
        console.log("[WH] User selected seasonal service:", userSelectedSeasonal);
      }
    } catch (err) {
      console.warn("[WH] Could not retrieve customer seasonal selections:", err);
    }
  }

  // Build timeline segments from addrRules and current phase start
  // Only create seasonal segments if user actually selected seasonal service
  const segments = preservedCurrent && typeof preservedCurrent.start_date === "number" && userSelectedSeasonal
    ? buildSeasonalTimeline(initialAddrRules, preservedCurrent.start_date)
    : [];
  // Convert segments to phases
  const phases: PhaseUpdate[] = segments.map((seg, idx) => {
    const phase: PhaseUpdate = {
      items:
        seg.qty > 0
          ? [
              { price: BASE_PRICE, quantity: preservedBaseQty },
              { price: SEASONAL_PRICE, quantity: seg.qty },
            ]
          : [{ price: BASE_PRICE, quantity: preservedBaseQty }],
      end_date: seg.end,
      proration_behavior: "create_prorations",
    };
    // Ensure the first phase has a start_date
    if (idx === 0 && preservedCurrent && typeof preservedCurrent.start_date === "number") {
      phase.start_date = preservedCurrent.start_date;
    }
    return phase;
  });

  // Always ensure we have at least one phase and that the last phase is open-ended
  if (segments.length === 0 && preservedCurrent && typeof preservedCurrent.start_date === "number") {
    // No seasonal segments: create a single open-ended base-only phase
    phases.push({
      items: [{ price: BASE_PRICE, quantity: preservedBaseQty }],
      start_date: preservedCurrent.start_date,
      proration_behavior: "create_prorations"
      // No end_date = open-ended
    });
  } else {
    // With seasonal segments: append open-ended base-only phase after all seasonal phases
    phases.push({
      items: [{ price: BASE_PRICE, quantity: preservedBaseQty }],
      proration_behavior: "create_prorations"
      // No end_date = open-ended
    });
  }

  // Apply the phases to the schedule
  try {
    await stripe.subscriptionSchedules.update(scheduleObj.id, {
      phases,
    });

    // Mark subscription: schedule attached
    try {
      await stripe.subscriptions.update(subId, {
        metadata: {
          ...sub.metadata,
          schedule_attached: "1",
          schedule_status: "attached",
          schedule_id: scheduleObj.id,
        },
      });
    } catch (err) {
      console.warn(
        "[WH] subscription.update metadata WARN:",
        (err as Error)?.message
      );
    }

    console.log("schedule attached & updated", {
      subscriptionId: subId,
      scheduleId: scheduleObj.id,
    });
  } catch (err) {
    console.error("[WH] schedule.update ERROR:", (err as Error)?.message, err);
  }
}
