import { resolveRuleForAddress, type Address } from "../serviceAreas/serviceAreas";

// Derive season windows for an address (currently global; can be per-service-area later).

export function seasonWindowsForAddress(
  addr: Record<string, unknown>,
  refEpoch: number
): Array<{ start: number; end: number }> {
  // Convert addr to Address type
  const address: Address = {
    line1: String(addr.line1 ?? ""),
    city: String(addr.city ?? ""),
    state: String(addr.state ?? ""),
    zip: String(addr.postalCode ?? addr.zip ?? ""),
  };
  const rule = resolveRuleForAddress(address);
  if (!rule || !rule.season) return [];
  const { startUTC, endUTC } = rule.season;
  
  // Return the season window if it hasn't ended yet (includes current and future windows)
  if (refEpoch < endUTC) {
    return [{ start: startUTC, end: endUTC }];
  }
  
  // Season has already ended - could roll forward for recurring seasons
  // For now, return empty array for past seasons
  return [];
}