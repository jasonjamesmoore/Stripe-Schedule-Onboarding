export const PLAN_VALUES = ["trash", "seasonal_2nd"] as const;
export type Plan = typeof PLAN_VALUES[number];

export const PLAN_LABELS: Record<Plan, string> = {
  trash: "Trash Valet",
  seasonal_2nd: "Trash Valet Plus Seasonal",
};