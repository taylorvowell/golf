import { fireEvent, render } from "@testing-library/react-native";
import type { UpgradeRequired } from "@swingsage/schema/contract";

import UpgradeRequiredScreen from "./UpgradeRequiredScreen";

/**
 * A 426 has to become a SCREEN, not a failed request. That is the whole point of the status
 * code, and the only part of it a golfer ever experiences.
 *
 * `render`/`fireEvent` are awaited: @testing-library/react-native v14 made both async, and
 * destructuring the un-awaited Promise silently yields `undefined` for every query. The symptom is
 * a suite that passes while asserting nothing, so it is worth restating in every file that renders.
 */

const detail: UpgradeRequired = {
  error: "upgrade_required",
  message: "This version is too old to read your swings safely.",
  minimumVersion: "2.0.0",
  currentVersion: "2.4.1",
  storeUrl: "https://play.google.com/store/apps/details?id=dev.swingsage.app",
};

describe("UpgradeRequiredScreen", () => {
  it("says what is wrong and which version is needed", async () => {
    const { getByTestId, getByText } = await render(<UpgradeRequiredScreen detail={detail} />);
    expect(getByTestId("upgrade-required")).toBeTruthy();
    expect(getByText(/too old to read your swings/i)).toBeTruthy();
    expect(getByText(/requires 2\.0\.0 or newer/)).toBeTruthy();
  });

  it("sends the golfer to the store the server named", async () => {
    const onOpenStore = jest.fn();
    const { getByTestId } = await render(
      <UpgradeRequiredScreen detail={detail} onOpenStore={onOpenStore} />,
    );
    await fireEvent.press(getByTestId("upgrade-open-store"));
    expect(onOpenStore).toHaveBeenCalledWith(detail.storeUrl);
  });

  it("still tells them what to do when the server sent no store link", async () => {
    const { getByTestId, queryByTestId } = await render(
      <UpgradeRequiredScreen detail={{ ...detail, storeUrl: null }} />,
    );
    expect(queryByTestId("upgrade-open-store")).toBeNull();
    expect(getByTestId("upgrade-no-store")).toBeTruthy();
  });

  it("has no retry or dismiss — retrying cannot succeed", async () => {
    const { queryByText } = await render(<UpgradeRequiredScreen detail={detail} />);
    expect(queryByText(/retry/i)).toBeNull();
    expect(queryByText(/dismiss|not now|later/i)).toBeNull();
  });
});
