import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Eyebrow, FloatingBack, Panel, Tag } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { MEMBERSHIPS } from "../features/billing/plans";
import { setAppMode } from "../features/mode/appMode";
import { setForceInstructorRole } from "../features/mode/useRoles";
import { useAppNavigation } from "../navigation";
import { themedStyles } from "../theme";

/**
 * The way in (architecture §4a.8): becoming an instructor is FREE AND INSTANT — the role
 * claim plus the free membership grant — and this three-beat sequence is that act: what you
 * get, the membership you start on, go. Being LISTED in the directory stays a separate,
 * reviewed application (D32) — the listing editor says so; this door never overpromises.
 *
 * Mocked: completing it forces the dev role flag and switches the device into instructor
 * mode, so the walk continues straight into the shell. The real completion is one
 * `claim_role("instructor")` + the membership grant — the same seam onboarding's role step
 * already calls.
 */
export function BecomeInstructorScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const [step, setStep] = useState<0 | 1>(0);

  const finish = () => {
    if (__DEV__) setForceInstructorRole(true);
    setAppMode("instructor");
    navigation.navigate("Tabs");
  };

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
        {step === 0 ? (
          <>
            <Text style={styles.title}>Teach on SwingSage</Text>
            <Text style={styles.copy}>
              Your students' swings arrive already analysed — you see what changed before you
              press play. A roster, private conversations, drills you author, and a directory
              listing golfers can find.
            </Text>
            <Panel radius="feature" style={styles.card}>
              <Eyebrow>Free to start</Eyebrow>
              <Text style={styles.cardCopy}>
                The instructor role costs nothing and takes one tap. Getting LISTED in the
                directory is a short review afterwards — your tools work while it runs.
              </Text>
            </Panel>
            <Button label="Keep going" variant="primary" onPress={() => setStep(1)} />
          </>
        ) : (
          <>
            <Text style={styles.title}>Start on the free membership</Text>
            <Panel radius="feature" style={[styles.card, styles.cardCurrent]}>
              <View style={styles.cardHead}>
                <Eyebrow>{MEMBERSHIPS.free.name}</Eyebrow>
                <Tag label="You start here" variant="neutral" compact />
              </View>
              <Text style={styles.cardCopy}>{MEMBERSHIPS.free.pitch}</Text>
            </Panel>
            <Panel radius="feature" style={styles.card}>
              <Eyebrow>
                {MEMBERSHIPS.gold.name} · {MEMBERSHIPS.platinum.name}
              </Eyebrow>
              <Text style={styles.cardCopy}>
                The paid memberships — full roster, broadcasts, video lessons, and Pro for your
                own game included — open from instructor mode when pricing lands.
              </Text>
            </Panel>
            <Button
              testID="become-instructor-finish"
              label="Become an instructor"
              variant="primary"
              onPress={finish}
            />
            <Text style={styles.note}>
              Mocked — this flips the device into instructor mode; the real claim is one role
              grant, and your golfer side is untouched either way.
            </Text>
          </>
        )}
      </ScrollView>
      <FloatingBack onPress={() => navigation.goBack()} />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21 },
  copy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13.5, lineHeight: 20 },
  card: { padding: 16, gap: 7 },
  cardCurrent: { backgroundColor: t.surfaceBlue },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
  note: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 10.5, textAlign: "center" },
}));
