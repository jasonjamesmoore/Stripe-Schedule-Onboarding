# Stripe Subscription Scheduler - Portfolio Demo

A Next.js application demonstrating dynamic subscription scheduling with Stripe, featuring seasonal pricing adjustments based on service location and time of year.

## What This App Demonstrates

This application showcases a **trash valet service** onboarding flow with sophisticated Stripe integration:

- **Dynamic subscription phases** that automatically adjust pricing based on seasonal windows
- **Location-based service rules** using zip codes to determine pickup schedules and seasonal availability
- **Complex Stripe Subscription Schedules** with multiple phases for different pricing periods
- **Real-time invoice previews** showing how pricing changes throughout the year
- **Per-property seasonal add-ons** that activate/deactivate based on configured date ranges

### Key Technical Features

- **Stripe Subscription Schedules API** - Building multi-phase subscriptions with varying line items
- **Prorated billing** - Handling mid-month signups with accurate prorations
- **Metadata-driven configuration** - Storing per-address rules in subscription metadata
- **Invoice preview API** - Showing upcoming charges before payment
- **React Hook Form** with Zod validation for complex multi-step forms
- **TypeScript** throughout for type safety
- **Server-side price calculations** to prevent client-side manipulation

##  Demo Instructions

** This app uses Stripe Test Mode** - No real charges will be made.

### Test Zip Codes

To see the seasonal pricing in action, use these test addresses when creating a subscription:

| City | Zip Code | Seasonal Service | Status (Dec 2025) | Pickup Days |
|------|----------|------------------|-------------------|-------------|
| **Topsail Beach** | 28445 | Yes |  In Season | Mon + Thu (seasonal) |
| **Surf City** | 28445 |  Yes | In Season | Tue + Fri (seasonal) |
| **North Topsail Beach** | 28460 |  Yes |  Out of Season | Wed + Sat (when in season) |
| **Wilmington** | 28401 |  No |  N/A | Tue only |

### Recommended Test Flow

1. **Fill out contact information** (Step 1)
   - Use any test email address
   
2. **Add multiple service addresses** (Step 2)
   - Add at least 2-3 addresses with different seasonal statuses
   - Example: Topsail Beach (in-season) + North Topsail Beach (out-of-season)
   - The app will show you the pickup schedule for each address

3. **Review pricing & complete payment** (Step 3)
   - Notice how the monthly price includes seasonal add-ons for in-season properties
   - Use Stripe test card: `4242 4242 4242 4242`
   - Any future expiry date and any 3-digit CVC

4. **View subscription schedule** (Step 4)
   - See the complete subscription breakdown
   - View upcoming invoice with line items
   - See how phases change as properties enter/exit seasonal windows

## 🏗️ Technology Stack

- **Framework**: Next.js 15.5 (App Router)
- **Language**: TypeScript 5
- **Runtime**: React 19
- **Payments**: Stripe (Subscriptions, Invoices, Payment Intents)
- **Form Management**: React Hook Form 7 + Zod 4
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **State Management**: React hooks

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Stripe account (test mode keys)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

### Environment Variables

Add your Stripe test keys to `.env.local`:

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 🔑 Key Code Locations

- **Service Area Rules**: `src/lib/serviceAreas/serviceAreas.ts` - Zip code to seasonal window mapping
- **Phase Builder**: `src/lib/stripe/phaseBuilder.ts` - Subscription schedule creation logic
- **Subscription API**: `src/app/api/stripe/create-subscription/` - Server-side subscription creation
- **Invoice Preview**: `src/app/api/stripe/subscription-overview/route.ts` - Fetch subscription details
- **Onboarding Form**: `src/features/onboarding/personal/PersonalOnboardForm.tsx` - Multi-step wizard

## 💡 How Seasonal Pricing Works

1. Each service address is matched to a `ServiceAreaRule` based on city or zip code
2. Rules define:
   - Base pickup day (e.g., Monday)
   - Optional seasonal 2nd pickup day (e.g., Thursday)
   - Seasonal window start/end dates (UTC timestamps)
3. During signup, the system:
   - Calculates which properties are currently in their seasonal window
   - Builds a subscription schedule with multiple phases
   - Each phase has different pricing based on seasonal status
4. The subscription automatically transitions between phases on the configured dates

## 🧪 Testing Seasonal Transitions

The app is configured with 2025 seasonal dates:
- **Topsail Beach**: May 26 - Sep 1
- **Surf City**: May 1 - Sep 30
- **North Topsail Beach**: May 2 - Oct 26

To test different scenarios, you can modify these dates in `src/lib/serviceAreas/serviceAreas.ts`.

## 📝 Notes

- This is a **portfolio demonstration** using Stripe test mode
- No real credit cards are charged
- Service areas and dates are fictional for demonstration purposes
- The app shows real Stripe API integration patterns that would work in production

## 🔗 Learn More

- [Stripe Subscription Schedules](https://stripe.com/docs/billing/subscriptions/subscription-schedules)
- [Next.js Documentation](https://nextjs.org/docs)
- [React Hook Form](https://react-hook-form.com/)

---

Built by Jason Moore as a portfolio demonstration of complex Stripe subscription management.
