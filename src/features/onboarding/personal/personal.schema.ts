import { z } from "zod";
import { PLAN_VALUES } from "@/features/payments/stripe/shared/plan";

export const trimmed = z.string().trim();

export const email = z
  .string()
  .transform((s) => s.trim())
  .transform((st) => st.toLowerCase())
  .pipe(z.email()); 

export const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "")) // keep digits
  .refine(
    (d) => d.length === 0 || (d.length >= 10 && d.length <= 15),
    "Phone must be 10–15 digits"
  )
  .transform((d) => (d.length === 0 ? undefined : d))
  .optional();

// Safer state + ZIP normalization
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const stateCode = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => s.length === 2 && US_STATES.has(s), "Use a valid 2-letter state code");

const postalUS = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, "Invalid ZIP code");

export const AddressSchema = z.object({
  line1: trimmed.min(1, "Address is required"),
  line2: trimmed.optional(),
  city: trimmed.min(1, "City is required"),
  state: stateCode,
  postalCode: postalUS,
  country: trimmed.default("US"),
});

export const TeamMemberSchema = z.object({
  name: trimmed.min(1),
  email,
  role: trimmed.optional(),
});

// Helper: compare addresses (basic equality by normalized fields)
const sameAddress = (a?: z.infer<typeof AddressSchema>, b?: z.infer<typeof AddressSchema>) => {
  if (!a || !b) return false;
  const n = (s?: string) => (s ?? "").trim();
  return (
    n(a.line1) === n(b.line1) &&
    n(a.line2) === n(b.line2) &&
    n(a.city) === n(b.city) &&
    a.state === b.state &&
    n(a.postalCode) === n(b.postalCode) &&
    (a.country ?? "US") === (b.country ?? "US")
  );
};

export const OnboardingSchema = z
  .object({
    contact: z.object({
      firstName: trimmed.min(1),
      lastName: trimmed.min(1),
      email,
      phone,
    }),

    addresses: z
      .object({
        serviceSameAsBilling: z.boolean().default(false),
        billing: AddressSchema,
        services: z.array(AddressSchema).default([]),
      })
      // Require at least one service address unless same-as-billing is checked
      .superRefine((val, ctx) => {
        if (!val.serviceSameAsBilling && val.services.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Add at least one service address or check 'service address is the same as billing'.",
            path: ["services"],
          });
        }
      }),

    plan: z.enum(PLAN_VALUES),

    team: z.array(TeamMemberSchema).default([]),

    agreeToTerms: z.boolean().refine(Boolean, {
      message: "You must accept the terms",
    }),
  })
  // Normalize service list when "same as billing" is on, and de-dupe accidental duplicates.
  .transform((data) => {
    const { serviceSameAsBilling, billing, services } = data.addresses;

    // If toggle is on and user provided no services, inject billing as the single service.
    let normalized = services;
    if (serviceSameAsBilling && services.length === 0) {
      normalized = [billing];
    }

    // De-dupe exact duplicates of billing to avoid double-charging when toggle is on.
    if (serviceSameAsBilling && normalized.length > 1) {
      const dedup = normalized.filter((s, i, arr) => {
        // remove exact-billing dupes after the first occurrence
        if (sameAddress(s, billing)) {
          // keep the first match only
          const firstIdx = arr.findIndex((x) => sameAddress(x, billing));
          return i === firstIdx;
        }
        return true;
      });
      normalized = dedup;
    }

    return {
      ...data,
      addresses: {
        ...data.addresses,
        services: normalized,
      },
    };
  });

export type OnboardingInput = z.input<typeof OnboardingSchema>;
export type OnboardingOutput = z.output<typeof OnboardingSchema>;
