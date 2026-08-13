import { useEffect, useState, type ReactNode } from "react";
import type { UpgradeRequired } from "@swingsage/schema/contract";

import { ApiClientError } from "./api";
import { api } from "./client";
import UpgradeRequiredScreen from "./UpgradeRequiredScreen";
import { CLIENT_VERSION } from "./version";

/**
 * The launch half of the 426 contract — the piece that makes `UpgradeRequiredScreen` reachable.
 *
 * `clientConfig()` is unauthenticated by design ("a client too old to authenticate must still be
 * able to learn that it is too old"), so this fires in parallel with the session restore and
 * costs the startup path nothing serial. It also deliberately does NOT block first paint: a slow
 * or failed config fetch renders the app as normal, because the gate exists to stop a build the
 * server has refused — not to add a spinner in front of every launch. A server that has raised
 * the floor answers 426 here, at launch, before the first swing is opened.
 *
 * Mid-session floors are caught the same way: any hook that sees a 426 reports it through
 * `reportUpgradeRequired` and the gate takes the screen over, instead of the error being
 * classified as "unreachable" — which is exactly the misreading the 426 design exists to prevent.
 */

let notify: ((detail: UpgradeRequired) => void) | null = null;

/** Route a 426 caught anywhere in the app to the gate. Safe to call when no gate is mounted. */
export function reportUpgradeRequired(detail: UpgradeRequired): void {
  notify?.(detail);
}

/** A 426 whose body did not parse still blocks — with the client's own facts standing in. */
export function upgradeDetailOf(err: ApiClientError): UpgradeRequired {
  return (
    err.upgradeRequired ?? {
      error: "upgrade_required",
      message: err.message,
      minimumVersion: "a newer version",
      currentVersion: CLIENT_VERSION,
      storeUrl: null,
    }
  );
}

export interface VersionGateProps {
  children: ReactNode;
}

export function VersionGate({ children }: VersionGateProps) {
  const [blocked, setBlocked] = useState<UpgradeRequired | null>(null);

  useEffect(() => {
    notify = setBlocked;
    void api.clientConfig().catch((err: unknown) => {
      if (err instanceof ApiClientError && err.isUpgradeRequired) {
        setBlocked(upgradeDetailOf(err));
      }
      // Anything else — offline, timeout, server down — is not this gate's question. The screens
      // behind it own their own unreachable states.
    });
    return () => {
      notify = null;
    };
  }, []);

  if (blocked) return <UpgradeRequiredScreen detail={blocked} />;
  return children;
}
