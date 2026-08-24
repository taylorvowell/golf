import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlignLeft,
  ArrowDownToLine,
  ChartNoAxesColumnIncreasing,
  House,
  List,
  Play,
  Rows3,
  Sparkles,
  Star,
  Target,
  Trash2,
} from "lucide-react-native";

import {
  BrandLogo,
  BrandMark,
  Button,
  Chip,
  CoachCard,
  CoachLoader,
  Delta,
  DisplayText,
  Eyebrow,
  HeadingText,
  Input,
  LabelText,
  MetaText,
  HeroBackdrop,
  Panel,
  PanelHead,
  PerformanceCard,
  ProgressTrack,
  RecordButton,
  ScoreOrb,
  ScoreRing,
  Segmented,
  SessionPillNav,
  Shimmer,
  SwingLoader,
  Sheet,
  HERO_PARALLAX,
  SheetOverBackdrop,
  SnapCarousel,
  StickThumb,
  SwingProfile,
  SwingTimelineList,
  Tag,
  TitleText,
  WaveNav,
  WeekStrip,
  PortraitPicker,
} from "../design/system";
import { useState } from "react";
import { COACHES } from "../features/coach/coaches";
import { themedStyles, useTheme } from "../theme";

/**
 * The design system's living spec — every primitive rendered in the current theme, checked
 * against the mockup's §03–§08 panels. Dev builds only (the route registers under `__DEV__`);
 * it costs nothing in release and is the surface later pages are compared against.
 */
export function SystemGalleryScreen() {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();
  const [segment, setSegment] = useState("Week");
  const [chromeHidden, setChromeHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      {/* THE decisions, at the very top: this is what ships. Everything below is a component
          drawn in these colours, not a candidate for anything. */}
      <Section title="Lockup">
        <View style={[styles.lockupRow, { backgroundColor: "#FFFFFF" }]}>
          <BrandLogo height={30} />
        </View>
        <View style={[styles.lockupRow, { backgroundColor: "#172B4E" }]}>
          <BrandLogo height={30} color="#FFFFFF" />
        </View>
      </Section>

      <Section title="Loading spinner">
        <Text style={styles.note}>
          Shown on both grounds. The ring, the golfer and the lockup above all draw from one
          `SwingGradient` — if they ever look different, that is a bug rather than a setting.
        </Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={[styles.loaderBed, { backgroundColor: "#FFFFFF" }]}>
            <SwingLoader size={96} ground="light" />
          </View>
          <View style={[styles.loaderBed, { backgroundColor: "#172B4E" }]}>
            <SwingLoader size={96} ground="dark" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={[styles.loaderBed, { backgroundColor: "#FFFFFF", width: 64, height: 64 }]}>
            <SwingLoader size={44} ground="light" />
          </View>
          <View style={[styles.loaderBed, { backgroundColor: "#172B4E", width: 64, height: 64 }]}>
            <SwingLoader size={44} ground="dark" />
          </View>
          <Text style={styles.note}>At the size a section spinner actually runs.</Text>
        </View>
      </Section>

      <Section title="Loading — in use elsewhere">
        <View style={styles.specimens}>
          <Specimen name="CoachLoader" note="AI coach, fixed dark">
            <View style={styles.darkBed}>
              <CoachLoader size={72} />
            </View>
          </Specimen>
          <Specimen name="Shimmer" note="a card being worked on">
            <View style={styles.shimmerBed}>
              <Shimmer radius={10} />
            </View>
          </Specimen>
        </View>
      </Section>

      <Section title="Brand">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <BrandMark size={42} />
          <BrandLogo height={22} />
        </View>
      </Section>

      <Section title="Type — §03">
        <DisplayText>Swing Score</DisplayText>
        <TitleText>Afternoon Practice</TitleText>
        <HeadingText>Impact Position</HeadingText>
        <LabelText>Advanced Metrics</LabelText>
        <Eyebrow>Latest Swing</Eyebrow>
        <MetaText>12:42 PM · Front view</MetaText>
      </Section>

      <Section title="Buttons — §05">
        <View style={styles.row}>
          <Button label="Analyze swing" variant="primary" />
          <Button label="Compare" variant="performance" />
        </View>
        <View style={styles.row}>
          <Button label="Later" variant="secondary" />
          <Button label="Skip" variant="ghost" />
          <Button label="Delete" variant="danger" />
          <Button variant="icon" accessibilityLabel="Play">
            <Play size={17} color={t.text} />
          </Button>
        </View>
        <View style={styles.row}>
          <RecordButton />
          <RecordButton compact />
        </View>
      </Section>

      <Section title="Tags, deltas, chips — §05">
        <View style={styles.row}>
          <Tag label="Latest" variant="latest" />
          <Tag label="Best" variant="best" />
          <Tag label="On plane" variant="good" />
          <Tag label="Early extension" variant="issue" />
          <Tag label="Driver" variant="neutral" />
          <Tag label="7i" variant="neutral" compact />
        </View>
        <View style={styles.row}>
          <Delta value="+7" direction="up" />
          <Delta value="-5" direction="down" />
          <Chip label="60 FPS · DTL" />
          <Chip label="4 swings" translucent />
        </View>
      </Section>

      <Section title="Controls — §05">
        <Input label="Session name" placeholder="Afternoon practice" />
        <Segmented options={["Week", "Month", "Year"]} value={segment} onChange={setSegment} />
      </Section>

      <Section title="Scores — §06">
        <View style={styles.row}>
          <ScoreOrb score={86} caption="Overall" />
          <ScoreOrb score={74} size={56} color={t.cobalt} />
          <ScoreOrb score={52} size={40} color={t.bad} />
          <View style={{ backgroundColor: t.heroMid, borderRadius: 12, padding: 8 }}>
            <ScoreRing score={82} label="Trend" />
          </View>
        </View>
        <SwingProfile
          score={84}
          callouts={[
            { slot: "c1", value: "Setup 89", caption: "Stable base", tone: "good" },
            { slot: "c2", value: "Impact 74", caption: "Late release", tone: "bad" },
            { slot: "c3", value: "Tempo 3.0:1", caption: "Tour range", tone: "primary" },
          ]}
        />
        <SwingProfile score={84} compact />
        <ProgressTrack
          fraction={0.84}
          labels={{ start: "Last week 71", mid: "+13", end: "Goal 90" }}
        />
        <ProgressTrack fraction={0.72} height={4} variant="flat" />
      </Section>

      <Section title="Cards — §07">
        <PerformanceCard
          eyebrow="Hey Taylor — next time out"
          title="Spine forward bend at address"
          body="Bend forward more from the hips at address — you're standing too upright."
          actions={
            <>
              <Button label="See it on your swing" variant="performance" />
              <Button label="Later" variant="ghost" />
            </>
          }
        />
        <Panel>
          <PanelHead label="Session average" meta="Today · 9 swings" />
          <TitleText>82</TitleText>
        </Panel>
        <WeekStrip
          days={[
            { label: "MO", dayOfMonth: 11, hasSwings: true },
            { label: "TU", dayOfMonth: 12 },
            { label: "WE", dayOfMonth: 13, hasSwings: true },
            { label: "TH", dayOfMonth: 14, active: true, hasSwings: true },
            { label: "FR", dayOfMonth: 15 },
            { label: "SA", dayOfMonth: 16 },
            { label: "SU", dayOfMonth: 17 },
          ]}
        />
      </Section>

      <Section title="Snap carousel — the house carousel">
        <Text style={styles.note}>
          Center snap, both neighbours peeking, infinite loop, the frame&apos;s one X. Every deck
          size behaves differently on purpose: 0 collapses, 1 is static, 2+ loops. Dismissals
          here are local — Reset brings them back.
        </Text>
        <SnapCarouselDemo />
      </Section>

      <Section title="Portrait picker — choosing a person">
        <PortraitPickerDemo />
      </Section>

      <Section title="Lists — §08">
        <SwingTimelineList
          items={[
            {
              key: "1",
              title: "Swing 14",
              subtitle: "+4 vs session avg",
              subtitleTone: "positive",
              titleAccessory: <Tag label="Best" variant="best" compact />,
              score: 88,
            },
            {
              key: "2",
              title: "Swing 13",
              subtitle: "Early extension",
              subtitleTone: "negative",
              score: 71,
            },
            { key: "3", title: "Swing 12", subtitle: "Baseline", score: 79 },
          ]}
        />
        <CoachCard
          icon={<Target size={24} color="#0F2E4C" />}
          eyebrow="Priority focus"
          title="Keep the trail elbow tucked"
          body="Your top priority from the last session — 3 of 4 swings flagged it."
          right={<Tag label="High" variant="issue" />}
        />
        <Section title="Navigation — §10">
          <Button
            label={chromeHidden ? "Show chrome" : "Hide chrome"}
            variant="secondary"
            onPress={() => setChromeHidden((h) => !h)}
          />
          <View style={{ paddingTop: 40 }}>
            <WaveNav
              hidden={chromeHidden}
              onRecord={() => {}}
              items={[
                {
                  key: "home",
                  label: "Home",
                  active: true,
                  onPress: () => {},
                  icon: (c) => <House size={21} color={c} strokeWidth={2} />,
                },
                {
                  key: "swings",
                  label: "Swings",
                  onPress: () => {},
                  icon: (c) => <Rows3 size={21} color={c} strokeWidth={2} />,
                },
                {
                  key: "progress",
                  label: "Progress",
                  onPress: () => {},
                  icon: (c) => (
                    <ChartNoAxesColumnIncreasing size={21} color={c} strokeWidth={2} />
                  ),
                },
                {
                  key: "coach",
                  label: "Coach",
                  onPress: () => {},
                  icon: (c) => <Sparkles size={21} color={c} strokeWidth={2} />,
                },
              ]}
            />
          </View>
          <SessionPillNav
            hidden={chromeHidden}
            onNew={() => {}}
            style={{ marginHorizontal: 0 }}
            items={[
              {
                key: "end",
                label: "End session",
                tone: "end",
                onPress: () => {},
                icon: (c) => <AlignLeft size={18} color={c} strokeWidth={1.9} />,
              },
              {
                key: "delete",
                label: "Delete",
                tone: "danger",
                onPress: () => {},
                icon: (c) => <Trash2 size={18} color={c} strokeWidth={1.9} />,
              },
              {
                key: "fav",
                label: "Favorite",
                onPress: () => {},
                icon: (c) => <Star size={18} color={c} strokeWidth={1.9} />,
              },
              {
                key: "swings",
                label: "Swings",
                onPress: () => {},
                icon: (c) => <List size={18} color={c} strokeWidth={1.9} />,
              },
              {
                key: "latest",
                label: "Latest",
                tone: "latest",
                active: true,
                onPress: () => {},
                icon: (c) => <ArrowDownToLine size={18} color={c} strokeWidth={1.9} />,
              },
            ]}
          />
        </Section>

        <Section title="Sheet — the system bottom sheet">
          <MetaText>
            DeckSheet's mechanics on system tokens (the D61 absorption): two detents, drag,
            fling projection, hardware back. Closed = unmounted.
          </MetaText>
          <Button label="Open sheet" variant="secondary" onPress={() => setSheetOpen(true)} />
          <Sheet
            visible={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="System sheet"
            subtitle="Drag between detents; drag down to close"
          >
            {Array.from({ length: 14 }, (_, i) => (
              <LabelText key={i}>Row {i + 1}</LabelText>
            ))}
          </Sheet>
        </Section>

        <Section title="Sheet over backdrop — the scaffold">
          <MetaText>
            Scroll inside the frame: sheet rides over the hero with parallax; reaching the
            top opens the backdrop (footer slides away).
          </MetaText>
          <View style={{ height: 520, borderRadius: 20, overflow: "hidden" }}>
            <SheetOverBackdrop
              backdrop={
                <HeroBackdrop overscan={HERO_PARALLAX.cap}>
                  <View style={{ padding: 20, paddingTop: 28 }}>
                    <Eyebrow>SwingSage</Eyebrow>
                    <DisplayText color="#FFFFFF" style={{ marginTop: 8 }}>
                      Swing Log
                    </DisplayText>
                    <View style={{ marginTop: 14, alignSelf: "flex-start" }}>
                      <ScoreRing score={82} label="Trend" />
                    </View>
                  </View>
                </HeroBackdrop>
              }
              backdropHeight={300}
              initialOffset={150}
              overlap={74}
              stickyFooter={
                <SessionPillNav
                  onNew={() => {}}
                  items={[
                    {
                      key: "fav",
                      label: "Favorite",
                      onPress: () => {},
                      icon: (c) => <Star size={18} color={c} strokeWidth={1.9} />,
                    },
                    {
                      key: "latest",
                      label: "Latest",
                      tone: "latest",
                      active: true,
                      onPress: () => {},
                      icon: (c) => <ArrowDownToLine size={18} color={c} strokeWidth={1.9} />,
                    },
                  ]}
                />
              }
            >
              <View style={{ padding: 16, gap: 10 }}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <Panel key={n}>
                    <PanelHead label={`Session ${n}`} meta="3 swings" />
                    <TitleText>{70 + n}</TitleText>
                  </Panel>
                ))}
              </View>
            </SheetOverBackdrop>
          </View>
        </Section>

        <StickThumb
          figure={{
            ground: "M4 38 H38",
            bones: ["M21 10 L21 22 M21 22 L14 34 M21 22 L28 34", "M21 14 L12 20"],
            accents: ["M21 14 L30 8"],
            traces: ["M30 8 C 34 16 30 28 22 34"],
            joints: [
              { x: 21, y: 10 },
              { x: 21, y: 22 },
              { x: 12, y: 20 },
              { x: 30, y: 8 },
            ],
          }}
        />
      </Section>
    </ScrollView>
  );
}

/** The picker with its own local choice — the spec's job is showing both states at once. */
/**
 * The SnapCarousel harness — every deck size the component special-cases (0, 1, 2, 5),
 * with real dismissal so the reflow and the collapse-to-nothing can be eyeballed on glass.
 */
function SnapCarouselDemo() {
  const t = useTheme();
  const styles = useStyles();
  const [size, setSize] = useState("5");
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const deck = ["Multiview", "Go Pro", "240fps", "Milestone", "One year"]
    .slice(0, Number(size))
    .filter((label) => !dismissed.has(label));

  const beds = [t.cobalt, t.aqua, t.heroMid, t.cobalt, t.aqua];

  return (
    <View style={{ gap: 12 }}>
      <Segmented options={["0", "1", "2", "5"]} value={size} onChange={setSize} />
      {/* Negative margin returns the carousel to true screen width — the gallery's content
          padding would otherwise shrink the geometry the harness exists to judge. */}
      <View style={{ marginHorizontal: -16 }}>
        <SnapCarousel
          items={deck.map((label, i) => ({
            key: label,
            render: (w) => (
              <View
                style={{
                  width: w,
                  height: 132,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: beds[i % beds.length],
                }}
              >
                <Text style={{ color: t.onDark, fontSize: 16, fontWeight: "700" }}>{label}</Text>
              </View>
            ),
          }))}
          cardHeight={132}
          onDismiss={(key) => setDismissed((prev) => new Set(prev).add(key))}
          dismissLabel={(key) => `Dismiss ${key}`}
        />
      </View>
      {dismissed.size > 0 ? (
        <Button label="Reset dismissed" variant="ghost" onPress={() => setDismissed(new Set())} />
      ) : null}
    </View>
  );
}

function PortraitPickerDemo() {
  const [id, setId] = useState(COACHES[0].id as string);
  return (
    <PortraitPicker
      options={COACHES.map((c) => ({
        id: c.id,
        name: c.name,
        tag: c.voiceLabel,
        blurb: c.style,
        image: c.portrait,
      }))}
      selectedId={id}
      onSelect={setId}
    />
  );
}

/**
 * A named sample. The NAME is the point — a gallery of unlabelled swatches cannot be talked
 * about, and "the second one" stops meaning anything the moment the row is reordered.
 */
function Specimen({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.specimen}>
      {children}
      <Text style={styles.specimenName}>{name}</Text>
      <Text style={styles.specimenNote}>{note}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTag}>{title}</Text>
      {children}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 22 },
  section: { gap: 12 },
  sectionTag: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 9 },
  note: { color: t.muted, fontSize: 12, lineHeight: 17 },
  specimens: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  specimen: { width: 118, alignItems: "center", gap: 5 },
  /* The lockup on its own ground, at review size. */
  lockupRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderRadius: 12,
  },
  /* Both grounds side by side, on LITERAL beds: the app's current theme must not be allowed to
     change which of the two is being judged. */
  loaderBed: {
    width: 112,
    height: 112,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  /* CoachLoader is a fixed-dark surface component, so it keeps a dark bed. */
  darkBed: {
    width: 96,
    height: 96,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#181818",
  },
  shimmerBed: {
    width: 96,
    height: 96,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: t.surface2,
  },
  specimenName: { color: t.text, fontSize: 11, fontWeight: "600" },
  specimenNote: { color: t.muted2, fontSize: 9, textAlign: "center", lineHeight: 12 },

}));
