// ---- addr_rules decoding ----
// Shape: [{ c: city, z: zip, b: baseDay, s: secondaryDay|-1, ss: startUTC|-1, se: endUTC|-1 }]
export type AddrRuleCompact = {
  c: string;
  z: string;
  b: number;
  s: number;
  ss: number;
  se: number;
};

export function readAddrRulesFromMeta(
  meta?: Record<string, string>
): AddrRuleCompact[] {
  if (!meta) return [];
  const keys = Object.keys(meta)
    .filter((k) => k === "addr_rules" || /^addr_rules_\d+$/.test(k))
    .sort((a, b) => {
      if (a === "addr_rules") return -1;
      if (b === "addr_rules") return 1;
      const na = parseInt(a.split("_")[2] || "0", 10);
      const nb = parseInt(b.split("_")[2] || "0", 10);
      return na - nb;
    });
  const rules: AddrRuleCompact[] = [];
  for (const k of keys) {
    try {
      const arr = JSON.parse(meta[k]!);
      if (Array.isArray(arr)) {
        for (const r of arr) {
          rules.push({
            c: r.c,
            z: r.z,
            b: typeof r.b === "number" ? r.b : Number(r.b),
            s: typeof r.s === "number" ? r.s : Number(r.s),
            ss: typeof r.ss === "number" ? r.ss : Number(r.ss),
            se: typeof r.se === "number" ? r.se : Number(r.se),
          });
        }
      }
    } catch {}
  }
  return rules;
}

export function buildSeasonalTimeline(
  addrRules: AddrRuleCompact[],
  refStart: number
) {
  // Each addrRule with s != -1 and valid ss/se is a seasonal window
  const windows = addrRules
    .filter((r) => r.s !== -1 && r.ss > 0 && r.se > r.ss)
    .map((r) => ({ start: r.ss, end: r.se }));
  if (windows.length === 0) return [];
  const rawEdges = windows.flatMap((w) => [w.start, w.end]);
  const minStart = Math.min(...windows.map((w) => w.start));
  const maxEnd = Math.max(...windows.map((w) => w.end));
  const monthEdges = monthStartsBetween(minStart, maxEnd);
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
  // Only include slices that start after the anchor
  return slices.filter((s) => s.end > refStart);
}
// Simple hash function for metadata (not cryptographically secure)
function phasesHash(phases: PhaseWithDuration[]): string {
  const str = JSON.stringify(phases);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36); // base36 for compactness
}
import type Stripe from "stripe";
import {
  monthsBetweenEpochs,
  nextMonthFirstEpoch,
  monthStartsBetween,
} from "../date/utcMonth";
import { seasonWindowsForAddress } from "../season/windows";
import { NINETY_DAYS_SEC } from "../stripe/constants";

export type PhaseWithDuration =
  Stripe.SubscriptionScheduleCreateParams.Phase & {
    duration?: { interval: "month"; interval_count: number };
  };

type TimelineSlice = {
  start: number;
  end: number;
  seasonalActiveCount: number;
};

function buildTimeline(
  services: Array<Record<string, unknown>>,
  selections: Array<{ seasonal_2nd?: boolean }>,
  refEpoch: number
): TimelineSlice[] {
  const windows: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < services.length; ++i) {
    if (selections[i]?.seasonal_2nd) {
      for (const win of seasonWindowsForAddress(services[i], refEpoch)) {
        windows.push(win);
      }
    }
  }
  if (windows.length === 0) return [];

  const rawEdges = windows.flatMap((w) => [w.start, w.end]);
  const minStart = Math.min(...windows.map((w) => w.start));
  const maxEnd = Math.max(...windows.map((w) => w.end));
  const monthEdges = monthStartsBetween(minStart, maxEnd);

  const boundaries = Array.from(new Set([...rawEdges, ...monthEdges])).sort(
    (a, b) => a - b
  );

  const slices: TimelineSlice[] = [];
  for (let i = 0; i < boundaries.length - 1; ++i) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (start >= end) continue;
    const count = windows.filter(
      (w) => w.start <= start && w.end >= end
    ).length;
    // Always create a new slice at every boundary, even if the count does not change
    slices.push({ start, end, seasonalActiveCount: count });
  }
  return slices;
}

function timelineToPhases(
  timeline: TimelineSlice[],
  baseQty: number,
  priceIds: { base: string; seasonal: string },
  prorationBehavior: "create_prorations" | "none" | "always_invoice"
): PhaseWithDuration[] {
  return timeline.map((slice) => {
    const items: Stripe.SubscriptionScheduleCreateParams.Phase.Item[] = [
      { price: priceIds.base, quantity: baseQty },
    ];
    if (slice.seasonalActiveCount > 0) {
      items.push({
        price: priceIds.seasonal,
        quantity: slice.seasonalActiveCount,
      });
    }
    const months = monthsBetweenEpochs(slice.start, slice.end);
    return months > 0
      ? {
          duration: { interval: "month", interval_count: months },
          items,
          proration_behavior: prorationBehavior,
        }
      : { end_date: slice.end, items, proration_behavior: prorationBehavior };
  });
}

/**
 * Build all phases for signup:
 * - Prepend stub phase [now → next 1st], including seasonal qty overlapping the remainder of this month.
 * - Include only seasonal phases that START within the next 90 days from next 1st.
 * - Ensure exactly one terminal open-ended base-only phase.
 */
export function buildSignupPhases(opts: {
  services: Array<Record<string, unknown>>;
  selections: Array<{ seasonal_2nd?: boolean }>;
  nowEpoch: number;
  priceIds: { base: string; seasonal: string };
  prorationBehavior: "create_prorations" | "none" | "always_invoice";
}): {
  phases: PhaseWithDuration[];
  nextFirst: number;
  baseQty: number;
  phases_idem: string;
} {
  const { services, selections, nowEpoch, priceIds, prorationBehavior } = opts;

  const baseQty = services.length;
  const nextFirst = nextMonthFirstEpoch(nowEpoch);
  
  // Debug logging to trace the seasonal pricing issue
  console.log("[PHASE] buildSignupPhases debug:");
  console.log("[PHASE] services.length:", services.length);
  console.log("[PHASE] selections:", JSON.stringify(selections, null, 2));
  console.log("[PHASE] nowEpoch:", nowEpoch, "nextFirst:", nextFirst);
  
  const fullTimeline = buildTimeline(services, selections, nowEpoch);
  console.log("[PHASE] fullTimeline.length:", fullTimeline.length);
  console.log("[PHASE] fullTimeline slices:", fullTimeline.map(s => ({ 
    start: new Date(s.start * 1000).toISOString(), 
    end: new Date(s.end * 1000).toISOString(), 
    count: s.seasonalActiveCount 
  })));

  // seasonal windows that START within 180 days from next 1st (inclusive)
  const lookbackEnd = nextFirst + NINETY_DAYS_SEC;
  console.log("[PHASE] Filter range: nextFirst:", new Date(nextFirst * 1000).toISOString(), 
              "to lookbackEnd:", new Date(lookbackEnd * 1000).toISOString());
  
  const timelineAfter = fullTimeline.filter(
    (s) => s.start >= nextFirst && s.start <= nextFirst + NINETY_DAYS_SEC
  );

  console.log("[PHASE] timelineAfter.length:", timelineAfter.length);
  console.log("timelineAfter:", JSON.stringify(timelineAfter, null, 2));

  // seasonal qty overlapping the pre-phase [now, nextFirst)
  const seasonalPreQty = services.reduce((acc, _svc, i) => {
    console.log(`[PHASE] Service ${i}: seasonal_2nd selected:`, selections[i]?.seasonal_2nd);
    if (!selections[i]?.seasonal_2nd) return acc;
    const overlaps = seasonWindowsForAddress(services[i], nowEpoch).some(
      (w) => w.start < nextFirst && w.end > nowEpoch
    );
    console.log(`[PHASE] Service ${i}: seasonal windows overlap pre-phase:`, overlaps);
    return overlaps ? acc + 1 : acc;
  }, 0);

  console.log("[PHASE] seasonalPreQty result:", seasonalPreQty);

  const phases: PhaseWithDuration[] = [];

  // Always prepend the pre-phase [now → nextFirst]
  if (nextFirst > nowEpoch) {
    const preItems: Stripe.SubscriptionScheduleCreateParams.Phase.Item[] = [
      { price: priceIds.base, quantity: baseQty },
    ];
    if (seasonalPreQty > 0) {
      preItems.push({ price: priceIds.seasonal, quantity: seasonalPreQty });
    }
    phases.push({
      end_date: nextFirst,
      items: preItems,
      proration_behavior: prorationBehavior,
    });
  }
  // For each timeline slice after the anchor, create a phase
  for (const slice of timelineAfter) {
    // Only include slices that start after the anchor
    if (slice.start >= nextFirst) {
      const items: Stripe.SubscriptionScheduleCreateParams.Phase.Item[] = [
        { price: priceIds.base, quantity: baseQty },
      ];
      if (slice.seasonalActiveCount > 0) {
        items.push({
          price: priceIds.seasonal,
          quantity: slice.seasonalActiveCount,
        });
      }
      phases.push({
        end_date: slice.end,
        items,
        proration_behavior: prorationBehavior,
      });
    }
  }
  // Append open-ended base-only phase
  phases.push({
    items: [{ price: priceIds.base, quantity: baseQty }],
    proration_behavior: prorationBehavior,
  });

  // prepend pre-phase [now → nextFirst]
  if (nextFirst > nowEpoch) {
    const preItems: Stripe.SubscriptionScheduleCreateParams.Phase.Item[] = [
      { price: priceIds.base, quantity: baseQty },
    ];
    if (seasonalPreQty > 0) {
      preItems.push({ price: priceIds.seasonal, quantity: seasonalPreQty });
    }
    phases.unshift({
      end_date: nextFirst,
      items: preItems,
      proration_behavior: prorationBehavior,
    });

    // append open-ended base tail if the next seasonal start is not within 90d of the built tail
    const stepMonths = (startSec: number, n: number) => {
      let c = startSec;
      for (let i = 0; i < n; i++) c = nextMonthFirstEpoch(c);
      return c;
    };

    let cursorEnd = nextFirst;
    for (const p of phases) {
      if (typeof p.end_date === "number") cursorEnd = p.end_date;
      else if (
        p.duration?.interval === "month" &&
        typeof p.duration.interval_count === "number"
      ) {
        cursorEnd = stepMonths(cursorEnd, p.duration.interval_count);
      } else {
        cursorEnd = nextMonthFirstEpoch(cursorEnd);
      }
    }

    let earliestSeasonalStart: number | undefined;
    for (let i = 0; i < services.length; i++) {
      if (!selections[i]?.seasonal_2nd) continue;
      for (const win of seasonWindowsForAddress(services[i], nowEpoch)) {
        if (win.start >= cursorEnd) {
          if (
            earliestSeasonalStart === undefined ||
            win.start < earliestSeasonalStart
          ) {
            earliestSeasonalStart = win.start;
          }
        }
      }
    }
    const seasonalStartsSoon =
      typeof earliestSeasonalStart === "number" &&
      earliestSeasonalStart - cursorEnd <= NINETY_DAYS_SEC;

    const last = phases[phases.length - 1];
    const lastIsOpenEnded =
      last && typeof last.end_date !== "number" && !last.duration;
    if (!lastIsOpenEnded && !seasonalStartsSoon) {
      phases.push({
        items: [{ price: priceIds.base, quantity: baseQty }],
        proration_behavior: prorationBehavior,
      });
    }
  }

  // ensure exactly one terminal open-ended base-only phase
  {
    const last = phases[phases.length - 1];
    const lastIsOpenEnded =
      last && typeof last.end_date !== "number" && !last.duration;
    if (!lastIsOpenEnded) {
      phases.push({
        items: [{ price: priceIds.base, quantity: baseQty }],
        proration_behavior: prorationBehavior,
      });
    }
  }

  // Provide a compact hash/id for metadata
  const phases_idem = phasesHash(phases);
  return { phases, nextFirst, baseQty, phases_idem };
}
