Switch the phone between LOCAL DEV (Metro + fast refresh, desk work) and REMOTE/PORTABLE (standalone release APK, PC can be off).

Both modes always use the PRODUCTION backends — Vercel API, `swingsage-prod`, R2, Modal. The switch decides where the JAVASCRIPT comes from, never which servers are used.

Invoke the `switch` skill. It reads the intent from what was said — "local dev" / "fast refresh" / "back at the desk" means DEV; "remote dev" / "going to the sim" / "make it portable" means PORTABLE — connects the phone with `node scripts/adb-phone.mjs` if needed, and runs the one command for that mode:

- DEV → `pnpm --filter mobile phone` (add `:native` after a Kotlin or `app.json` change)
- PORTABLE → `pnpm --filter mobile phone:release`

With no argument, switch to whichever mode is NOT currently installed if that is determinable, otherwise ask which one.

Session and app data survive every swap (same package, same signing key). Report which mode is now live.
