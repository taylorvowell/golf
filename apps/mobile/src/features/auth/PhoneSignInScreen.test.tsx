import { fireEvent, render, waitFor } from "@testing-library/react-native";

/**
 * Every send on this screen is a message somebody paid for, so the tests are about spend and
 * about not stranding a golfer mid-flow.
 *
 * `render` is awaited and post-press queries use `findBy*` — RNTL v14 renders into a concurrent
 * root, so a synchronous query after a `fireEvent` reads the PRE-press tree and fails on a
 * component that works. The same applies going the other way: "Send code" is disabled until the
 * field holds something, and `changeText` only *schedules* that re-render — pressing on the very
 * next line hits a still-disabled button and drops the tap, so `enable()` waits for it first.
 */

const mockSend = jest.fn();
const mockVerify = jest.fn();

jest.mock("./phone", () => {
  const actual = jest.requireActual("./phone");
  return {
    ...actual,
    sendPhoneOtp: (...args: unknown[]) => mockSend(...args),
    verifyPhoneOtp: (...args: unknown[]) => mockVerify(...args),
  };
});

import { PhoneSignInScreen } from "./PhoneSignInScreen";

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue(undefined);
  mockVerify.mockResolvedValue(undefined);
});

/** Wait for "Send code" to stop being disabled, then press it. */
async function enable(view: { getByLabelText: (id: string) => { props: Record<string, unknown> } }) {
  await waitFor(() =>
    expect(
      (view.getByLabelText("Send code").props.accessibilityState as { disabled: boolean }).disabled,
    ).toBe(false),
  );
  fireEvent.press(view.getByLabelText("Send code") as never);
}

/** Type a number and get to the code step. */
async function toCodeStep() {
  const view = await render(<PhoneSignInScreen onCancel={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText("Phone number"), "5551234567");
  await enable(view);
  await view.findByLabelText("6-digit code");
  return view;
}

it("normalizes what was typed before spending a message on it", async () => {
  const { getByLabelText } = await render(<PhoneSignInScreen onCancel={jest.fn()} />);
  fireEvent.changeText(getByLabelText("Phone number"), "(555) 123-4567");
  await enable({ getByLabelText });
  await waitFor(() => expect(mockSend).toHaveBeenCalledWith("+15551234567"));
});

it("does not reach the network at all when the number cannot be a number", async () => {
  const { getByLabelText, findByRole } = await render(
    <PhoneSignInScreen onCancel={jest.fn()} />,
  );
  fireEvent.changeText(getByLabelText("Phone number"), "5551");
  await enable({ getByLabelText });
  await findByRole("alert");
  expect(mockSend).not.toHaveBeenCalled();
});

it("submits the code on the last digit, with no button to find", async () => {
  const { getByLabelText } = await toCodeStep();
  fireEvent.changeText(getByLabelText("6-digit code"), "123456");
  await waitFor(() => expect(mockVerify).toHaveBeenCalledWith("+15551234567", "123456"));
});

it("does not check a partial code", async () => {
  const { getByLabelText } = await toCodeStep();
  fireEvent.changeText(getByLabelText("6-digit code"), "12345");
  expect(mockVerify).not.toHaveBeenCalled();
});

it("holds resend behind a countdown so a stalled SMS cannot be bought four times", async () => {
  const { findByText } = await toCodeStep();
  const resend = await findByText(/Resend in \d+s/);
  fireEvent.press(resend);
  // One send — the number entry — and nothing added by tapping a cooling-down control.
  expect(mockSend).toHaveBeenCalledTimes(1);
});

it("keeps the number when stepping back, rather than making it be typed again", async () => {
  const view = await toCodeStep();
  fireEvent.press(view.getByLabelText("Use a different number"));
  const field = await view.findByLabelText("Phone number");
  expect(field.props.value).toBe("(555) 123-4567");
});

it("clears a wrong code so the next attempt starts from an empty field", async () => {
  mockVerify.mockRejectedValue(new Error("That code is wrong or has expired."));
  const view = await toCodeStep();
  fireEvent.changeText(view.getByLabelText("6-digit code"), "000000");
  await view.findByRole("alert");
  expect(view.getByLabelText("6-digit code").props.value).toBe("");
});
