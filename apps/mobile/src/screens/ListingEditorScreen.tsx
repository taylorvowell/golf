import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { BadgeCheck } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  Eyebrow,
  FloatingBack,
  ListGroup,
  ListRow,
  Panel,
  Sheet,
  Tag,
} from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";
import { InitialsDisc } from "../features/instructor/components/InitialsDisc";
import { useListingSeam } from "../features/instructor/mock/seams";
import type { ListingLifecycle } from "../features/instructor/mock/types";

/**
 * The directory listing editor (architecture §4a.6) — the instructor's public face, §23.1's
 * full field set, and the §31.5 lifecycle made visible: draft → pending approval → listed,
 * with rejected and suspended as honest states rather than silent absences. Being LISTED is a
 * reviewed application; holding the role never is (D32) — this screen is where that split
 * becomes a surface. Preview-as-golfers-see-it renders the exact card the directory will.
 *
 * Mocked: `useListingSeam`; rows describe their field and open nothing yet. The lifecycle is
 * forceable from DEBUG → Instructor mock.
 */

const LIFECYCLE_COPY: Record<ListingLifecycle, { label: string; copy: string; bad?: boolean }> = {
  draft: {
    label: "Draft",
    copy: "Not visible to golfers yet — submit it for review when it reads right.",
  },
  pending: {
    label: "In review",
    copy: "Submitted. Listings are reviewed before they appear in the directory.",
  },
  listed: { label: "Listed", copy: "Live in the instructor directory." },
  rejected: {
    label: "Not approved",
    copy: "The review declined this listing. Edit and resubmit — the reasons arrive with it.",
    bad: true,
  },
  suspended: {
    label: "Suspended",
    copy: "Hidden from the directory by an administrator. Your students and data are untouched.",
    bad: true,
  },
};

export function ListingEditorScreen() {
  const t = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const listing = useListingSeam();
  const [previewOpen, setPreviewOpen] = useState(false);

  const lifecycle = LIFECYCLE_COPY[listing.lifecycle];

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
        <Text style={styles.title}>Your listing</Text>

        <Panel radius="feature" style={styles.stateCard}>
          <View style={styles.stateRow}>
            <Tag label={lifecycle.label} variant={lifecycle.bad ? "issue" : "neutral"} compact />
            {listing.verified && (
              <View style={styles.verified}>
                <BadgeCheck size={14} color={t.aqua} strokeWidth={2.4} />
                <Text style={styles.verifiedLabel}>Verified</Text>
              </View>
            )}
          </View>
          <Text style={styles.stateCopy}>{lifecycle.copy}</Text>
          {listing.lifecycle === "draft" && (
            <Button label="Submit for review" variant="primary" onPress={() => undefined} />
          )}
          {listing.lifecycle === "rejected" && (
            <Button label="Resubmit" variant="primary" onPress={() => undefined} />
          )}
          {!listing.verified && listing.lifecycle === "listed" && (
            <Button label="Request verification" variant="ghost" onPress={() => undefined} />
          )}
        </Panel>

        <ListGroup>
          <ListRow title="Photo" subtitle="Your face, not your logo" onPress={() => undefined} />
          <ListRow title="Name" subtitle={listing.name} onPress={() => undefined} />
          <ListRow title="Credentials" subtitle={listing.credentials} onPress={() => undefined} />
          <ListRow title="Experience" subtitle={listing.experience} onPress={() => undefined} />
          <ListRow title="Bio" subtitle={listing.bio} onPress={() => undefined} />
          <ListRow
            title="Specialties"
            subtitle={listing.specialties.join(" · ")}
            onPress={() => undefined}
          />
          <ListRow
            title="Coaching style"
            subtitle={listing.coachingStyle}
            onPress={() => undefined}
          />
          <ListRow
            title="Skill levels"
            subtitle={listing.skillLevels.join(" · ")}
            onPress={() => undefined}
          />
          <ListRow title="Delivery" subtitle={listing.delivery} onPress={() => undefined} />
          <ListRow title="Location" subtitle={listing.location} onPress={() => undefined} />
        </ListGroup>

        <Button
          testID="listing-preview"
          label="Preview as golfers see it"
          variant="ghost"
          onPress={() => setPreviewOpen(true)}
        />
      </ScrollView>

      <Sheet
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Directory preview"
        subtitle="The exact card the directory renders"
        testID="listing-preview-sheet"
      >
        <View style={styles.previewCard}>
          <View style={styles.previewHead}>
            <InitialsDisc initials="MK" size={46} />
            <View style={{ flex: 1 }}>
              <View style={styles.previewNameRow}>
                <Text style={styles.previewName}>{listing.name}</Text>
                {listing.verified && <BadgeCheck size={15} color={t.aqua} strokeWidth={2.4} />}
              </View>
              <Text style={styles.previewMeta}>
                {listing.credentials} · {listing.location}
              </Text>
            </View>
          </View>
          <Text style={styles.previewBio}>{listing.bio}</Text>
          <Text style={styles.previewMeta}>
            {listing.specialties.join(" · ")} · {listing.delivery}
          </Text>
          <Eyebrow>{listing.experience}</Eyebrow>
        </View>
      </Sheet>

      <FloatingBack onPress={() => navigation.goBack()} />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  title: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 21 },
  stateCard: { padding: 16, gap: 9 },
  stateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  verified: { flexDirection: "row", alignItems: "center", gap: 4 },
  verifiedLabel: { color: t.aqua, fontFamily: FONT_BODY.semiBold, fontSize: 12 },
  stateCopy: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
  previewCard: {
    backgroundColor: t.surface2,
    borderRadius: 18,
    padding: 16,
    gap: 9,
    marginBottom: 8,
  },
  previewHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  previewNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  previewName: { color: t.text, fontFamily: FONT_DISPLAY.bold, fontSize: 15.5 },
  previewMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11.5 },
  previewBio: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 18 },
}));
