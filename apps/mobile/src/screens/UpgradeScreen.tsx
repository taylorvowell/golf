import { Check } from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Eyebrow, Panel, Skeleton, Tag, TitleText } from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useEntitlement } from "../features/billing/entitlement";
import { PLANS, TOP_UP, TRIAL_DAYS } from "../features/billing/plans";
import {
  STORE_NAME,
  useStoreProducts,
  type BillingPeriod,
  type StoreProduct,
} from "../features/billing/storeProducts";
import { themedStyles, useTheme } from "../theme";

const TERMS_URL = "https://swingsage.app/terms";
const PRIVACY_URL = "https://swingsage.app/privacy";

/**
 * Upgrade to Pro — the one paywall, built for native checkout.
 *
 * SwingSage takes no payment details. The button opens the App Store or Play sheet, and the
 * page's whole job is to describe the offer accurately enough that the golfer knows what they
 * are agreeing to before that sheet appears. That is also literally the review bar: a paywall
 * missing the subscription's length, its price, an auto-renew statement, a working restore, or
 * links to Terms and Privacy is rejected. Every one of those is on this page, and the price
 * comes from the store product rather than from a constant — see `storeProducts.ts`.
 *
 * One paid plan, two billing periods. Annual leads and is preselected: golf is seasonal, a
 * monthly subscriber cancels in October, and annual is what the plan was costed against. Monthly
 * exists because refusing it reads as a trap.
 */
export function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const t = useTheme();
  const { personal, instructor } = useEntitlement();
  const status = personal.status;
  const products = useStoreProducts();
  const [period, setPeriod] = useState<BillingPeriod>("annual");

  const plan = PLANS.pro;
  const product = period === "annual" ? products.annual : products.monthly;
  const trialDays = product?.introTrialDays ?? TRIAL_DAYS;
  // Trials are a golfer concept: an instructor is never mid-trial and never offered one —
  // included Pro carries no trial, and even a free-membership instructor buys Pro trial-less.
  const eligibleForTrial =
    instructor == null && (status === "none" || status === "trialing");
  const periodWord = period === "annual" ? "year" : "month";

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
    >
      <View style={styles.hero}>
        <Eyebrow>SwingSage Pro</Eyebrow>
        <TitleText>{plan.pitch}</TitleText>
      </View>

      <Panel radius="feature" style={styles.unlocks}>
        {plan.unlocks.map((line) => (
          <View key={line} style={styles.unlockRow}>
            <Check size={15} color={t.aqua} strokeWidth={3} />
            <Text style={styles.unlockText}>{line}</Text>
          </View>
        ))}
      </Panel>

      {/* Two prices, one plan. Both rows say the full offer, because a golfer choosing between
          them is choosing a commitment, not a number. */}
      <View style={styles.options}>
        <PeriodOption
          testID="upgrade-annual"
          label="Annual"
          badge={plan.annualNote}
          product={products.annual}
          fallbackPrice={plan.priceAnnual}
          suffix="a year"
          selected={period === "annual"}
          loading={products.loading}
          onPress={() => setPeriod("annual")}
        />
        <PeriodOption
          testID="upgrade-monthly"
          label="Monthly"
          product={products.monthly}
          fallbackPrice={plan.priceMonthly}
          suffix="a month"
          selected={period === "monthly"}
          loading={products.loading}
          onPress={() => setPeriod("monthly")}
        />
      </View>

      <View style={styles.cta}>
        <Button
          testID="upgrade-purchase"
          label={
            products.unavailable
              ? `${STORE_NAME} is unavailable`
              : eligibleForTrial
                ? `Try ${trialDays} days free`
                : "Upgrade to Pro"
          }
          variant="primary"
          disabled={products.loading || products.unavailable || product == null}
          onPress={() => undefined}
        />

        {/* The required disclosure, in the order a person reads it: what recurs, how much, how
            often, and how to stop. Naming the store matters — it is where the charge appears on
            their statement and the only place the subscription can be cancelled. */}
        <Text style={styles.fine}>
          {eligibleForTrial
            ? `Free for ${trialDays} days, then ${product?.price ?? plan.priceAnnual} a ${periodWord}. `
            : `${product?.price ?? plan.priceAnnual} a ${periodWord}. `}
          Renews automatically until you cancel. Billed through {STORE_NAME}, and cancelled there
          at any time up to 24 hours before it renews.
        </Text>

        <View style={styles.legal}>
          <LegalLink label="Restore a purchase" onPress={() => undefined} />
          <Text style={styles.legalDot}>·</Text>
          <LegalLink label="Terms" onPress={() => Linking.openURL(TERMS_URL)} />
          <Text style={styles.legalDot}>·</Text>
          <LegalLink label="Privacy" onPress={() => Linking.openURL(PRIVACY_URL)} />
        </View>
      </View>

      <Panel radius="feature" style={styles.note}>
        <Eyebrow>If you run out</Eyebrow>
        <Text style={styles.noteCopy}>
          Pro covers {plan.analysesPerMonth} analyses a month. If a big week uses them up, add{" "}
          {TOP_UP.analyses} more for {TOP_UP.price} — they never expire.
        </Text>
      </Panel>

      <Panel radius="feature" style={styles.note}>
        <Eyebrow>If you stop</Eyebrow>
        <Text style={styles.noteCopy}>
          Nothing you have already analysed is deleted. Your swings, reports and progress stay —
          you keep watching them, you just stop analysing new ones.
        </Text>
      </Panel>
    </ScrollView>
  );
}

/** One billing period. Selection is fill plus the tick — never a border (the flat-UI rule). */
function PeriodOption({
  label,
  badge,
  product,
  fallbackPrice,
  suffix,
  selected,
  loading,
  onPress,
  testID,
}: {
  label: string;
  badge?: string | null;
  product: StoreProduct | null;
  fallbackPrice: string | null;
  suffix: string;
  selected: boolean;
  loading: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const styles = useStyles();
  const price = product?.price ?? fallbackPrice ?? "";

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${price} ${suffix}`}
      style={({ pressed }) => [
        styles.option,
        selected && { backgroundColor: t.surfaceBlue },
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.optionMain}>
        <View style={styles.optionHead}>
          <Text style={[styles.optionLabel, selected && { color: t.cobalt }]}>{label}</Text>
          {badge != null && <Tag label={badge} variant="good" compact />}
        </View>
        {loading ? (
          <Skeleton style={styles.priceSkeleton} />
        ) : (
          <View style={styles.priceRow}>
            <Text style={styles.price}>{price}</Text>
            <Text style={styles.per}>{suffix}</Text>
          </View>
        )}
        {product?.pricePerMonth != null && !loading && (
          <Text style={styles.perMonth}>{product.pricePerMonth} a month</Text>
        )}
      </View>
      {selected && <Check size={18} color={t.cobalt} strokeWidth={3} />}
    </Pressable>
  );
}

function LegalLink({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={8}>
      {({ pressed }) => (
        <Text style={[styles.legalLink, pressed && { opacity: 0.6 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 12 },
  hero: { gap: 6, paddingBottom: 2 },

  unlocks: { padding: 18, gap: 10 },
  unlockRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  unlockText: {
    flex: 1,
    color: t.text,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
  },

  options: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    padding: 16,
    backgroundColor: t.surface,
  },
  optionMain: { flex: 1, gap: 4 },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 13,
    lineHeight: displayLine(13),
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  price: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 26,
    lineHeight: displayLine(26),
  },
  per: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12 },
  perMonth: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },
  /** Sized to the price line it stands in for, so the row does not jump when the store answers. */
  priceSkeleton: { width: 110, height: 26, borderRadius: 7 },

  cta: { gap: 10, marginTop: 4 },
  fine: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  legal: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  legalLink: { color: t.textSoft, fontFamily: FONT_BODY.semiBold, fontSize: 11 },
  legalDot: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 11 },

  note: { padding: 16, gap: 6 },
  noteCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 19 },
}));
