import { Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { Upload, Video } from "lucide-react-native";

import { SCROLL_PRESS_DELAY_MS } from "../../design/system/press";
import { FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";

/**
 * The log's first-run moment: two full-width doors where the session list will be.
 *
 * When the log is empty the hero's small Record/Upload pills hide and these take over — a
 * golfer with zero swings needs one obvious next step, not a hunt for two 31-px pills in the
 * title row. Same two destinations, sized for the moment; the pills come back the moment the
 * first swing exists.
 *
 * The Record door plays a bundled swing clip as its background — a styling element, not a
 * player: muted, looping, no controls, and the whole card is still just a button.
 */
export function FirstSwingCta({
  onRecord,
  onUpload,
}: {
  onRecord: () => void;
  onUpload: () => void;
}) {
  const t = useTheme();
  const styles = useStyles();

  const player = useVideoPlayer(
    require("../../../assets/videos/record-swing-video.mp4"),
    (p) => {
      // Decorative background: silent, endless, never paused by a control.
      p.muted = true;
      p.loop = true;
      p.play();
    },
  );

  return (
    <View style={styles.wrap} testID="swing-log-empty">
      <Text style={styles.title}>Get started</Text>
      <Text style={styles.lede}>
        Your log begins with one swing — record one now, or upload one you have already filmed.
      </Text>
      <View style={styles.doors}>
        <Pressable
          testID="swing-log-empty-record"
          accessibilityRole="button"
          accessibilityLabel="Record your first swing"
          accessibilityHint="Film it with this phone, down the line or face on."
          onPress={onRecord}
          // Inside the sheet's scroll surface — instant feedback would flash on every
          // scroll that starts on the card.
          unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
          style={styles.videoDoor}
        >
          {({ pressed }) => (
            <>
              <VideoView
                player={player}
                nativeControls={false}
                contentFit="cover"
                // A SurfaceView ignores the parent's rounding and clipping entirely — the
                // standing rule: every video in this app rides a textureView.
                surfaceType="textureView"
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
              />
              {/* Bottom-heavy scrim so the copy reads over any frame of the clip. Fixed dark
                  values, not theme tokens — this sits on footage, same as the capture chrome. */}
              <LinearGradient
                pointerEvents="none"
                colors={
                  pressed
                    ? ["rgba(6,10,20,0.38)", "rgba(6,10,20,0.86)"]
                    : ["rgba(6,10,20,0.10)", "rgba(6,10,20,0.72)"]
                }
                style={StyleSheet.absoluteFill}
              />
              {/* The press deepens the scrim — a fill step, footage edition. Opacity on the
                  card itself would flash the sheet through the picture. */}
              <View style={styles.videoRow}>
                <View style={[styles.glyph, styles.glyphOnVideo]}>
                  <Video size={22} color={t.onDark} strokeWidth={2.3} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.doorTitle, { color: t.onDark }]}>
                    Record your first swing
                  </Text>
                  <Text style={[styles.doorDetail, styles.doorDetailOnVideo]}>
                    Film it with this phone, down the line or face on.
                  </Text>
                </View>
              </View>
            </>
          )}
        </Pressable>

        <Pressable
          testID="swing-log-empty-upload"
          accessibilityRole="button"
          accessibilityLabel="Upload a swing"
          accessibilityHint="Pick a video you have already filmed."
          onPress={onUpload}
          unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
          style={({ pressed }) => [
            styles.door,
            styles.doorPlain,
            // The flat-UI press on a themed surface: a fill step, never opacity.
            pressed && styles.doorPlainPressed,
          ]}
        >
          <View style={[styles.glyph, styles.glyphPlain]}>
            <Upload size={22} color={t.cobalt} strokeWidth={2.3} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.doorTitle, { color: t.text }]}>Upload a swing</Text>
            <Text style={styles.doorDetail}>Pick a video you have already filmed.</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  wrap: { paddingTop: 26, paddingBottom: 12, gap: 8 },
  title: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 20,
    textAlign: "center",
  },
  lede: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 300,
    alignSelf: "center",
  },
  doors: { marginTop: 16, gap: 10 },
  /** The footage card: tall enough for the clip to read as a picture, copy pinned to the
   *  bottom where the scrim is deepest. Cobalt underneath while the first frame decodes. */
  videoDoor: {
    minHeight: 168,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: t.cobalt,
    justifyContent: "flex-end",
  },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  door: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 84,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 22,
  },
  doorPlain: { backgroundColor: t.surface },
  doorPlainPressed: { backgroundColor: t.surface2 },
  glyph: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphOnVideo: { backgroundColor: "rgba(255,255,255,0.18)" },
  glyphPlain: { backgroundColor: t.surfaceBlue },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  doorTitle: { fontFamily: FONT_DISPLAY.extraBold, fontSize: 16 },
  doorDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 17 },
  doorDetailOnVideo: { color: "rgba(255,255,255,0.82)" },
}));
