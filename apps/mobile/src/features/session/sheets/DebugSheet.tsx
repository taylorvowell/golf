import { Fragment, useCallback, useEffect, useRef } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { RotateCw } from "lucide-react-native";

import { Sheet } from "../../../design/system/Sheet";
import { FONT_DISPLAY } from "../../../design/system/typography";
import { appStyles, useAppTheme } from "../../../theme";

/**
 * The dev panel behind the amber DEBUG tab — a way to reach states that are expensive or
 * impossible to produce on demand.
 *
 * An analysis failure is the example that forced it: proving that screen works otherwise means
 * deliberately filming a bad swing and waiting for the pipeline to give up. This is not a
 * shortcut around verification — it exercises the SCREEN, never the pipeline, and nothing here
 * proves the real states are ever reached.
 *
 * **Deliberately dense** (Taylor, 2026-08-19): one compact header row ("Debug Menu" + the
 * Reload pill), no per-row descriptions, tight rows — a power-user surface, function over
 * beauty. `detail` stays on the interfaces
 * so contributors can document their controls in code, but it is never rendered. A group with
 * `inline: true` renders its actions as a single wrapped row of chips. ALL toggles — whichever
 * group contributed them — render as one untitled block at the very top; a group's title only
 * appears above its actions.
 *
 * `__DEV__` only, and the caller is expected to gate on it too, so nothing about this — including
 * the layout space it takes — can reach a release build.
 */

export interface DebugAction {
  key: string;
  label: string;
  /** Documentation for the code reader — not rendered. */
  detail?: string;
  onPress: () => void;
}

export interface DebugToggle {
  key: string;
  label: string;
  /** Documentation for the code reader — not rendered. */
  detail?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

export interface DebugGroup {
  title: string;
  /** Render actions as one wrapped row of small chips instead of full-width rows. */
  inline?: boolean;
  actions?: DebugAction[];
  toggles?: DebugToggle[];
}

export interface DebugSheetProps {
  visible: boolean;
  onClose: () => void;
  groups: DebugGroup[];
  /** Renders the refresh button in the sheet's top-right. Fires immediately — no run delay. */
  onRefresh?: () => void;
}

/**
 * How long the panel stays out of the way before a forced state fires.
 *
 * Most of what this triggers draws over the player, and running it while the sheet is still
 * dismissing means watching the thing you asked for through a closing panel. A beat of plain
 * screen first is what makes the state actually observable (Taylor).
 */
const RUN_DELAY_MS = 1000;

export function DebugSheet({ visible, onClose, groups, onRefresh }: DebugSheetProps) {
  const t = useAppTheme();
  const styles = useStyles();

  /** Cleared on unmount — a pending trigger must not fire into a screen that has gone. */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);
  const run = useCallback(
    (action: () => void) => {
      onClose();
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(action, RUN_DELAY_MS);
    },
    [onClose],
  );

  const toggles = groups.flatMap((group) => group.toggles ?? []);
  const actionGroups = groups.filter((group) => group.actions?.length);

  return (
    <Sheet visible={visible} onClose={onClose} testID="debug-sheet">
      {/* One child, so the Sheet's roomy content gap applies once — the tight gap is ours. */}
      <View style={styles.stack}>
        <View style={styles.topRow}>
          <Text style={styles.heading}>Debug Menu</Text>
          {onRefresh ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload JS"
              // Straight through, no close-first delay — the reload tears the whole JS world
              // down anyway, so there is nothing to watch behind a closing sheet.
              onPress={onRefresh}
              style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}
              testID="debug-refresh"
            >
              <RotateCw size={13} color={t.cobalt} strokeWidth={2.5} />
              <Text style={styles.refreshLabel}>Reload</Text>
            </Pressable>
          ) : null}
        </View>

        {toggles.map((toggle) => (
          <View key={toggle.key} style={styles.row}>
            <Text style={styles.label}>{toggle.label}</Text>
            <Switch
              value={toggle.value}
              onValueChange={toggle.onChange}
              trackColor={{ false: t.surface2, true: t.cobalt }}
              style={styles.switch}
              testID={`debug-${toggle.key}`}
            />
          </View>
        ))}

        {actionGroups.map((group) => (
          <Fragment key={group.title}>
            <Text style={styles.group}>{group.title}</Text>

            {group.inline && group.actions ? (
              <View style={styles.chipRow}>
                {group.actions.map((action) => (
                  <Pressable
                    key={action.key}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    onPress={() => run(action.onPress)}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    testID={`debug-${action.key}`}
                  >
                    <Text style={styles.chipLabel}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              group.actions?.map((action) => (
                <Pressable
                  key={action.key}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => run(action.onPress)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  testID={`debug-${action.key}`}
                >
                  <Text style={styles.label}>{action.label}</Text>
                  <Text style={styles.run}>RUN</Text>
                </Pressable>
              ))
            )}
          </Fragment>
        ))}
      </View>
    </Sheet>
  );
}

const useStyles = appStyles((t) => ({
  stack: { gap: 6 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    // Pulls against the Sheet's own content padding — the header should hug the grip, then
    // give the controls below it a little more air than the 6pt stack gap.
    marginTop: -10,
    marginBottom: 8,
  },
  heading: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 14 },
  refresh: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: t.surface,
  },
  refreshLabel: { color: t.cobalt, fontFamily: FONT_DISPLAY.extraBold, fontSize: 11 },
  group: {
    color: t.muted2,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: t.surface,
  },
  label: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 12, flexShrink: 1 },
  run: {
    color: t.cobalt,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  /** The stock Switch is the row's tallest thing — scaled down so it stops setting the height. */
  switch: { transform: [{ scale: 0.8 }] },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 9,
    justifyContent: "center",
    backgroundColor: t.surface,
  },
  chipLabel: { color: t.cobalt, fontFamily: FONT_DISPLAY.extraBold, fontSize: 11 },
  pressed: { opacity: 0.75 },
}));
