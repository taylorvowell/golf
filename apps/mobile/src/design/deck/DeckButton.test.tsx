import { act, fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, type ViewStyle } from "react-native";

import { DeckButton } from "./DeckButton";
import { DECK } from "./tokens";

/**
 * The one rule this whole system rests on: **light comes from directly above.**
 *
 * A raised cap therefore casts a shadow BELOW itself and catches a highlight on its TOP rim; a cap
 * that has been pushed in does the opposite — dark at the top where the rim now overhangs it. Get
 * that backwards on one component and the surface stops reading as a physical object everywhere,
 * which is the only thing the depth is for. It is also the kind of mistake that is invisible in a
 * diff and obvious on a phone, so it is asserted here rather than eyeballed.
 *
 * The second thing asserted is that **a finger down and a latch down are different states**. The
 * transport depends on it completely: pause is the play cap staying in after the finger has gone.
 */

function shadowOf(el: { props: { style?: unknown } }) {
  const flat = StyleSheet.flatten(el.props.style as ViewStyle) as ViewStyle & {
    boxShadow?: readonly { offsetY: number; inset?: boolean }[];
  };
  return flat.boxShadow ?? [];
}

function offsetOf(el: { props: { style?: unknown } }) {
  const flat = StyleSheet.flatten(el.props.style as ViewStyle);
  const t = flat.transform as { translateY?: number }[] | undefined;
  return t?.[0]?.translateY ?? 0;
}

it("casts its shadow downward when raised, and none of it inside the cap", async () => {
  const { getByTestId } = await render(<DeckButton testID="cap" label="A" onPress={() => {}} />);
  const cast = shadowOf(getByTestId("cap")).filter((s) => !s.inset);
  expect(cast.length).toBeGreaterThan(0);
  for (const s of cast) expect(s.offsetY).toBeGreaterThan(0);
});

it("inverts to a shadow at the TOP, inside the cap, once latched in", async () => {
  const { getByTestId } = await render(
    <DeckButton testID="cap" label="A" depressed onPress={() => {}} />,
  );
  const shadows = shadowOf(getByTestId("cap"));
  // Everything is inset — nothing standing proud can cast onto the surface it is sunk into.
  expect(shadows.every((s) => s.inset)).toBe(true);
  // The darkest one comes from above, where the rim now overhangs.
  expect(shadows[0].offsetY).toBeGreaterThan(0);
  expect(shadows[0].inset).toBe(true);
});

it("sinks by the same travel whether latched or held", async () => {
  const { getByTestId, rerender } = await render(
    <DeckButton testID="cap" label="A" onPress={() => {}} />,
  );
  expect(offsetOf(getByTestId("cap"))).toBe(0);

  // Awaited: a press updates state, and React 19 renders that asynchronously here. An unawaited
  // press also leaks into the NEXT test in this file, which is how three unrelated assertions
  // started failing at once.
  await act(async () => void fireEvent(getByTestId("cap"), "pressIn"));
  expect(offsetOf(getByTestId("cap"))).toBe(DECK.travel);

  await act(async () => void fireEvent(getByTestId("cap"), "pressOut"));
  expect(offsetOf(getByTestId("cap"))).toBe(0);

  await rerender(<DeckButton testID="cap" label="A" depressed onPress={() => {}} />);
  expect(offsetOf(getByTestId("cap"))).toBe(DECK.travel);
});

it("stays in after the finger lifts, which is the whole point of pause", async () => {
  // A cap that popped back out on pressOut would make the transport unreadable at rest — the one
  // moment a golfer is actually looking at it.
  const { getByTestId } = await render(
    <DeckButton testID="cap" label="A" depressed onPress={() => {}} />,
  );
  await act(async () => void fireEvent(getByTestId("cap"), "pressIn"));
  await act(async () => void fireEvent(getByTestId("cap"), "pressOut"));
  expect(offsetOf(getByTestId("cap"))).toBe(DECK.travel);
  expect(shadowOf(getByTestId("cap")).every((s) => s.inset)).toBe(true);
});

it("tells a screen reader it is selected, not merely that it looks pushed in", async () => {
  const { getByTestId } = await render(
    <DeckButton testID="cap" label="Loop" depressed onPress={() => {}} />,
  );
  expect(getByTestId("cap").props.accessibilityState.selected).toBe(true);
});

it("grows its touch target beyond the drawn cap", async () => {
  // §41: bright sunlight, one hand, a driving range. The drawing is small; the target is not.
  const { getByTestId } = await render(
    <DeckButton testID="cap" diameter={30} onPress={() => {}} label="x" />,
  );
  expect(getByTestId("cap").props.hitSlop).toBe((DECK.touchTarget - 30) / 2);
});

it("does not fire while disabled", async () => {
  const onPress = jest.fn();
  const { getByTestId } = await render(
    <DeckButton testID="cap" label="A" disabled onPress={onPress} />,
  );
  await act(async () => void fireEvent.press(getByTestId("cap")));
  expect(onPress).not.toHaveBeenCalled();
});
