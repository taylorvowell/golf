import { Pressable, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { Bell } from "lucide-react-native";

import { ToastProvider, useToast } from "./ToastProvider";
import { advanceToast, enqueueToast, type AppToast } from "./toast";
import { ThemeProvider } from "../../theme";

/**
 * What a user would notice: a toast shows, a second one WAITS instead of stamping over the
 * first, a replayed event (same id) never plays twice, and a tap runs the toast's deep link.
 * Animation timing is deliberately unasserted — jest's clock and the native driver disagree,
 * and "the toast appeared" is the behaviour that matters.
 */

const A: AppToast = { id: "a", title: "Analysis ready", eyebrow: "Coach", icon: Bell };
const B: AppToast = { id: "b", title: "New message", icon: Bell, chip: "3" };

describe("the queue", () => {
  it("keeps arrival order and pops from the head", () => {
    let q = enqueueToast([], A);
    q = enqueueToast(q, B);
    expect(q.map((t) => t.id)).toEqual(["a", "b"]);
    expect(advanceToast(q).map((t) => t.id)).toEqual(["b"]);
  });

  it("drops a duplicate id — a replayed event must not toast twice", () => {
    const q = enqueueToast(enqueueToast([], A), { ...B, id: "a" });
    expect(q).toHaveLength(1);
  });
});

function Trigger({ toast, label }: { toast: AppToast; label: string }) {
  const show = useToast();
  return (
    <Pressable onPress={() => show(toast)}>
      <Text>{label}</Text>
    </Pressable>
  );
}

function host(extra?: AppToast) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Trigger toast={A} label="fire-a" />
        <Trigger toast={extra ?? B} label="fire-b" />
      </ToastProvider>
    </ThemeProvider>
  );
}

describe("the provider", () => {
  it("shows a toast with its eyebrow and chip", async () => {
    const view = await render(host());
    fireEvent.press(await view.findByText("fire-a"));
    expect(await view.findByText("Analysis ready")).toBeTruthy();
    expect(await view.findByText("Coach")).toBeTruthy();
  });

  it("plays one at a time — the second waits in the queue", async () => {
    const view = await render(host());
    fireEvent.press(await view.findByText("fire-a"));
    fireEvent.press(await view.findByText("fire-b"));
    expect(await view.findByText("Analysis ready")).toBeTruthy();
    expect(view.queryByText("New message")).toBeNull();
  });

  it("a tap runs the toast's deep link", async () => {
    const onPress = jest.fn();
    const view = await render(host({ ...B, id: "c", onPress }));
    fireEvent.press(await view.findByText("fire-b"));
    fireEvent.press(await view.findByTestId("app-toast"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
