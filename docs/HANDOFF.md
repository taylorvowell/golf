# Handoff Register — what needs a human, and what already got one

Every task that needs **Taylor** rather than Claude lives here, and **only** here.

`scripts/env-probe.mjs` reads this file at session start and prints every `OPEN` row into the
session, so an outstanding human task arrives in context the same way the phone's LAN address
does. That is the point of the file: a hand-off that lives in prose gets re-asked, and a task
that was already done gets asked for a second time. Both have happened.

## Rules

1. **Never ask Taylor for anything that is not an `OPEN` row here.** Before writing any hand-off
   sentence, check this table. If the ask is not a row, add it as a row first — the act of adding
   it is what forces the check for whether it is already `DONE`.
2. **Never invent a row for something Claude can do.** Money, hardware, an interactive login, a
   vendor dashboard, deleting user data, a production deploy. Everything else is Claude's job —
   "run this command" is not a hand-off.
3. **When Taylor says he did something, mark it `DONE` in the same turn**, with the date and what
   changed. Do not leave it in chat.
4. **A `DONE` row is never deleted.** It is the answer to "did we already do this?" — the exact
   question that gets asked wrong. Rows are only removed when the whole area is retired.

## Status values

`OPEN` — needed now, printed at session start · `BLOCKED` — needed, but waiting on something else
first (state what) · `DONE <date>` — completed, keep for the record · `DROPPED` — no longer needed

<!-- PROBE-READS-BELOW — env-probe.mjs parses the table rows under this marker -->

| Status | What | Why it needs a human | Notes |
|---|---|---|---|
| DONE 2026-08-11 | Google OAuth **web** client created | Google Cloud Console — interactive login | `665583572860-v7lsnd65s2pmr9g4qu29jurb7gqoltk4.apps.googleusercontent.com`. This is the id the app passes to `GoogleSignin.configure`. |
| DONE 2026-08-11 | Google OAuth **Android** client created | Google Cloud Console — interactive login | `665583572860-tlfq1jrit3g4hrmoatlcub81r6t13gn8.apps.googleusercontent.com`, bound to `com.swingsage.spike` + SHA-1 `5E:8F:…:F6:25`. Must exist; never appears in the bundle. |
| DONE 2026-08-11 | Google provider enabled in Supabase, with Authorized Client IDs | Supabase dashboard — interactive | Web client id + secret in the provider; both client ids in the authorized list. |
| DONE 2026-08-11 | `apps/mobile/.env` populated | Holds real (public) values; gitignored | 5 `EXPO_PUBLIC_*` keys set. `.env.example` carries the same public ones. |
| DONE 2026-08-11 | Android wireless debugging paired | Physical device interaction | Pairing survives reboots; the **port changes** and must be read off the phone each time. |
| OPEN | Fix the `ANDROID_SDK_ROOT` user environment variable | Windows user env vars — GUI | Its value contains its own name, so every Android build needs the inline override. Settings → System → About → Advanced system settings → Environment Variables → User → `ANDROID_SDK_ROOT` = `C:\Users\taylo\AppData\Local\Android\Sdk` |
| BLOCKED | Rename the Android package `com.swingsage.spike` → `com.swingsage.app` | Needs a new Android OAuth client first (Console, interactive) | Permanent from the first store upload; visible in the Play Store URL forever. **Blocked on:** one additive Android client for the new package on the same SHA-1. Free. Claude does the rename once it exists. |
| BLOCKED | Apple Developer Program enrolment ($99/yr) | Money | Needed for Sign in with Apple and any iOS build. Nothing iOS has ever been compiled — there is no Mac. |
| BLOCKED | A2P 10DLC registration | Money + a business identity | Gates real SMS delivery. The free development path is a local Supabase stack's test OTP, which Claude can build without this. |
| BLOCKED | Second + third Supabase projects (preview, production) | Money — production tier is $25/mo | Preview is free. Three environments is a recorded decision that is currently unmet. |
| OPEN | Decide the analyzer worker host | Strategic + spend | Railway has no GPU. The first `analyzer-service` step is a CPU-vs-CUDA measurement that informs this; the *choice* is Taylor's. |
