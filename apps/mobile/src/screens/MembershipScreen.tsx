import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Eyebrow, FloatingBack, ListGroup, ListRow, Panel, Tag } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { UpgradeSheet } from "../features/billing/UpgradeSheet";
import { useEntitlement, type Denial } from "../features/billing/entitlement";
import {
  MEMBERSHIPS,
  MEMBERSHIP_LIMITS,
  type InstructorMembership,
} from "../features/billing/plans";
import { useAppNavigation } from "../navigation";
import { themedStyles } from "../theme";

/**
 * The instructor paywall (architecture §4a.7) — Free / Gold / Platinum compared on the dials
 * that matter, with the §3 crossgrade promise stated plainly: one live subscription, the store
 * prorates, upgrading from personal Pro is one motion. Prices are TBD (billing-iap), so the
 * cards sell the SHAPE and say the price is coming — never a made-up number. Restore purchases
 * is a mandatory IAP surface and lives here as well as on the personal Subscription page.
 * The roster-full refusal is demoable from the row at the bottom (the instructor-dimension
 * 402 made visible).
 */

const ORDER: InstructorMembership[] = ["free", "gold", "platinum"];

function dialLine(m: InstructorMembership): string {
  const d = MEMBERSHIP_LIMITS[m];
  const cap = (n: number, word: string) =>
    n === Infinity ? `Unlimited ${word}` : `${n} ${word}`;
  return `${cap(d.rosterSize, "students")} · ${cap(d.lessonsPerMonth, "lessons/mo")} · ${cap(d.drillLibrarySize, "drills")}`;
}

export function MembershipScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const { instructor } = useEntitlement();
  const [denial, setDenial] = useState<Denial | null>(null);

  const current = instructor?.membership ?? "free";

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Membership</Text>

        {ORDER.map((m) => {
          const plan = MEMBERSHIPS[m];
          const isCurrent = m === current;
          return (
            <Panel key={m} radius="feature" style={[styles.card, isCurrent && styles.cardCurrent]}>
              <View style={styles.cardHead}>
                <Eyebrow>{plan.name}</Eyebrow>
                {isCurrent && <Tag label="Your membership" variant="neutral" compact />}
              </View>
              <Text style={styles.pitch}>{plan.pitch}</Text>
              <Text style={styles.dials}>{dialLine(m)}</Text>
              {plan.includesPro && (
                <Text style={styles.included}>SwingSage Pro for your own game — included</Text>
              )}
              {!isCurrent && m !== "free" && (
                <Button
                  testID={`membership-upgrade-${m}`}
                  label="Pricing coming with launch"
                  variant="ghost"
                  disabled
                  onPress={() => undefined}
                />
              )}
            </Panel>
          );
        })}

        <Text style={styles.crossgrade}>
          One subscription, ever: upgrading from personal Pro is a single prorated switch — the
          store credits your unused Pro time automatically. Cancelling a membership also ends its
          included Pro.
        </Text>

        <ListGroup>
          <ListRow
            testID="membership-restore"
            title="Restore a purchase"
            subtitle="Already subscribed on another device"
            onPress={() => undefined}
          />
          <ListRow
            testID="membership-demo-refusal"
            title="What a full roster looks like"
            subtitle="The refusal an instructor meets at a membership limit"
            onPress={() =>
              setDenial({
                capability: "instructor_tools",
                dimension: "instructor",
                requiredTier: null,
                requiredMembership: "gold",
                usage: null,
                reason: "tier",
              })
            }
          />
        </ListGroup>
      </ScrollView>

      <UpgradeSheet denial={denial} onClose={() => setDenial(null)} />
      <FloatingBack onPress={() => navigation.goBack()} />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21 },
  card: { padding: 16, gap: 7 },
  cardCurrent: { backgroundColor: t.surfaceBlue },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pitch: { color: t.text, fontFamily: FONT_BODY.semiBold, fontSize: 14, lineHeight: 20 },
  dials: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5 },
  included: { color: t.aqua, fontFamily: FONT_BODY.semiBold, fontSize: 12 },
  crossgrade: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 11.5,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
}));
