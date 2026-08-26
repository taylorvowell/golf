import { useCallback, useState } from "react";
import { Star } from "lucide-react-native";

import { useToast } from "../toast/ToastProvider";
import { setSwingFavourite, useCachedSwing } from "./useSwings";

/**
 * Whether this golfer has starred a swing (§7.3) — **the server's `favourite` field**.
 *
 * It used to be one JSON array in AsyncStorage, because the contract had no such field. That
 * meant a star survived an app restart but not a reinstall, and never reached a second device —
 * for a flag whose entire purpose is "find this swing again later", which is a thing a golfer
 * does across time and phones. The column existed server-side the whole time; this is the
 * rewiring that file's own comment promised, and screens still see only `{ starred, toggle }`.
 *
 * **A swing that does not exist server-side yet cannot be starred**, and this says so by
 * answering `pending: true` rather than by accepting a tap it would have to forget. That is the
 * live case in session mode: the after-swing screen is up while the clip is still uploading, so
 * the swing has a local id and no row. The control renders disabled for that moment.
 */
export interface StarredHook {
  starred: boolean;
  toggle: () => void;
  /** True while there is nothing to star yet — no server row, or the log has not loaded. */
  pending: boolean;
}

export function useStarred(swingId: string | null | undefined): StarredHook {
  /**
   * The cache READER, never `useSwings()` — that one revalidates on mount, and this hook renders
   * once per row in the session's swing list. Ten rows would have been ten identical list
   * requests. Every screen that hosts a star already mounts the fetching hook itself.
   */
  const swing = useCachedSwing(swingId);
  const toast = useToast();
  /**
   * In-flight guard, NOT a copy of the value. The star itself is read from the shared swing
   * cache, which `setSwingFavourite` flips optimistically and then overwrites from the confirmed
   * row — so a second render always draws the truth. This only stops a double tap from firing
   * two writes whose answers could land out of order.
   */
  const [busy, setBusy] = useState(false);

  const starred = swing?.favourite ?? false;
  const pending = !swing;

  const toggle = useCallback(() => {
    if (!swing || busy) return;
    setBusy(true);
    setSwingFavourite(swing.id, !swing.favourite)
      .catch(() => {
        // The cache has already been restored to what it was, so the star on screen is correct
        // again by the time this runs. What the golfer needs is to know the tap did not take.
        toast({
          id: `favourite-failed-${swing.id}-${Date.now()}`,
          title: "Couldn't save that",
          detail: "Your star didn't reach SwingSage. Try again in a moment.",
          icon: Star,
        });
      })
      .finally(() => setBusy(false));
  }, [busy, swing, toast]);

  return { starred, toggle, pending };
}
