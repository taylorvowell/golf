import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Play } from "lucide-react-native";

import {
  SCROLL_PRESS_DELAY_MS,
  SwingProfile,
  Tag,
  type ProfileCallout,
} from "../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { useTheme } from "../../theme";
import type { ReportViewModel } from "./selectors";

/**
 * `.report-content` (the report mockup's sheet): header, the confidence indicator, the focus
 * block (video thumb · biggest opportunity · coach advice), the orbital board, the split
 * panels and the metric chips. Pure presentation of the selector's view-model — every number
 * traces to the coach report, and an abstention renders as an abstention.
 *
 * Named deviation: the mockup header's three-dot slot is EMPTY here — the page's back door is
 * the screen-level floating orb (always visible, every scroll state), and a second back button
 * a hand-width from it is exactly the repetition the restraint rule cuts.
 */
export function ReportSheet({
  vm,
  swingId,
  onShowVideo,
  hideHeader = false,
  onBoardLayout,
}: {
  vm: ReportViewModel;
  swingId: string;
  /**
   * Drop the sheet's own identity block — for a host that already names the swing on screen.
   * That block is the title, the brand line AND the score/coverage chip: on the post-swing tab
   * the golfer opened this to read the ANALYSIS, and the first thing under their thumb being a
   * restatement of the score they were just shown is the clutter rule's own example (Taylor).
   */
  hideHeader?: boolean;
  /** Scrolls the scaffold to the top — the video-open state (live video in step 07). */
  onShowVideo: () => void;
  /** Reports the swing-profile board's y within this sheet — the score door's scroll target. */
  onBoardLayout?: (y: number) => void;
}) {
  const t = useTheme();
  const thumb = useAuthenticatedImage(`swings/${swingId}/thumb?poster=1`);

  const callouts: ProfileCallout[] = [];
  if (vm.board.strongest) {
    callouts.push({
      slot: "c1",
      value: `${vm.board.strongest.label} ${vm.board.strongest.score}`,
      caption: "strongest phase",
      tone: "good",
    });
  }
  if (vm.board.weakest) {
    callouts.push({
      slot: "c2",
      value: `${vm.board.weakest.label} ${vm.board.weakest.score}`,
      caption: "biggest opportunity",
      tone: "bad",
    });
  }
  if (vm.board.tempo) {
    callouts.push({
      slot: "c3",
      value: `Tempo ${vm.board.tempo.ratio}`,
      caption: vm.board.tempo.verdict,
      tone: "primary",
    });
  }

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {/* .report-header — dropped in `hideHeader`: on the post-swing tab the swing's name, the
          brand and the view are all already on the screen behind this sheet, and repeating them
          in a strip the golfer pulls up costs the room the analysis itself wants. */}
      {hideHeader ? null : (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              color: t.aqua,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 9,
              letterSpacing: 1.62,
              textTransform: "uppercase",
            }}
          >
            SwingSage
          </Text>
          <Text
            style={{
              marginTop: 5,
              color: t.text,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 28,
              lineHeight: displayLine(28),
              letterSpacing: -0.56,
            }}
          >
            {vm.header.title}
          </Text>
          <Text
            style={{
              marginTop: 6,
              color: t.muted,
              fontFamily: FONT_BODY.bold,
              fontSize: 9,
            }}
          >
            {vm.header.meta}
          </Text>
        </View>
      </View>
      )}

      {/* .session-indicator — the confidence line. Part of the identity block, so it goes with it. */}
      {hideHeader ? null : (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          alignSelf: "flex-start",
          minHeight: 32,
          paddingHorizontal: 10,
          marginTop: 12,
          borderRadius: 7,
          backgroundColor: t.surface2,
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.aqua }} />
        {vm.indicator.band != null && (
          <Text
            style={{
              color: t.text,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 9,
              letterSpacing: 0.54,
              textTransform: "uppercase",
            }}
          >
            {vm.indicator.band}
          </Text>
        )}
        <Text style={{ color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 8 }}>
          {vm.indicator.coverage}
        </Text>
      </View>
      )}

      {/* .report-focus — thumb column + the biggest opportunity. */}
      {vm.focus != null && (
        <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
          {/* .report-video — static tile; the live layer is the backdrop (step 07). */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show full video"
            onPress={onShowVideo}
            unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
            style={{
              width: 126,
              height: 168,
              borderRadius: 12,
              overflow: "hidden",
              backgroundColor: "#101A2A",
            }}
          >
            {({ pressed }) => (
              <>
                {thumb ? (
                  <Image
                    source={thumb}
                    style={{ position: "absolute", inset: 0 }}
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                ) : null}
                {/* .report-play — the aqua play circle. */}
                <View
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "48%",
                    marginLeft: -24,
                    marginTop: -24,
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: t.aqua,
                  }}
                >
                  <Play size={16} color="#10204A" fill="#10204A" strokeWidth={0} />
                </View>
                {/* Pressed reads as a shade over the footage — a fill on top, because a surface
                    swap has nothing to show through a photograph. */}
                {pressed ? (
                  <View
                    pointerEvents="none"
                    style={{ position: "absolute", inset: 0, backgroundColor: "rgba(7,16,31,0.28)" }}
                  />
                ) : null}
              </>
            )}
          </Pressable>
          {/* .focus-copy */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                color: t.aqua,
                fontFamily: FONT_DISPLAY.black,
                fontSize: 7,
                letterSpacing: 0.98,
                textTransform: "uppercase",
              }}
            >
              {vm.focus.eyebrow}
            </Text>
            <Text
              style={{
                marginTop: 8,
                color: t.text,
                fontFamily: FONT_DISPLAY.black,
                fontSize: 18,
                lineHeight: displayLine(18),
                letterSpacing: -0.36,
              }}
            >
              {vm.focus.issue}
            </Text>
            <Text
              style={{
                marginTop: 7,
                color: t.textSoft,
                fontFamily: FONT_BODY.regular,
                fontSize: 9,
                lineHeight: 14,
              }}
            >
              {vm.focus.description}
            </Text>
            {vm.focus.coachAdvice != null && (
              <View
                style={{
                  marginTop: 8,
                  padding: 9,
                  borderRadius: 8,
                  backgroundColor: t.surface2,
                }}
              >
                <Text
                  style={{
                    color: t.cobalt,
                    fontFamily: FONT_DISPLAY.black,
                    fontSize: 7,
                    letterSpacing: 0.84,
                    textTransform: "uppercase",
                  }}
                >
                  Coach advice
                </Text>
                <Text
                  style={{
                    marginTop: 5,
                    color: t.textSoft,
                    fontFamily: FONT_BODY.regular,
                    fontSize: 8,
                    lineHeight: 12,
                  }}
                >
                  {vm.focus.coachAdvice}
                </Text>
              </View>
            )}
            {vm.focus.tags.length > 0 && (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                {vm.focus.tags.map((tag) => (
                  <Tag key={tag} label={tag} variant="neutral" />
                ))}
              </View>
            )}
          </View>
        </View>
      )}

      {/* .report-board */}
      <View
        style={{ marginTop: 20 }}
        // Where the swing score LIVES, relative to this sheet's root — the score door's scroll
        // target. Measured, not estimated: the focus block above it varies by report.
        onLayout={
          onBoardLayout ? (e) => onBoardLayout(e.nativeEvent.layout.y) : undefined
        }
      >
        {hideHeader ? null : (
          <Text
            style={{
              color: t.aqua,
              fontFamily: FONT_DISPLAY.black,
              fontSize: 8,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            Swing profile
          </Text>
        )}
        <Text
          style={{
            marginTop: 7,
            color: t.text,
            fontFamily: FONT_DISPLAY.black,
            fontSize: 22,
            lineHeight: displayLine(22),
            letterSpacing: -0.44,
          }}
        >
          {vm.board.headline}
        </Text>
        <Text
          style={{
            marginTop: 7,
            color: t.textSoft,
            fontFamily: FONT_BODY.regular,
            fontSize: 9,
            lineHeight: 14,
          }}
        >
          {vm.board.copy}
        </Text>
        {vm.board.overall !== null ? (
          <SwingProfile
            score={vm.board.overall}
            callouts={callouts}
            style={{ marginTop: 10 }}
            accessibilityLabel={`Swing score ${vm.board.overall}${
              vm.board.strongest
                ? `, ${vm.board.strongest.label} ${vm.board.strongest.score}`
                : ""
            }${
              vm.board.weakest
                ? `, ${vm.board.weakest.label} ${vm.board.weakest.score}`
                : ""
            }`}
          />
        ) : (
          <Text
            style={{
              marginTop: 12,
              color: t.muted,
              fontFamily: FONT_BODY.bold,
              fontSize: 10,
            }}
          >
            Not scored
          </Text>
        )}
      </View>

      {/* .report-split */}
      {(vm.split.positive || vm.split.opportunity) && (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          {vm.split.positive && (
            <View
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 12,
                backgroundColor: t.surface,
              }}
            >
              <Text
                style={{
                  color: t.good,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: 8,
                  letterSpacing: 0.64,
                  textTransform: "uppercase",
                }}
              >
                {vm.split.positive.title}
              </Text>
              <Text
                style={{
                  marginTop: 5,
                  color: t.textSoft,
                  fontFamily: FONT_BODY.regular,
                  fontSize: 8,
                  lineHeight: 12,
                }}
              >
                {vm.split.positive.body}
              </Text>
            </View>
          )}
          {vm.split.opportunity && (
            <View
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 12,
                backgroundColor: t.surface,
              }}
            >
              <Text
                style={{
                  color: t.bad,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: 8,
                  letterSpacing: 0.64,
                  textTransform: "uppercase",
                }}
              >
                {vm.split.opportunity.title}
              </Text>
              <Text
                style={{
                  marginTop: 5,
                  color: t.textSoft,
                  fontFamily: FONT_BODY.regular,
                  fontSize: 8,
                  lineHeight: 12,
                }}
              >
                {vm.split.opportunity.body}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* .report-metrics */}
      {vm.chips.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {vm.chips.map((chip) => (
            <View
              key={chip}
              style={{
                minHeight: 25,
                paddingHorizontal: 7,
                borderRadius: 5,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.surface3,
              }}
            >
              <Text
                style={{
                  color: t.textSoft,
                  fontFamily: FONT_DISPLAY.black,
                  fontSize: 7,
                  letterSpacing: 0.28,
                }}
              >
                {chip}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
