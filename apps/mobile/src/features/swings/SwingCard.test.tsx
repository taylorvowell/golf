import { render, waitFor } from "@testing-library/react-native";
import type { SwingSummary } from "@swingsage/schema/contract";

/**
 * The thumbnail must be requested WITH the session, and this test exists because it once was not.
 *
 * React Native's own `Image` accepts `headers` on its source object and silently does not send
 * them on Android. The request then arrives unauthenticated, and because a development fallback
 * identity exists it is *answered* as that user rather than refused — so the route returns 404
 * ("no such swing for this owner") instead of 401. The visible symptom is a blank thumbnail with a
 * plausible status code and nothing anywhere in the client suggesting authentication was involved.
 * It cost a full diagnosis cycle to find, and nothing about the code looked wrong.
 *
 * So the assertion is deliberately about the SOURCE rather than about pixels: whatever image
 * component is used, the object handed to it has to carry the token.
 */

const mockMediaSource = jest.fn();
jest.mock("../../platform/client", () => ({
  api: { mediaSource: (path: string) => mockMediaSource(path) },
}));

import { SwingCard } from "./SwingCard";

const swing = (over: Partial<SwingSummary> = {}) =>
  ({
    id: "s-1",
    label: "7 iron — 12 Aug",
    referenceLabel: null,
    views: [{ id: "v-1", view: "dtl" }],
    primaryViewId: "v-1",
    frameCount: 120,
    fps: 60,
    view: "dtl",
    overallScore: 68,
    band: "good",
    scoringModelVersion: "v2",
    status: "ready",
    createdAt: 1786500000,
    model: null,
    tempoRatio: null,
    traceEnabled: true,
    poseCoverage: 0.95,
    ...over,
  }) as unknown as SwingSummary;

beforeEach(() => {
  mockMediaSource.mockReset();
  mockMediaSource.mockResolvedValue({
    uri: "http://api.test.invalid/api/v1/swings/s-1/thumb",
    headers: { Authorization: "Bearer test-token" },
  });
});

describe("SwingCard", () => {
  it("asks for the thumbnail at the swing's own media path", async () => {
    await render(<SwingCard swing={swing()} onPress={() => {}} />);
    await waitFor(() => expect(mockMediaSource).toHaveBeenCalledWith("swings/s-1/thumb"));
  });

  it("renders the thumbnail with its Authorization header attached", async () => {
    const { getByTestId } = await render(<SwingCard swing={swing()} onPress={() => {}} />);

    await waitFor(() => {
      const source = getByTestId("swing-thumb").props.source as {
        uri: string;
        headers: Record<string, string>;
      };
      expect(source.uri).toContain("/swings/s-1/thumb");
      // The whole point. A source without this renders blank and the server answers 404.
      expect(source.headers.Authorization).toBe("Bearer test-token");
    });
  });

  it("draws a placeholder rather than an empty image before the token resolves", async () => {
    // `mediaSource` is async because the access token is; the first render has no source at all,
    // and an image with no uri is a broken-image glyph on some platforms.
    mockMediaSource.mockReturnValue(new Promise(() => {}));
    const { queryByTestId } = await render(<SwingCard swing={swing()} onPress={() => {}} />);
    expect(queryByTestId("swing-thumb")).toBeNull();
  });

  it("says an unscored swing is unscored rather than showing a zero", async () => {
    const { getByText, queryByText } = await render(
      <SwingCard swing={swing({ overallScore: null, band: null })} onPress={() => {}} />,
    );
    expect(getByText(/not\s*scored/)).toBeTruthy();
    expect(queryByText("0")).toBeNull();
  });
});
