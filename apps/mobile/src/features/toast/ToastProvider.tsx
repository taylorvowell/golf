import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ConfettiBurst } from "./Confetti";
import { ToastCard } from "./ToastCard";
import { advanceToast, enqueueToast, type AppToast } from "./toast";

/**
 * The one mouth for toast-level moments, app-wide — celebrations, notification alerts, and
 * whatever comes next all call `useToast()`; nothing renders its own toaster.
 *
 * Mounted in `App.tsx` above the navigator so a toast lands on whatever screen the golfer
 * happens to be on. Queue-serialised: one at a time, extras wait, duplicate ids dropped (see
 * `toast.ts`). Card and confetti are keyed by toast id so each moment mounts fresh — no
 * animation state survives from the previous one.
 */

interface ToastApi {
  show: (toast: AppToast) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): (toast: AppToast) => void {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider above it");
  return api.show;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<AppToast[]>([]);

  const show = useCallback((toast: AppToast) => {
    setQueue((q) => enqueueToast(q, toast));
  }, []);
  const dismiss = useCallback(() => {
    setQueue((q) => advanceToast(q));
  }, []);
  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  const current = queue[0];

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current ? (
        <>
          {current.confetti ? <ConfettiBurst key={`confetti-${current.id}`} /> : null}
          <ToastCard key={current.id} toast={current} onDismiss={dismiss} />
        </>
      ) : null}
    </ToastContext.Provider>
  );
}
