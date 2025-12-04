import type Stripe from "stripe";
import {
  PRICE_BY_PLAN,
  type AccountType,
} from "@/features/payments/stripe/server/prices";
import { buildSeasonalTimeline, readAddrRulesFromMeta } from "@/lib/stripe/phaseBuilder";
import { NINETY_DAYS_SEC } from "./constants";
import { nextMonthFirstEpoch } from "../date/utcMonth";

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
  
  // If schedule already exists, don't rebuild it - preserve what was created during signup
  if (sub.schedule) {
    const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id;
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    console.log("[WH] schedule already exists:", scheduleId, "with", schedule.phases?.length, "phases - skipping rebuild");
    
    // Just mark as attached if not already
    if (sub.metadata?.schedule_attached !== "1") {
      await stripe.subscriptions.update(subId, {
        metadata: {
          ...sub.metadata,
          schedule_attached: "1",
          schedule_id: scheduleId,
        },
      });
    }
    return;
  }
  
  if (sub.metadata?.schedule_attached === "1") {
    console.log("[WH] schedule already attached per metadata, skipping");
    return;
  }
  
  console.log("[WH] No schedule found, creating via webhook");
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
  // Check if user actually selected seasonal service by looking at addr_rules
  // If any address has a secondary day (s != -1), they selected seasonal service
  const userSelectedSeasonal = initialAddrRules.some((rule) => rule.s !== -1);
  console.log("[WH] User selected seasonal service:", userSelectedSeasonal);

  // Get the current phase start date
  const currentStart = preservedCurrent && typeof preservedCurrent.start_date === "number"
    ? preservedCurrent.start_date
    : Math.floor(Date.now() / 1000);

  // Build the complete timeline just like signup does
  // This creates slices at every month boundary within seasonal windows
  const windows: Array<{ start: number; end: number }> = [];
  
  if (userSelectedSeasonal) {
    // Extract all seasonal windows from addr_rules
    for (const rule of initialAddrRules) {
      if (rule.s !== -1 && rule.ss > 0 && rule.se > rule.ss) {
        windows.push({ start: rule.ss, end: rule.se });
      }
    }
  }

  console.log("[WH] Found seasonal windows:", windows.length);

  let segments: Array<{ start: number; end: number; qty: number }> = [];

  if (windows.length > 0) {
    const rawEdges = windows.flatMap((w) => [w.start, w.end]);
    const minStart = Math.min(...windows.map((w) => w.start));
    const maxEnd = Math.max(...windows.map((w) => w.end));
    
    console.log("[WH] Window range:", new Date(minStart * 1000).toISOString(), "to", new Date(maxEnd * 1000).toISOString());
    
    // Get month boundaries between min and max (same as buildTimeline)
    const monthEdges: number[] = [];
    let cursor = minStart;
    const endLimit = maxEnd;
    while (cursor < endLimit) {
      monthEdges.push(cursor);
      cursor = nextMonthFirstEpoch(cursor);
    }
    
    const boundaries = Array.from(new Set([...rawEdges, ...monthEdges])).sort(
      (a, b) => a - b
    );

    const slices: Array<{ start: number; end: number; qty: number }> = [];
    for (let i = 0; i < boundaries.length - 1; ++i) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (start >= end) continue;
      const qty = windows.filter((w) => w.start <= start && w.end >= end).length;
      slices.push({ start, end, qty });
    }
    
    console.log("[WH] All slices created:", slices.length);
    
    // Only include slices that end after the current start
    segments = slices.filter((s) => s.end > currentStart);
    console.log("[WH] Slices ending after currentStart:", segments.length);
  }
  
  console.log("[WH] Total segments after filtering:", segments.length);
  
  // Consolidate consecutive segments with same qty into single phases to stay under 10-phase limit
  const consolidatedSegments: Array<{ start: number; end: number; qty: number }> = [];
  for (const seg of segments) {
    const last = consolidatedSegments[consolidatedSegments.length - 1];
    if (last && last.qty === seg.qty && last.end === seg.start) {
      // Merge with previous segment
      last.end = seg.end;
    } else {
      // New segment
      consolidatedSegments.push({ ...seg });
    }
  }
  
  console.log("[WH] Consolidated segments:", consolidatedSegments.length);
  
  // Convert consolidated segments to phases
  const phases: PhaseUpdate[] = consolidatedSegments.map((seg, idx) => {
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
    // First phase needs start_date to anchor the schedule
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
  console.log("[WH] Applying phases to schedule:", {
    scheduleId: scheduleObj.id,
    phaseCount: phases.length,
    phases: phases.map((p, idx) => ({
      index: idx,
      hasStartDate: !!p.start_date,
      hasEndDate: !!p.end_date,
      itemCount: p.items?.length || 0,
      items: p.items?.map(i => ({ price: i.price, qty: i.quantity }))
    }))
  });
  
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
