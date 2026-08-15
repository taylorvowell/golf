import { Text, type TextProps, type TextStyle } from "react-native";

import { useTheme } from "../../theme";
import { TYPE } from "./typography";

/**
 * The type system as components (mockup §03). Every screen says `<TitleText>` instead of
 * restating sizes; the scale itself lives in `typography.ts` and is spread here, so a scale
 * change is one edit. `color` overrides the theme default (e.g. `onDark` inside a hero card);
 * everything else about the face is fixed on purpose — a screen that needs a seventh size is
 * a design change, not a prop.
 */
type SystemTextProps = TextProps & { color?: string };

function make(
  name: string,
  scale: TextStyle,
  defaultColor: (t: ReturnType<typeof useTheme>) => string,
  extra?: TextStyle,
) {
  function SystemText({ color, style, ...rest }: SystemTextProps) {
    const t = useTheme();
    return (
      <Text
        {...rest}
        style={[scale, extra, { color: color ?? defaultColor(t) }, style]}
      />
    );
  }
  SystemText.displayName = name;
  return SystemText;
}

/** `.t32` — page titles, major scores. */
export const DisplayText = make("DisplayText", TYPE.display, (t) => t.text);
/** `.t24` — session headers, card heroes. */
export const TitleText = make("TitleText", TYPE.title, (t) => t.text);
/** `.t18` — section and finding headings. */
export const HeadingText = make("HeadingText", TYPE.heading, (t) => t.text);
/** `.t14` — control and row labels. */
export const LabelText = make("LabelText", TYPE.label, (t) => t.text);
/** `.eyebrow` / `.t11` — uppercase kickers; aqua by default, exactly as the mockup's. */
export const Eyebrow = make("Eyebrow", TYPE.eyebrow, (t) => t.aqua);
/** `.t10` — timestamps, view names, footnotes (body face). */
export const MetaText = make("MetaText", TYPE.meta, (t) => t.muted);
