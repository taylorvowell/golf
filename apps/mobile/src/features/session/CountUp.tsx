import { useEffect, useRef, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

/**
 * A number that rolls to its new value instead of jumping (the log's stat tiles when a
 * session arrives). Renders plain text while the value is stable; on change it eases from
 * the old value over ~650ms. Interval-driven state, cold surface only — never mount this
 * anywhere near a per-frame path.
 */

export function CountUp({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const [display, setDisplay] = useState(value);
  const shown = useRef(value);

  useEffect(() => {
    const from = shown.current;
    if (from === value) return;
    const start = Date.now();
    const duration = 650;
    const tick = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shown.current = next;
      setDisplay(next);
      if (p >= 1) clearInterval(tick);
    }, 40);
    return () => clearInterval(tick);
  }, [value]);

  return <Text style={style}>{display}</Text>;
}
