import AsyncStorage from "@react-native-async-storage/async-storage";

import { loadSessionDefaults, saveSessionDefaults } from "./sessionDefaults";
import { DEFAULT_SESSION_SETTINGS } from "./sessionState";

/**
 * The defaults survive a round trip, and anything unreadable degrades to the shipped
 * defaults — corrupt storage must never block entering session mode.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
});

it("round-trips saved settings", async () => {
  await saveSessionDefaults({
    ...DEFAULT_SESSION_SETTINGS,
    delaySeconds: 10,
    aiCoachVoice: false,
  });
  const loaded = await loadSessionDefaults();
  expect(loaded.delaySeconds).toBe(10);
  expect(loaded.aiCoachVoice).toBe(false);
  expect(loaded.videoReplay).toBe(true);
});

it("returns shipped defaults when nothing is stored", async () => {
  expect(await loadSessionDefaults()).toEqual(DEFAULT_SESSION_SETTINGS);
});

it("degrades corrupt or wrong-shaped storage to the shipped defaults", async () => {
  await AsyncStorage.setItem("swingsage.sessionDefaults.v1", "not json {");
  expect(await loadSessionDefaults()).toEqual(DEFAULT_SESSION_SETTINGS);

  await AsyncStorage.setItem(
    "swingsage.sessionDefaults.v1",
    JSON.stringify({ delaySeconds: 99, videoReplay: "yes" }),
  );
  const loaded = await loadSessionDefaults();
  expect(loaded.delaySeconds).toBe(3);
  expect(loaded.videoReplay).toBe(true);
});
