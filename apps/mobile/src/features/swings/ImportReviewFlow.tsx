import { Modal, StyleSheet, View } from "react-native";

import { FullScreenLoader } from "../../design/system";
import { FixedDarkTheme } from "../../theme";
import { SwingReview } from "../session/SwingReview";
import { ImportConfirm } from "./ImportConfirm";
import type { ImportHook } from "./useImportSwing";

/**
 * The import review, phase by phase, in one place — both hosts (the swing log and session
 * mode) mount exactly this, so the flow cannot drift between them.
 *
 * A full-screen Modal, deliberately: it is its own window ABOVE the tab shell, so the wave nav
 * cannot float over the Save button — the in-tree overlay version lost that fight to the
 * scroll-driven chrome (Taylor, 2026-08-23). Pinned dark like every video-facing surface.
 *
 * The phases (useImportSwing): "Loading Swing Video" while the probe + detection run, the
 * confirm question over the auto-cut clip, the mark-impact scrubber behind "No", and
 * "Trimming and Saving Swing Video" while the cut is made. The scrubber's back arrow returns
 * to the confirm question; only the confirm screen's Cancel abandons the import.
 */
export function ImportReviewFlow({ importer }: { importer: ImportHook }) {
  const review = importer.review;
  return (
    <Modal
      visible={review !== null}
      // NOT "fade": Android animates the WINDOW's alpha, so every pixel of the review —
      // filmstrip, picture, controls — goes semi-transparent together and the host screen
      // shows straight through it (Taylor, 2026-08-23). An instant swap also matches how
      // session mode enters its own review, which is in-tree and has no window to fade.
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={importer.discardReview}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]}>
        <FixedDarkTheme>
          {review?.phase === "loading" ? (
            <FullScreenLoader label="Loading Swing Video" />
          ) : review?.phase === "confirm" ? (
            <ImportConfirm
              take={review.take}
              impactSec={review.impactSec}
              onSave={importer.saveReview}
              onEdit={importer.editSwing}
              onCancel={importer.discardReview}
            />
          ) : review?.phase === "edit" ? (
            <SwingReview
              take={review.take}
              seedSec={review.impactSec}
              onSave={importer.saveReview}
              onDelete={importer.backToConfirm}
              importMode
            />
          ) : review?.phase === "saving" ? (
            <FullScreenLoader label="Trimming and Saving Swing Video" />
          ) : null}
        </FixedDarkTheme>
      </View>
    </Modal>
  );
}
