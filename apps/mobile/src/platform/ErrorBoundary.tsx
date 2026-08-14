import { Component, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { themedStyles } from "../theme";

/**
 * The degrade path for a render throw — "quality gates degrade, they don't crash", applied to the
 * client itself.
 *
 * A class component because only class boundaries catch render-phase throws; no hook exists for
 * this. Two mounts use it: the root (whole-app fallback with retry, because the alternative in a
 * release Hermes build is a hard exit to the launcher) and around `SwingOverlay` (an artifact
 * whose shape the geometry code did not expect must degrade to plain video — the swing is still
 * watchable, which is the entire point of the overlay being optional).
 *
 * `resetKey` re-arms the boundary when the world changes underneath it — the overlay's boundary
 * keys on the swing id, so a throw on one malformed artifact does not blank the overlay for every
 * swing after it.
 */

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Drawn instead of the children after a throw. `retry` re-arms and re-renders. */
  fallback?: (retry: () => void) => ReactNode;
  /** When this changes, the boundary forgets the error and tries the children again. */
  resetKey?: string | number | null;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Surfaced, never swallowed silently: in development this is the loudest signal available,
    // and in release it is the one breadcrumb a crash report would otherwise have carried.
    console.error("ErrorBoundary caught a render throw:", error);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private retry = () => this.setState({ failed: false });

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return <DefaultFallback retry={this.retry} />;
  }
}

/** A function component, because the class body cannot call `useTheme`. */
function DefaultFallback({ retry }: { retry: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.root} testID="error-boundary-fallback">
      <View style={styles.card}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          SwingSage hit a problem drawing this screen. Your swings are safe.
        </Text>
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          testID="error-boundary-retry"
          onPress={retry}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: t.panel,
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  title: { color: t.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.4 },
  body: { color: t.muted, fontSize: 14, lineHeight: 20 },
  button: {
    marginTop: 6,
    backgroundColor: t.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: t.onAccent, fontSize: 15, fontWeight: "700" },
}));
