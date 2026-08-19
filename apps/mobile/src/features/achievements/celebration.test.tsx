import { Pressable, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { Trophy } from "lucide-react-native";

import { CelebrationProvider, useCelebrate } from "./CelebrationProvider";
import {
  advanceCelebration,
  enqueueCelebration,
  type Celebration,
} from "./celebration";
import { ThemeProvider } from "../../theme";

/**
 * What a golfer would notice: a celebration shows its toast, a second one WAITS instead of
 * stamping over the first, and a replayed award (same id) never plays twice. Animation timing
 * is deliberately unasserted — jest's clock and the native driver disagree, and "the toast
 * appeared" is the behaviour that matters.
 */

const A: Celebration = {
  id: "a",
  kind: "badge",
  title: "First Session in the Books",
  icon: Trophy,
  points: 50,
};
const B: Celebration = { id: "b", kind: "record", title: "New Personal Best", icon: Trophy };

describe("the queue", () => {
  it("keeps arrival order and pops from the head", () => {
    let q = enqueueCelebration([], A);
    q = enqueueCelebration(q, B);
    expect(q.map((c) => c.id)).toEqual(["a", "b"]);
    expect(advanceCelebration(q).map((c) => c.id)).toEqual(["b"]);
  });

  it("drops a duplicate id — a replayed award must not toast twice", () => {
    const q = enqueueCelebration(enqueueCelebration([], A), { ...B, id: "a" });
    expect(q).toHaveLength(1);
  });
});

function Trigger({ c, label }: { c: Celebration; label: string }) {
  const celebrate = useCelebrate();
  return (
    <Pressable onPress={() => celebrate(c)}>
      <Text>{label}</Text>
    </Pressable>
  );
}

function host() {
  return (
    <ThemeProvider>
      <CelebrationProvider>
        <Trigger c={A} label="fire-a" />
        <Trigger c={B} label="fire-b" />
      </CelebrationProvider>
    </ThemeProvider>
  );
}

describe("the provider", () => {
  it("shows the toast for a celebration", async () => {
    const view = await render(host());
    fireEvent.press(await view.findByText("fire-a"));
    expect(await view.findByText("First Session in the Books")).toBeTruthy();
    expect(await view.findByText("+50 XP")).toBeTruthy();
  });

  it("plays one at a time — the second waits in the queue", async () => {
    const view = await render(host());
    fireEvent.press(await view.findByText("fire-a"));
    fireEvent.press(await view.findByText("fire-b"));
    expect(await view.findByText("First Session in the Books")).toBeTruthy();
    expect(view.queryByText("New Personal Best")).toBeNull();
  });
});
