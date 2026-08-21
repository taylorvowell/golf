import { Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Eyebrow, ListGroup, ListRow, Panel, Tag, TitleText } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
import { AllowanceMeter } from "../features/billing/AllowanceMeter";
import { isRecoverable, useEntitlement } from "../features/billing/entitlement";
import { PLANS } from "../features/billing/plans";
import {
  manageSubscriptionUrl,
  PRODUCT_IDS,
  STORE_NAME,
} from "../features/billing/storeProducts";
import { useAppNavigation } from "../navigation";
import { themedStyles } from "../theme";

/**
 * What you are on, what you have left, and how to change it.
 *
 * The one screen where the allowance is shown unconditionally — a golfer who opened it came for
 * that number, so the 25% rule that hides the meter elsewhere does not apply here.
 *
 * Cancelling is not a button we own. Apple and Google both require the subscription to be
 * managed in their own settings, so the row hands off rather than pretending, and says so.
 */
export function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const navigation = useAppNavigation();
  const { tier, status, trialDaysLeft, renewsOn } = useEntitlement();
  const plan = PLANS[tier];
  const paid = status === "active";
  /** The manage row is shown to anyone the store still holds a subscription for — including a
   *  lapsed one, which is exactly when a golfer needs to reach their payment method. */
  const hasStoreSubscription = paid || status === "trialing" || isRecoverable(status);
  const openManage = () =>
    Linking.openURL(manageSubscriptionUrl(PRODUCT_IDS.proAnnual)).catch(() => undefined);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <Panel radius="feature" style={styles.card}>
        <View style={styles.head}>
          <Eyebrow>Your plan</Eyebrow>
          {status === "trialing" && trialDaysLeft != null && (
            <Tag label={`${trialDaysLeft} days left`} variant="neutral" compact />
          )}
          {status === "expired" && <Tag label="Trial over" variant="issue" compact />}
        </View>
        <TitleText>{plan.name}</TitleText>
        <Text style={styles.copy}>{plan.pitch}</Text>
        {paid && renewsOn != null && <Text style={styles.meta}>Renews {renewsOn}</Text>}
      </Panel>

      {/* Payment recovery. Grace and hold are the two states a golfer cannot act on from inside
          the app — only their payment method fixes them — so the row that leads there is the
          whole message, and it is the only place the card turns to the warning tone. */}
      {isRecoverable(status) && (
        <Panel radius="feature" style={styles.card}>
          <Eyebrow>{status === "paused" ? "Paused" : "Payment problem"}</Eyebrow>
          <Text style={styles.copy}>
            {status === "in_grace"
              ? `${STORE_NAME} could not take your payment and is trying again. Nothing has changed yet — update your payment method to keep it that way.`
              : status === "on_hold"
                ? `${STORE_NAME} could not take your payment, so analysis is paused. Update your payment method and your subscription picks up where it left off — nothing you have analysed is lost.`
                : `Your subscription is paused and resumes on the date you chose. You can restart it any time.`}
          </Text>
          <Button
            testID="subscription-fix-payment"
            label={status === "paused" ? "Manage subscription" : "Update payment method"}
            variant="primary"
            onPress={openManage}
          />
        </Panel>
      )}

      {plan.analysesPerMonth > 0 && (
        <Panel radius="feature" style={styles.card}>
          <Eyebrow>This month</Eyebrow>
          <AllowanceMeter always />
        </Panel>
      )}

      {tier !== "pro" && (
        <Button
          testID="subscription-upgrade"
          label="Upgrade to Pro"
          variant="primary"
          onPress={() => navigation.navigate("Upgrade")}
        />
      )}

      <ListGroup>
        <ListRow
          testID="subscription-restore"
          title="Restore a purchase"
          subtitle="Already subscribed on another device"
          onPress={() => undefined}
        />
        {hasStoreSubscription && (
          <ListRow
            testID="subscription-manage"
            title="Manage subscription"
            subtitle={`Change or cancel in ${STORE_NAME}`}
            onPress={openManage}
          />
        )}
      </ListGroup>

      <Panel radius="feature" style={styles.card}>
        <Eyebrow>Your swings</Eyebrow>
        <Text style={styles.copy}>
          {plan.retention}. Nothing you have already analysed is removed if you stop — you keep
          watching every report you have run.
        </Text>
      </Panel>
    </ScrollView>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 12 },
  card: { padding: 18, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  copy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 19 },
  meta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },
}));
