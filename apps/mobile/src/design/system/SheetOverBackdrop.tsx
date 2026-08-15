import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type RefreshControlProps,
} from "react-native";

import { useTheme } from "../../theme";
import { SheetHandle } from "./SheetHandle";

/**
 * The screen-level scaffold behind Swing Log, Swing Report and Progress: a fixed full-bleed
 * backdrop with a rounded sheet scrolling up over it. The mockup's JS is the spec, mapped 1:1:
 *
 * - Parallax: backdrop translateY = min(scrollY × factor, cap) — downward, so the backdrop
 *   sinks slowly under the rising sheet (Log .22/72, Report .18/64).
 * - "Open" when scrollY < threshold (60): the host's `backdropOverlay` fades/slides in
 *   (opacity 0→1, translateY 24→0, 280ms) and the sticky footer slides away. Hysteresis of
 *   12px on the way closed so the boundary never flickers.
 * - `initialOffset` lands the first paint with the sheet riding partway up (Log 170,
 *   Report 520).
 *
 * One Animated.Value drives everything through native-driver interpolations; the scroll
 * listener only flips React state on threshold CROSSINGS, never per frame — cold code, but
 * the player's discipline anyway.
 */
export function SheetOverBackdrop({
  backdrop,
  backdropHeight,
  parallax = { factor: 0.22, cap: 72 },
  openThreshold = 60,
  initialOffset = 0,
  overlap = 74,
  onOpenChange,
  openSheetDrop = 0,
  children,
  stickyFooter,
  backdropOverlay,
  sheetStyle,
  refreshControl,
  scrollRef,
  testID,
}: {
  /** The fixed layer (a `HeroBackdrop`, the report's video). Fills the screen. */
  backdrop: ReactNode;
  /** How much of the backdrop shows above the sheet's resting edge (the spacer height). */
  backdropHeight: number;
  parallax?: { factor: number; cap: number };
  openThreshold?: number;
  initialOffset?: number;
  /** How far the sheet's rounded top rides over the backdrop (Log 74, Report 92). */
  overlap?: number;
  onOpenChange?: (open: boolean) => void;
  /**
   * How far the sheet body drops while open (the report's `.video-open .report-v2-sheet`
   * +132px), so its resting peek clears the screen's bottom edge and the backdrop is truly
   * full-bleed. 0 (the default, the Log's behaviour) leaves the sheet where the scroll put it.
   */
  openSheetDrop?: number;
  children: ReactNode;
  /** Floats at the screen's bottom edge over the sheet; slides away while open. */
  stickyFooter?: ReactNode;
  /** Interactive chrome shown over the backdrop only while open (the report's controls). */
  backdropOverlay?: ReactNode;
  sheetStyle?: object;
  /** A RefreshControl for the sheet's scroll (pull-to-refresh stays a host concern). */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Imperative seam: the host scrolls (e.g. a "show video" tap → top = backdrop open). */
  scrollRef?: React.RefObject<{ scrollTo: (opts: { y: number; animated?: boolean }) => void } | null>;
  testID?: string;
}) {
  const t = useTheme();
  const scrollY = useRef(new Animated.Value(initialOffset)).current;
  const [open, setOpen] = useState(initialOffset < openThreshold);
  const openRef = useRef(open);

  // 280ms fade/slide for overlay + footer, mirroring the mockup's transition timings.
  const openAnim = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(openAnim, {
      toValue: open ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
    onOpenChange?.(open);
  }, [open, openAnim, onOpenChange]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      // Hysteresis: open crossing down through the threshold, close only 12px past it, so
      // a finger resting exactly on the line never strobes the chrome.
      if (!openRef.current && y < openThreshold) {
        openRef.current = true;
        setOpen(true);
      } else if (openRef.current && y > openThreshold + 12) {
        openRef.current = false;
        setOpen(false);
      }
    },
    [openThreshold],
  );

  /**
   * The animated plumbing is hoisted so it survives re-renders of the HOST. The report screen
   * hosts this scaffold from the component that owns the video transport, which re-renders per
   * presented frame — an `Animated.event` or interpolation built inline in JSX would be a new
   * node 60×/s, each one re-attached to the native driver. Hoisted, a host render reconciles
   * the same nodes and attaches nothing.
   */
  const onScrollEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: onScroll,
      }),
    [scrollY, onScroll],
  );
  const parallaxY = useMemo(
    () =>
      scrollY.interpolate({
        inputRange: [0, parallax.cap / parallax.factor],
        outputRange: [0, parallax.cap],
        extrapolate: "clamp",
      }),
    [scrollY, parallax.cap, parallax.factor],
  );
  const overlaySlide = useMemo(
    () => openAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
    [openAnim],
  );
  const footerFade = useMemo(
    () => openAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    [openAnim],
  );
  const footerSlide = useMemo(
    () => openAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 118] }),
    [openAnim],
  );
  // The sheet's own drop rides a separate clock: the mockup gives it .32s against the
  // chrome's .28s, and that 40ms is visible — the sheet settles just after the controls land.
  const sheetDrop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(sheetDrop, {
      toValue: open ? openSheetDrop : 0,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [open, openSheetDrop, sheetDrop]);

  return (
    <View style={{ flex: 1 }} testID={testID}>
      {/* The fixed backdrop, sinking under the sheet at the parallax rate. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ translateY: parallaxY }] }]}
      >
        {backdrop}
      </Animated.View>

      <Animated.ScrollView
        ref={scrollRef as never}
        testID={testID ? `${testID}-scroll` : undefined}
        // Lets the gallery host an instance inside its own scroll; no effect full-screen.
        nestedScrollEnabled
        refreshControl={refreshControl}
        contentOffset={{ x: 0, y: initialOffset }}
        onScroll={onScrollEvent}
        scrollEventThrottle={16}
        // The parallax cap must never be visually exceeded — no rubber-banding above 0.
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {/* Transparent spacer — the backdrop shows through; touches here scroll. */}
        <View style={{ height: backdropHeight }} pointerEvents="none" />
        <Animated.View
          style={[
            {
              flexGrow: 1,
              marginTop: -overlap,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              backgroundColor: t.bgElevated,
              ...t.shadowLg,
              transform: [{ translateY: sheetDrop }],
            },
            sheetStyle,
          ]}
        >
          <SheetHandle />
          {children}
        </Animated.View>
      </Animated.ScrollView>

      {/* Backdrop chrome: present only while open; 0→1 / 24→0 like `.video-open`'s shell. */}
      {backdropOverlay != null && (
        <Animated.View
          testID={testID ? `${testID}-overlay` : undefined}
          pointerEvents={open ? "box-none" : "none"}
          style={[
            StyleSheet.absoluteFill,
            { opacity: openAnim, transform: [{ translateY: overlaySlide }] },
          ]}
        >
          {backdropOverlay}
        </Animated.View>
      )}

      {/* The floating footer (a SessionPillNav): slides away while the backdrop is open. */}
      {stickyFooter != null && (
        <Animated.View
          testID={testID ? `${testID}-footer` : undefined}
          pointerEvents={open ? "none" : "box-none"}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 12,
            opacity: footerFade,
            transform: [{ translateY: footerSlide }],
          }}
        >
          {stickyFooter}
        </Animated.View>
      )}
    </View>
  );
}
