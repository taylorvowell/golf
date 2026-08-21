import { Pressable, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { Trophy } from "lucide-react-native";

import { CelebrationProvider, useCelebrate } from "./CelebrationProvider";
import { celebrationToast, type Celebration } from "./celebration";
import { ToastProvider } from "../toast/ToastProvider";
import { ThemeProvider } from "../../theme";

/**
 * The celebration voice on the generic toaster: the mapping is where the meaning lives
 * (eyebrow per kind, XP chip, confetti on), so that is what gets pinned — plus the end-to-end
 * path celebrate() → toast on screen.
 */

const BADGE: Celebration = {
  id: "a",
  kind: "badge",
  title: "First Session in the Books",
  icon: Trophy,
  points: 50,
};

describe("the celebration voice", () => {
  it("maps kind to eyebrow, points to the chip, and always brings confetti", () => {
    const toast = celebrationToast(BADGE);
    expect(toast.eyebrow).toBe("Achievement unlocked");
    expect(toast.chip).toBe("+50 XP");
    expect(toast.confetti).toBe(true);
    expect(toast.id).toBe("a");
  });

  it("omits the chip when the moment isn't about points", () => {
    const toast = celebrationToast({ ...BADGE, kind: "rank", points: undefined });
    expect(toast.eyebrow).toBe("Rank up");
    expect(toast.chip).toBeUndefined();
  });
});

function Trigger() {
  const celebrate = useCelebrate();
  return (
    <Pressable onPress={() => celebrate(BADGE)}>
      <Text>fire</Text>
    </Pressable>
  );
}

it("celebrate() plays through the app toaster", async () => {
  const view = await render(
    <ThemeProvider>
      <ToastProvider>
        <CelebrationProvider>
          <Trigger />
        </CelebrationProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
  fireEvent.press(await view.findByText("fire"));
  expect(await view.findByText("First Session in the Books")).toBeTruthy();
  expect(await view.findByText("+50 XP")).toBeTruthy();
});
