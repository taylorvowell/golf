import SpikeScreen from "./src/spike/SpikeScreen";

/**
 * Entry point. The spike lives in `src/spike/` so that when step 02 closes and the harness is
 * replaced by the real app shell (mobile-app-shell track), the whole thing is one directory to
 * delete rather than a screen to disentangle from App.tsx.
 */
export default function App() {
  return <SpikeScreen />;
}
