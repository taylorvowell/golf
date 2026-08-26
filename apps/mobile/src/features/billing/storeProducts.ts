import { useEffect, useState } from "react";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { PLANS, TOP_UP, TRIAL_DAYS } from "./plans";

/**
 * The native-checkout seam.
 *
 * SwingSage never takes a card. Apple and Google both mandate their own in-app purchase system
 * for digital subscriptions sold in an app (D1), so the upgrade page's job is to *describe* the
 * offer and then hand off to the platform sheet. Two consequences shape everything below.
 *
 * **The price is not ours to state.** The stores return a localized, tax-adjusted, storefront-
 * specific price string, and they run promotional and regional pricing we do not control. A
 * paywall that renders a constant is wrong in most of the world and drifts the day a price
 * changes. So the screen renders `product.price` and treats `plans.ts` as the fallback for the
 * seconds before products load — or the case where they never do.
 *
 * **The offer must be described exactly.** App Review rejects a paywall that omits the
 * subscription's title, length, price, an auto-renew statement, a working restore, and links to
 * Terms and Privacy. Those are not polish; they are the difference between shipping and not.
 * `UpgradeScreen` renders every one of them, from this shape.
 *
 * Today this returns a mock so the page is walkable with no store account. When `billing-iap`
 * step 04 lands, `useStoreProducts` swaps its body for `react-native-iap` (or StoreKit 2 /
 * Play Billing directly) and **nothing above it changes** — which is the reason the seam exists
 * rather than the screen calling the store itself.
 */

/**
 * Product identifiers as they must be registered in App Store Connect and Play Console.
 *
 * **All four subscriptions live in ONE iOS subscription group, ranked pro < gold < platinum**
 * (the instructor-platform architecture §3): Gold/Platinum include personal Pro, so nobody ever
 * holds two subscriptions, and every transition is a store crossgrade — upgrades prorate
 * immediately (StoreKit does the math; Play uses `ReplacementMode.CHARGE_PRORATED_PRICE`),
 * downgrades land at renewal (`DEFERRED`). The server never computes proration; it re-derives
 * entitlement from whichever subscription the receipts now evidence. The free instructor
 * membership is a grant at onboarding — never a store product. Gold/Platinum prices are TBD
 * (billing-iap) and sell only on the instructor-mode paywall.
 */
export const PRODUCT_IDS = {
  proMonthly: "com.swingsage.app.pro.monthly",
  proAnnual: "com.swingsage.app.pro.annual",
  topUp50: "com.swingsage.app.topup.50",
  instructorGoldMonthly: "com.swingsage.app.instructor.gold.monthly",
  instructorGoldAnnual: "com.swingsage.app.instructor.gold.annual",
  instructorPlatinumMonthly: "com.swingsage.app.instructor.platinum.monthly",
  instructorPlatinumAnnual: "com.swingsage.app.instructor.platinum.annual",
} as const;

export type BillingPeriod = "monthly" | "annual";

export interface StoreProduct {
  id: string;
  period: BillingPeriod;
  /** Localized, tax-inclusive where the storefront requires it. Rendered verbatim — never parsed. */
  price: string;
  /** Localized price per month, for the annual plan's "that's $X a month" line. */
  pricePerMonth: string | null;
  /** Free-trial length the store will actually honour, in days. Null when the offer is absent. */
  introTrialDays: number | null;
}

export interface StoreProducts {
  monthly: StoreProduct | null;
  annual: StoreProduct | null;
  /** Null until the top-up is offered — it is a consumable, bought only when the month runs out. */
  topUp: { id: string; price: string } | null;
  /** Products are fetched from the store; until they arrive the page shows fallback copy. */
  loading: boolean;
  /** The store was unreachable. The page stays legible and the buy button says why. */
  unavailable: boolean;
}

/**
 * Where "Manage subscription" sends a golfer. Neither store lets us cancel on their behalf, so
 * this is a hand-off by design — but it is a **required** hand-off, not a courtesy.
 *
 * **Google Play requires it.** Play's subscriptions policy obliges the app to carry an
 * easy-to-use method to cancel, satisfied by linking to the Play subscription centre from account
 * settings. Play also wants the *specific* subscription, which is what `package` + `sku` do —
 * without them the golfer lands on a list of every subscription they hold and has to find ours.
 *
 * **Apple does not require it in 3.1.2** — subscriptions are managed in Settings — but it is
 * required at account deletion (5.1.1(v)): the app must tell a subscriber that App Store billing
 * continues after their account goes, and give them a direct path. Shipping the same row in both
 * places is simpler than shipping it once and explaining why.
 *
 * On iOS this URL is the fallback. Step 04 replaces it with StoreKit 2's
 * `AppStore.showManageSubscriptions(in:)`, which presents the sheet inside the app instead of
 * throwing the golfer out to Safari and then to Settings.
 */
export function manageSubscriptionUrl(productId?: string): string {
  if (Platform.OS === "ios") return "https://apps.apple.com/account/subscriptions";
  const pkg = Constants.expoConfig?.android?.package;
  return productId != null && pkg != null
    ? `https://play.google.com/store/account/subscriptions?sku=${productId}&package=${pkg}`
    : "https://play.google.com/store/account/subscriptions";
}

/** The store that will actually take the money, for copy that must name it. */
export const STORE_NAME = Platform.OS === "ios" ? "the App Store" : "Google Play";

const MOCK: Omit<StoreProducts, "loading"> = {
  monthly: {
    id: PRODUCT_IDS.proMonthly,
    period: "monthly",
    price: PLANS.pro.priceMonthly ?? "",
    pricePerMonth: null,
    introTrialDays: TRIAL_DAYS,
  },
  annual: {
    id: PRODUCT_IDS.proAnnual,
    period: "annual",
    price: PLANS.pro.priceAnnual ?? "",
    pricePerMonth: "$10.00",
    introTrialDays: TRIAL_DAYS,
  },
  topUp: { id: PRODUCT_IDS.topUp50, price: TOP_UP.price },
  unavailable: false,
};

/**
 * Fetch the offer from the platform store.
 *
 * The brief delay is not decoration — it is the real shape of this call, and a paywall that has
 * never rendered its own loading state ships one that flashes the fallback price and then
 * replaces it in front of the golfer.
 */
export function useStoreProducts(): StoreProducts {
  const [products, setProducts] = useState<StoreProducts>({ ...MOCK, loading: true });

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (alive) setProducts({ ...MOCK, loading: false });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return products;
}

/** What a purchase attempt can end as. Every one of these needs a visible answer (§30.3). */
export type PurchaseOutcome =
  | { status: "purchased" }
  | { status: "cancelled" }
  | { status: "pending" }
  | { status: "failed"; message: string };
