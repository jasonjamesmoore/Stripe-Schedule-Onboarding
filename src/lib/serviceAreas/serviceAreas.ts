// Minimal “in-code DB” for now. Supabase later.
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0
export const DOW = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
} as const;

export type AreaRule = {
  city?: string; // case-insensitive exact match
  zipPrefix?: string; // longest prefix wins, e.g. "284" or "28401"
  baseDay: Weekday; // e.g., 1 = Monday
  secondaryDay?: Weekday; // optional
  season?: {
    // optional (for seasonal add-on)
    startUTC: number; // epoch seconds (UTC)
    endUTC: number; // epoch seconds (UTC, exclusive)
  };
  note?: string;
};

// === EDIT THESE RULES as needed ===

export const AREA_RULES: AreaRule[] = [
  {
    city: "Topsail Beach",
    baseDay: DOW.Mon, // Mon
    secondaryDay: DOW.Thu, // Thurs
    season: {
      startUTC: Date.UTC(2025, 4, 26, 0, 0, 0) / 1000, // May 26, 2025 00:00 UTC
      endUTC: Date.UTC(2025, 8, 1, 0, 0, 0) / 1000, // Sept 1, 2025 00:00 UTC
    },
  },
  // {
  //   city: "South Surf City",
  //   baseDay: DOW.Mon, // Mon
  //   secondaryDay: DOW.Fri, // Fri
  //   season: {
  //     startUTC: Date.UTC(2025, 4, 1, 0, 0, 0) / 1000, // May 1
  //     endUTC: Date.UTC(2025, 8, 30, 0, 0, 0) / 1000, // Sept 30
  //   },
  // },
  {
    city: "Surf City",
    baseDay: DOW.Tue, // Tues
    secondaryDay: DOW.Fri, // Fri
    season: {
      startUTC: Date.UTC(2025, 4, 1, 0, 0, 0) / 1000, // May 1
      endUTC: Date.UTC(2025, 8, 30, 0, 0, 0) / 1000, // Sept 30
    },
  },
  {
    city: "North Topsail Beach",
    baseDay: DOW.Wed,
    secondaryDay: DOW.Sat,
    season: {
      startUTC: Date.UTC(2025, 4, 2, 0, 0, 0) / 1000,
      endUTC: Date.UTC(2025, 9, 26, 0, 0, 0) / 1000,
    },
  },
  {
    city: "Wilmington",
    zipPrefix: "28401", // city wins; this is just to show prefix
    baseDay: DOW.Tue,
  },
  // Fallback by ZIP prefix (example)
  { zipPrefix: "284", baseDay: DOW.Tue }, // generic coastal area, no seasonal
];

export type Address = {
  line1: string;
  city: string;
  state: string;
  zip: string; // "28401"
};

export type AddressRuleResult = {
  baseDay: Weekday;
  secondaryDay?: Weekday;
  season?: { startUTC: number; endUTC: number };
  matchedBy: "city" | "zipPrefix";
  ruleNote?: string;
};

const norm = (s: string) => s.trim().toLowerCase();

export function resolveRuleForAddress(
  addr: Address,
  rules: AreaRule[] = AREA_RULES
): AddressRuleResult | null {
  const city = norm(addr.city);
  // 1) city exact (case-insensitive)
  const byCity = rules.find((r) => r.city && norm(r.city) === city);
  if (byCity) {
    return {
      baseDay: byCity.baseDay,
      secondaryDay: byCity.secondaryDay,
      season: byCity.season,
      matchedBy: "city",
      ruleNote: byCity.note,
    };
  }

  // 2) zip prefix (longest wins)
  const cleanZip = (z: string) => (z || "").trim().slice(0, 5);
  const zip = cleanZip(addr.zip);
  const byZip = rules
    .filter((r) => r.zipPrefix && zip.startsWith(r.zipPrefix))
    .sort((a, b) => b.zipPrefix!.length - a.zipPrefix!.length)[0];

  if (byZip) {
    return {
      baseDay: byZip.baseDay,
      secondaryDay: byZip.secondaryDay,
      season: byZip.season,
      matchedBy: "zipPrefix",
      ruleNote: byZip.note,
    };
  }

  return null;
}

// Helper: get the next seasonal window for an address relative to a reference time.
// If no season is set, return null and let existing global logic handle it.
export function nextSeasonWindowForAddress(
  addr: Address,
  refUTCsec: number
): { start: number; end: number } | null {
  const res = resolveRuleForAddress(addr);
  if (!res?.season) return null;

  const { startUTC, endUTC } = res.season;

  // If the season is in the future relative to ref, return that window.
  if (refUTCsec < endUTC) {
    // If already within the season, “next” is current remainder.
    const start = Math.max(startUTC, refUTCsec);
    return { start, end: endUTC };
  }

  // If this is an annual season, can roll it forward one year:
  // return { start: startUTC + ONE_YEAR, end: endUTC + ONE_YEAR };
  // For now, just return the configured window.
  return { start: startUTC, end: endUTC };
}
