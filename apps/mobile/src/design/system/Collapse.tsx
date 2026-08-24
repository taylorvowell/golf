import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, View, type LayoutChangeEvent } from "react-native";

const OPEN_MS = 360;
const CLOSE_MS = 260;

/**
 * Content that slides open and shut.
 *
 * **The measured child is absolutely positioned, and that is the whole trick.** The obvious
 * version — a clipped box whose height animates, with the children in normal flow inside it —
 * deadlocks: the box starts at height 0, so the children are laid out inside a zero-height
 * parent, so `onLayout` reports 0, so the box never learns a height to open to and the content
 * never appears. Pinning the measured view `position: absolute` takes it out of the parent's
 * height entirely, so it always reports its natural size no matter what the box is doing.
 *
 * **The animated value is in PIXELS, not 0→1.** A 0→1 value needs an `interpolate` whose
 * `outputRange` is rebuilt every time the measurement changes, and the rebuilt node is a second
 * place for the current height to be wrong. One value holding the real number has no such seam,
 * and a content change while open is a `setValue`, not a re-derivation.
 *
 * **`useNativeDriver: false`, and nothing native shares the style object.** `height` is a layout
 * property the native driver cannot animate; pairing it with a native-driven `opacity` in one
 * style makes React Native reject the layout half outright and the animation simply never
 * happens (`.claude/rules/react-native.md`).
 *
 * **Opening is slower than closing.** Open is the reveal — the eye follows the content down and
 * a fast one reads as a jump-cut; shut is a dismissal, and dragging it out just makes the row feel
 * sticky. Hence two durations rather than one symmetric constant (Taylor, 2026-08-22).
 *
 * **Closed stays mounted** so it is measured before it is ever opened — the first open animates
 * to a known height instead of jumping to it on the second frame. `pointerEvents` is what makes
 * closed content unreachable, so a screen reader never reads a collapsed section.
 */
export function Collapse({
  open,
  /** Room above the content when open — the caller's own spacing, inside the animation. */
  topGap = 0,
  children,
}: {
  open: boolean;
  topGap?: number;
  children: ReactNode;
}) {
  const height = useRef(new Animated.Value(0)).current;
  /** The content's natural height, written by layout — never state, so it cannot re-render. */
  const measured = useRef(0);
  /** Read inside `onLayout`, which is an event and can fire before the effect below commits. */
  const openRef = useRef(open);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (next === measured.current) return;
    measured.current = next;
    // A content change while open is applied instantly. Animating here would replay the whole
    // open every time a row was added — the arriving-import row does exactly that.
    if (openRef.current) height.setValue(next);
  };

  useEffect(() => {
    openRef.current = open;
    Animated.timing(height, {
      toValue: open ? measured.current : 0,
      duration: open ? OPEN_MS : CLOSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [height, open]);

  return (
    <Animated.View style={{ height, overflow: "hidden" }} pointerEvents={open ? "auto" : "none"}>
      <View
        // Never flattened away: a view with `onLayout` has to survive Android's view reduction.
        collapsable={false}
        style={{ position: "absolute", left: 0, right: 0, top: 0, paddingTop: topGap }}
        onLayout={onLayout}
      >
        {children}
      </View>
    </Animated.View>
  );
}
