/**
 * `react-native-gesture-handler` is present but must NOT be linked into the Android build.
 *
 * Nothing in this app uses it. It is in `node_modules` because `expo-router` is a peer dependency
 * of `@expo/cli` — which ships inside `expo` itself — and pnpm's hoisted linker (D21) puts every
 * transitive package in the repo-root `node_modules`, where React Native's autolinking finds it
 * and compiles it whether or not a line of code imports it.
 *
 * That is not merely wasteful here, it breaks the build outright. Its C++ codegen object paths
 * (`.cxx/.../CMakeFiles/react_codegen_rngesturehandler_codegen.dir/C_/Users/.../shared/
 * shadowNodes/react/renderer/components/rngesturehandler_codegen/…ShadowNode.cpp.o`) run past
 * 260 characters, and the `ninja` bundled with the Android SDK's CMake refuses those outright —
 * a hard limit inside ninja, not a Windows one. Windows long paths are already enabled on this
 * machine and make no difference.
 *
 * Delete this file the day the app actually needs gesture handling (a drawer, a swipeable row);
 * at that point the module has to link, and the path length becomes a real problem to solve
 * rather than a cost to decline.
 */
module.exports = {
  dependencies: {
    "react-native-gesture-handler": { platforms: { android: null, ios: null } },
  },
};
