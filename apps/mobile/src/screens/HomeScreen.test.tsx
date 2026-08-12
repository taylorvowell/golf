import { render, waitFor } from "@testing-library/react-native";

import { ApiClientError } from "../platform/api";

/**
 * The invariant under test is not the layout, it is the refusal to guess.
 *
 * The failure this guards against is a request that never reached the server rendering as "No
 * swings yet". That reads as data loss to the one person who would know the difference, and it is
 * the mobile instance of the project's standing rule that an uncertain answer is never presented
 * as a fact.
 *
 * `render` is awaited — @testing-library/react-native v14 made it async, and destructuring the
 * un-awaited Promise silently yields `undefined` for every query.
 */

const mockRequest = jest.fn();
jest.mock("../platform/client", () => ({ api: { request: (path: string) => mockRequest(path) } }));

import { HomeScreen } from "./HomeScreen";

beforeEach(() => mockRequest.mockReset());

describe("HomeScreen", () => {
  it("reads an empty account as no swings yet", async () => {
    mockRequest.mockResolvedValue({ swings: [] });
    const { getByText } = await render(<HomeScreen onDeleteAccount={() => {}} />);
    await waitFor(() => expect(getByText("No swings yet")).toBeTruthy());
  });

  it("reports a count, singular", async () => {
    mockRequest.mockResolvedValue({ swings: [{}] });
    const { getByText } = await render(<HomeScreen onDeleteAccount={() => {}} />);
    await waitFor(() => expect(getByText("1 swing")).toBeTruthy());
  });

  it("never renders a network failure as an empty swing log", async () => {
    mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    const { getByText, getByTestId, queryByText } = await render(<HomeScreen onDeleteAccount={() => {}} />);

    await waitFor(() => expect(getByText("Cannot reach SwingSage")).toBeTruthy());
    expect(queryByText("No swings yet")).toBeNull();
    expect(getByTestId("home-retry")).toBeTruthy();
  });

  it("distinguishes a declined session from an unreachable server", async () => {
    mockRequest.mockRejectedValue(new ApiClientError(401, "unauthorized", "no session"));
    const { getByText, queryByText } = await render(<HomeScreen onDeleteAccount={() => {}} />);

    await waitFor(() => expect(getByText("Your session has expired")).toBeTruthy());
    expect(queryByText("Cannot reach SwingSage")).toBeNull();
  });
});
