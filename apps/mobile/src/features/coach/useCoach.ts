import { getAppPrefs, useAppPrefs } from "../settings/appPrefs";
import { coachById, type Coach, type CoachId } from "./coaches";

/** The coach the golfer picked; re-renders wherever the choice changes. */
export function useCoach(): [Coach, (id: CoachId) => void] {
  const [prefs, setPrefs] = useAppPrefs();
  return [coachById(prefs.coachId), (id: CoachId) => setPrefs({ coachId: id })];
}

/** The chosen coach for imperative call sites (voice-bank lookup); hooks use `useCoach`. */
export function getCoach(): Coach {
  return coachById(getAppPrefs().coachId);
}
