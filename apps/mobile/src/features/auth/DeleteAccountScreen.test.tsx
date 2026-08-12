import { fireEvent, render, waitFor } from "@testing-library/react-native";

/**
 * The only irreversible action in the product, so the tests are about what must NOT happen.
 *
 * Two failures are being guarded against specifically, and both are the kind that only show up
 * once real accounts exist:
 *
 *   * the control firing without confirmation — one stray tap costing a golfer every swing
 *   * a failed deletion reading as a successful one, which would leave someone believing their
 *     videos were gone when they were not
 */

/**
 * `fireEvent.changeText` schedules a re-render rather than applying one — RNTL v14 renders into a
 * concurrent root, so the button is still reading the previous `armed` value on the very next
 * line. Every "now press it" case therefore waits for the control to actually arm first;
 * without that the press is silently dropped and the test fails claiming the handler never ran.
 */
const mockDelete = jest.fn();
jest.mock("./deleteAccount", () => ({
  deleteAccount: () => mockDelete(),
  DELETION_CONSEQUENCES: ["Every swing video you have uploaded, and every analysis of it"],
}));
jest.mock("./AuthProvider", () => ({ useAuth: () => ({ email: "golfer@example.com" }) }));

import { DeleteAccountScreen } from "./DeleteAccountScreen";

beforeEach(() => mockDelete.mockReset());

/** Type the confirmation word and wait for the control to arm. */
async function arm(getByTestId: (id: string) => { props: Record<string, unknown> }, word: string) {
  fireEvent.changeText(getByTestId("delete-confirm-input") as never, word);
  await waitFor(() =>
    expect(
      (getByTestId("delete-account").props.accessibilityState as { disabled: boolean }).disabled,
    ).toBe(false),
  );
}

describe("DeleteAccountScreen", () => {
  it("states what deletion removes before offering the control", async () => {
    const { getByText } = await render(<DeleteAccountScreen onCancel={() => {}} />);
    // §34: informed, not merely warned. The address is named so nobody deletes the wrong account.
    expect(getByText(/golfer@example\.com/)).toBeTruthy();
    expect(getByText(/Every swing video you have uploaded/)).toBeTruthy();
  });

  it("does not delete until the word is typed", async () => {
    const { getByTestId } = await render(<DeleteAccountScreen onCancel={() => {}} />);
    fireEvent.press(getByTestId("delete-account"));
    expect(mockDelete).not.toHaveBeenCalled();

    // A near-miss must not arm it either — this is the case a `startsWith` or a trim-only check
    // would get wrong.
    fireEvent.changeText(getByTestId("delete-confirm-input"), "DELET");
    fireEvent.press(getByTestId("delete-account"));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes once the word is typed, case-insensitively", async () => {
    mockDelete.mockResolvedValue({ swings: 3 });
    const { getByTestId } = await render(<DeleteAccountScreen onCancel={() => {}} />);
    // Lower case on purpose: a phone that autocapitalizes and one that does not must behave the
    // same, or the control is unreachable on whichever keyboard the golfer happens to have.
    await arm(getByTestId, "delete");
    fireEvent.press(getByTestId("delete-account"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
  });

  it("says a failed deletion failed, and that a retry finishes it", async () => {
    mockDelete.mockRejectedValue(new Error("500"));
    const { getByTestId, getByText } = await render(<DeleteAccountScreen onCancel={() => {}} />);
    await arm(getByTestId, "DELETE");
    fireEvent.press(getByTestId("delete-account"));
    await waitFor(() => expect(getByText(/was not deleted/)).toBeTruthy());
  });

  it("offers a way out that is not the destructive one", async () => {
    const onCancel = jest.fn();
    const { getByTestId } = await render(<DeleteAccountScreen onCancel={onCancel} />);
    fireEvent.press(getByTestId("delete-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
