// Defines the default checkbox state for seasonal add-ons during signup.
// "trash" = base service only (seasonal unchecked by default)
// "seasonal_2nd" = base + seasonal bundle (seasonal checked by default)
// Note: Users can still manually toggle seasonal service per address.

export const PLAN_VALUES = ["trash", "seasonal_2nd"] as const;
export type Plan = typeof PLAN_VALUES[number];

export const PLAN_LABELS: Record<Plan, string> = {
  trash: "Trash Valet",
  seasonal_2nd: "Trash Valet Plus Seasonal",
};