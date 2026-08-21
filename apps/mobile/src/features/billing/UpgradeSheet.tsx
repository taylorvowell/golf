import { Text, View } from "react-native";

import { Button, Sheet } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { useAppNavigation } from "../../navigation";
import { themedStyles } from "../../theme";
import type { Denial } from "./entitlement";
import { CAPABILITY_LABEL, CAPABILITY_PITCH, PLANS, TOP_UP } from "./plans";

/**
 * The moment a capability is refused — one sheet, rendering the denial payload.
 *
 * Two refusals wear the same surface because they interrupt the same act, but they say opposite
 * things and must never be confused: a **tier** refusal means "your plan does not include this",
 * a **allowance** refusal means "your plan does, and this month is spent". With one paid tier
 * the second refusal has no upsell at all — it offers capacity, and telling a Pro golfer to
 * "upgrade to Pro" is the failure this split prevents.
 *
 * §30.2's four requirements land here: the limit is stated plainly, the plan that unlocks it is
 * named, nothing the golfer already has is threatened, and the CTA says what changes. Everything
 * on the sheet comes from `denial` — no screen that opens this writes upgrade copy of its own.
 */
export function UpgradeSheet({ denial, onClose }: { denial: Denial | null; onClose: () => void }) {
  const navigation = useAppNavigation();
  const styles = useStyles();

  const seePlans = () => {
    onClose();
    navigation.navigate("Upgrade");
  };

  if (denial == null) return null;

  const capability = CAPABILITY_LABEL[denial.capability];

  if (denial.reason === "tier") {
    const plan = PLANS[denial.requiredTier];
    return (
      <Sheet
        visible
        onClose={onClose}
        title={capability}
        subtitle={CAPABILITY_PITCH[denial.capability]}
        testID="upgrade-sheet-tier"
      >
        <View style={styles.body}>
          <Text style={styles.line}>
            Part of <Text style={styles.strong}>{plan.name}</Text>, from {plan.priceAnnual} a year.
          </Text>
          <Button label={`See ${plan.name}`} variant="primary" onPress={seePlans} />
          <Button label="Not now" variant="ghost" onPress={onClose} />
        </View>
      </Sheet>
    );
  }

  // Allowance spent. The tier is already correct, so the offer is capacity, not a different plan.
  const usage = denial.usage;
  return (
    <Sheet
      visible
      onClose={onClose}
      title="You've used this month's analyses"
      subtitle={
        usage == null
          ? undefined
          : `All ${usage.included} of them. Your allowance resets ${usage.resetsOn}.`
      }
      testID="upgrade-sheet-allowance"
    >
      <View style={styles.body}>
        <Text style={styles.line}>
          Keep recording — your swings are saved either way, and they analyse as soon as you have
          room.
        </Text>
        <Button
          label={`Add ${TOP_UP.analyses} analyses — ${TOP_UP.price}`}
          variant="primary"
          onPress={seePlans}
        />
        <Button label="Not now" variant="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const useStyles = themedStyles((t) => ({
  body: { gap: 10, paddingTop: 4 },
  line: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  strong: { color: t.text, fontFamily: FONT_BODY.bold },
}));
