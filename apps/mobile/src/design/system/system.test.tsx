import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, type ViewStyle } from "react-native";

import { COBALT, LIGHT, SEMANTIC } from "../../theme";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Delta } from "./Delta";
import { Input } from "./Input";
import { ProgressTrack } from "./ProgressTrack";
import { ScoreOrb } from "./ScoreOrb";
import { Segmented } from "./Segmented";
import { SwingTimelineList } from "./SwingTimelineList";
import { Tag } from "./Tag";
import { Eyebrow, TitleText } from "./Text";
import { TYPE } from "./typography";

/**
 * These pin the behaviours a golfer (or the mockup audit) would notice: the variant fills
 * that carry meaning, selection/disabled state, and that every interactive primitive is a
 * labelled control — not markup structure. No provider is mounted, so everything renders in
 * LIGHT (the ThemeContext default), which is also the mockup's reference theme.
 */

function bg(el: { props: { style?: unknown } }): string | undefined {
  return (StyleSheet.flatten(el.props.style as ViewStyle) as ViewStyle)
    .backgroundColor as string | undefined;
}

describe("Button", () => {
  it("fills primary with cobalt and exposes a button role + label", async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Button label="Analyze swing" variant="primary" onPress={onPress} />,
    );
    const button = getByRole("button", { name: "Analyze swing" });
    expect(bg(button)).toBe(COBALT[600]);
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fills performance with aqua — the action colour, never cobalt", async () => {
    const { getByRole } = await render(
      <Button label="Compare" variant="performance" onPress={() => {}} />,
    );
    expect(bg(getByRole("button"))).toBe(LIGHT.aqua);
  });

  it("reports and enforces disabled", async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Button label="Analyze" disabled onPress={onPress} />,
    );
    const button = getByRole("button");
    expect(button.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("Tag", () => {
  it("gives 'latest' the one solid cobalt fill", async () => {
    const { getByText } = await render(<Tag label="Latest" variant="latest" />);
    expect(bg(getByText("Latest").parent!)).toBe(COBALT[600]);
  });

  it("tints 'issue' with the red that means a fault", async () => {
    const { getByText } = await render(<Tag label="Early extension" variant="issue" />);
    expect(getByText("Early extension").props.style.color).toBe(SEMANTIC.bad);
  });
});

describe("Delta", () => {
  it("colours up-good and down-bad — the one mapping that must never flip", async () => {
    const up = await render(<Delta value="+7" direction="up" />);
    expect(up.getByText(/\+7/).props.style.color).toBe(SEMANTIC.good);
    const down = await render(<Delta value="-5" direction="down" />);
    expect(down.getByText(/-5/).props.style.color).toBe(SEMANTIC.bad);
  });
});

describe("Segmented", () => {
  it("marks the active segment selected and lifts it onto a surface fill", async () => {
    const { getByRole } = await render(
      <Segmented options={["Week", "Month"]} value="Week" onChange={() => {}} />,
    );
    const active = getByRole("tab", { name: "Week" });
    const idle = getByRole("tab", { name: "Month" });
    expect(active.props.accessibilityState.selected).toBe(true);
    expect(bg(active)).toBe(LIGHT.surface);
    expect(idle.props.accessibilityState.selected).toBe(false);
    expect(bg(idle)).toBe("transparent");
  });

  it("reports the tapped option", async () => {
    const onChange = jest.fn();
    const { getByRole } = await render(
      <Segmented options={["Week", "Month"]} value="Week" onChange={onChange} />,
    );
    fireEvent.press(getByRole("tab", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("Month");
  });
});

describe("ScoreOrb", () => {
  it("speaks the score, not the geometry", async () => {
    const { getByLabelText } = await render(<ScoreOrb score={86} caption="Overall" />);
    expect(getByLabelText("Overall 86")).toBeTruthy();
  });
});

describe("ProgressTrack", () => {
  it("is a progressbar with a clamped value", async () => {
    const { getByRole } = await render(<ProgressTrack fraction={1.4} />);
    expect(getByRole("progressbar").props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 100,
    });
  });
});

describe("Input", () => {
  it("labels the field for the screen reader with its visible label", async () => {
    const { getByLabelText } = await render(<Input label="Session name" />);
    expect(getByLabelText("Session name")).toBeTruthy();
  });
});

describe("SwingTimelineList", () => {
  it("rows with a handler are buttons that announce title and score together", async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <SwingTimelineList
        items={[{ key: "1", title: "Swing 14", score: 88, onPress }]}
      />,
    );
    const row = getByRole("button", { name: "Swing 14, score 88" });
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("type components", () => {
  it("TitleText carries the §03 title scale", async () => {
    const { getByText } = await render(<TitleText>Afternoon Practice</TitleText>);
    const style = StyleSheet.flatten(getByText("Afternoon Practice").props.style);
    expect(style.fontSize).toBe(TYPE.title.fontSize);
    expect(style.fontFamily).toBe(TYPE.title.fontFamily);
  });

  it("Eyebrow uppercases and defaults to aqua — the mockup's kicker exactly", async () => {
    const { getByText } = await render(<Eyebrow>Latest swing</Eyebrow>);
    const style = StyleSheet.flatten(getByText("Latest swing").props.style);
    expect(style.textTransform).toBe("uppercase");
    expect(style.color).toBe(LIGHT.aqua);
  });
});

describe("Chip", () => {
  it("translucent variant keeps white text on the ink pill for dark heroes", async () => {
    const { getByText } = await render(<Chip label="4 swings" translucent />);
    expect(getByText("4 swings").props.style.color).toBe(LIGHT.onDark);
  });
});
