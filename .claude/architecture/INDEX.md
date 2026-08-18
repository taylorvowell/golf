# Architecture decisions — index

- [guided-drills-architecture-2026-08-17.md](guided-drills-architecture-2026-08-17.md) — Where guided drills (D59) live: a second pipeline profile in the analyzer (pose-only, no GPU), repo-versioned `drill_config/` specs split from DB-authored content, sibling `drill_analysis.json`/`drill_report.json` artifacts, structural quarantine via `drill_attempts` tables, drill jobs on the same queue with a `kind` + fast lane. ACCEPTED 2026-08-17 → D59.

- [coach-and-focus-2026-08-14.md](coach-and-focus-2026-08-14.md) — Focus surfaces present as the Coach's guidance (product IA: yes), but the Coach is a persona over deterministic systems and never owns focus state (system: no). ACCEPTED 2026-08-14 → D58.
- [voice-tts-vendor-2026-08-14.md](voice-tts-vendor-2026-08-14.md) — TTS vendor for the focus-mode coach-voice line bank: Gemini 3.1 Flash TTS (amended same day from ElevenLabs, which stays the fallback), whole-bank regeneration policy, device-TTS fallback. ACCEPTED 2026-08-14 → D57.
