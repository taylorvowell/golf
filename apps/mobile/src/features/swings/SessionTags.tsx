import { View } from "react-native";

import { Tag } from "../../design/system";
import { MODE_LABEL, type SwingSession } from "./sessions";

/**
 * What a session WAS, as pills: the mode it was recorded in, then the camera setup it was
 * filmed with — `Analysis · DTL`, `Video · Dual`.
 *
 * They sit with the time rather than on a line of their own: when, how it was shot and what
 * kind of session it was are one fact about the visit, and a second row for three short words
 * would push the score orb around.
 *
 * The mode is the solid pill because it decides what the session's numbers MEAN — a Drills
 * session's swings never reach the golfer's trends.
 *
 * **The camera angle is NOT here** (Taylor, 2026-08-22). A day's card can hold swings filmed
 * both ways, so an angle on the header is either a list of every angle used — which says nothing
 * about any one swing — or a claim about the day that is not true. It lives on the swing ROW
 * instead, where it describes exactly one clip and is the fact that decides what that clip's
 * numbers can mean.
 *
 * The swing count LEADS the row, solid navy (Taylor 2026-08-19): how big the visit was is
 * part of the same one-line fact, and it saves the golfer expanding a session just to see
 * its size.
 */
export function SessionTags({ session }: { session: SwingSession }) {
  const count = session.swings.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }} testID="session-tags">
      <Tag label={`${count} ${count === 1 ? "swing" : "swings"}`} variant="count" compact />
      {session.sessionType ? (
        <Tag label={MODE_LABEL[session.sessionType]} variant="latest" compact />
      ) : null}
    </View>
  );
}
