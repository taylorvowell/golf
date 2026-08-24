import { memo } from "react";
import Svg, { Path, Rect } from "react-native-svg";

/**
 * A QR-shaped block, drawn from a seed so the same code always draws the same pattern.
 *
 * This is a **placeholder**, not an encoder: dual-device pairing is not wired yet, and the
 * sync sheet needs its real shape to be reviewable now. It lives here because SVG belongs to
 * `design/system` and `design/gauges` and nowhere else (`.claude/rules/react-native.md`).
 * When pairing lands, this component is replaced by a real encoder behind the same props —
 * the sheet does not change.
 *
 * One `Path` for every dark module rather than ~200 `Rect` nodes: the node count IS the cost,
 * and a sheet that stutters as it slides is the only way a static graphic can be slow.
 */

const GRID = 21;
/** Quiet zone, in modules. A QR with no margin does not scan; the placeholder keeps the shape. */
const QUIET = 2;

/** xorshift32 seeded from the string — deterministic, so a code's pattern never flickers. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** The three corner squares — the part that makes it read as a QR rather than as noise. */
function isFinder(row: number, col: number): boolean {
  const inBlock = (r: number, c: number) => r >= 0 && r < 7 && c >= 0 && c < 7;
  return (
    inBlock(row, col) || inBlock(row, col - (GRID - 7)) || inBlock(row - (GRID - 7), col)
  );
}

export interface QrPlaceholderProps {
  /** The pairing code. Same code, same pattern. */
  value: string;
  size: number;
}

export const QrPlaceholder = memo(function QrPlaceholder({ value, size }: QrPlaceholderProps) {
  const span = GRID + QUIET * 2;
  const rand = seeded(value);
  let modules = "";

  const push = (row: number, col: number) => {
    const x = col + QUIET;
    const y = row + QUIET;
    modules += `M${x} ${y}h1v1h-1z`;
  };

  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      if (isFinder(row, col)) continue;
      if (rand() > 0.55) push(row, col);
    }
  }

  // The finder squares, drawn as rings so they read as the real thing.
  const finders: Array<[number, number]> = [
    [0, 0],
    [0, GRID - 7],
    [GRID - 7, 0],
  ];

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
      <Rect x={0} y={0} width={span} height={span} rx={1.5} fill="#FFFFFF" />
      <Path d={modules} fill="#0A1A29" />
      {finders.map(([row, col]) => (
        <Rect
          key={`${row}-${col}`}
          x={col + QUIET}
          y={row + QUIET}
          width={7}
          height={7}
          rx={1}
          fill="none"
          stroke="#0A1A29"
          strokeWidth={1}
        />
      ))}
      {finders.map(([row, col]) => (
        <Rect
          key={`core-${row}-${col}`}
          x={col + QUIET + 2}
          y={row + QUIET + 2}
          width={3}
          height={3}
          rx={0.6}
          fill="#0A1A29"
        />
      ))}
    </Svg>
  );
});
