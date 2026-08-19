import { View } from "react-native";

import { Tag } from "../../design/system";
import { ANGLE_LABEL, MODE_LABEL, sessionAngles, type SwingSession } from "./sessions";

/**
 * What a session WAS, as pills: the mode it was recorded in, then the camera setup it was
 * filmed with — `Analysis · DTL`, `Video · Dual`.
 *
 * They sit with the time rather than on a line of their own: when, how it was shot and what
 * kind of session it was are one fact about the visit, and a second row for three short words
 * would push the score orb around.
 *
 * The mode is the solid pill because it decides what the session's numbers MEAN — a Drills
 * session's swings never reach the golfer's trends. The camera setup is the quieter fact
 * beside it, with Dual tinted since it is the only one that changes what the analysis can
 * claim; DTL and Front are simply which way the phone was pointing.
 *
 * A session with no known mode renders its views alone rather than guessing one — see
 * `SwingSession.sessionType`.
 */
export function SessionTags({ session }: { session: SwingSession }) {
  const angles = sessionAngles(session);
  if (!angles.length && session.sessionType == null) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }} testID="session-tags">
      {session.sessionType ? (
        <Tag label={MODE_LABEL[session.sessionType]} variant="latest" compact />
      ) : null}
      {angles.map((angle) => (
        <Tag
          key={angle}
          label={ANGLE_LABEL[angle]}
          variant={angle === "dual" ? "best" : "neutral"}
          compact
        />
      ))}
    </View>
  );
}
