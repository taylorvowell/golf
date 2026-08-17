import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";

import { Button, HeadingText, Panel } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
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
      <Panel radius="feature" style={styles.card}>
        <HeadingText>Something went wrong</HeadingText>
        <Text style={styles.body}>
          SwingSage hit a problem drawing this screen. Your swings are safe.
        </Text>
        <Button
          label="Try again"
          testID="error-boundary-retry"
          onPress={retry}
          style={styles.button}
        />
      </Panel>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg, justifyContent: "center", padding: 20 },
  card: { padding: 20, gap: 10 },
  body: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  button: { marginTop: 6, alignSelf: "stretch" },
}));
