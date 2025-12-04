export const PRORATION_BEHAVIOR =
  (process.env.PRORATION_BEHAVIOR as
    | "create_prorations"
    | "none"
    | "always_invoice") ?? "create_prorations";

export const NINETY_DAYS_SEC = 180 * 24 * 60 * 60; // 180 days (6 months) for demo purposes
