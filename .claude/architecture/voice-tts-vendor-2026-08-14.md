# Voice/TTS vendor for the focus-mode spoken feedback bank — 2026-08-14

**Status:** ACCEPTED 2026-08-14 (Taylor: "let's finalize this"). Recorded as **ARCHIVE D57**
+ register entry in `docs/decisions/analysis-and-ai.md`; spec in `PROJECT_MAIN.md` §8.5.
Recommendation was amended same day from ElevenLabs to **Gemini 3.1 Flash TTS** after Taylor
asked to evaluate it (see § Amendment at the bottom). Design detail:
`.claude/feature-tracks/goal-progression/DESIGN-focus-mode.md` (moved from the temp
brainstorm).

## The question

Which TTS vendor generates the **pre-recorded coach-voice line bank** for focus-mode spoken
after-swing feedback (see `.claude/BRAINSTORM-focus-mode.md` § B-extended)? Shape of the
workload: one-time-ish **batch generation** of hundreds of short authored lines (verdict
phrasings × moments × focus-area cues), bundled as app assets, regenerated in small batches
when templates change. Device TTS is the offline fallback. **Speak-only** — no STT, no
realtime conversation (deferred to icebox by Taylor, 2026-08-14). Candidates considered:
ElevenLabs, OpenAI TTS, Google Cloud TTS, Amazon Polly, device-native only.

## Mode

Audit/first-principles. No prior voice/TTS decision exists in `docs/decisions/`.

## Internal grounding

- `docs/decisions/analysis-and-ai.md`: the AI **provider seam is server-side and the model
  deliberately unchosen**; providers touching golfer data must commit to no-training +
  zero/short retention. **Neither constraint binds here** — batch generation sends only our
  own authored copy, no golfer data, and the app never calls the vendor at runtime (assets
  are bundled), so there is no runtime provider seam to design.
- CLAUDE.md: AI never a hard dependency — trivially satisfied; the bank is static assets and
  device TTS covers the missing-asset path.
- No `.claude/architecture/` records existed before this one.

## External facts (verified 2026-08-14)

- **ElevenLabs:** TTS $0.10/1k chars (Multilingual), $0.05 (Flash); every **paid** plan
  (from Starter $5/mo) carries a commercial license, and rights to already-generated audio
  are **perpetual** — they survive cancellation. Free tier: no commercial use, attribution
  required. Sources: elevenlabs.io/pricing/api; terms.law ElevenLabs rights analysis.
- **OpenAI TTS:** output ownership assigned to the customer, commercial use permitted;
  usage policy **requires disclosing to end users that the voice is AI-generated**.
  gpt-4o-mini-tts ≈ $0.60/M text-in + $12/M audio-out tokens (≈1.5¢/min). Sources: OpenAI
  business terms; platform.openai.com TTS guide; terms.law analysis.
- Google Cloud TTS / Amazon Polly: commercially usable, cheaper per character, voice quality
  a clear notch below both of the above for a warm "coach" register (well-established; not
  re-verified per-voice).
- Whole-bank cost at ElevenLabs' premium rate: ~50k characters ≈ **$5**. Cost is a
  non-factor at this workload for every candidate; the decision turns on quality and
  regeneration stability.

## Verdict

**ElevenLabs, on a paid plan (Starter $5/mo or API pay-as-you-go), generating with a pinned
voice ID + model version.** Device TTS stays as the offline/missing-asset fallback.

## Why

- The coach voice **is the product feel** of this feature — Taylor's stated bar is "feels
  like a real coach, new each time." ElevenLabs is the quality leader for exactly this warm,
  natural register; at a ~$5 total workload, paying the premium rate costs nothing real.
- **Perpetual rights on generated audio** fit the bundle-and-cancel model perfectly: run the
  batch, ship the assets, stop paying; regenerate on a $5 month when templates change.
- **Voice consistency across regenerations:** ElevenLabs voice IDs are stable, pinnable
  artifacts. OpenAI's TTS voices are tied to model versions that deprecate on OpenAI's
  schedule — a regeneration two years in could subtly change the coach's voice mid-bank.

## Road not taken

- **OpenAI TTS** — loses narrowly: quality a notch below for this register, and voice/model
  deprecation risks a mid-bank timbre shift. Would be the pick if we needed one vendor for
  TTS+STT+realtime — but two-way voice is icebox, so that synergy buys nothing today.
- **Google Cloud TTS / Amazon Polly** — cheaper per character on a workload where cost is
  irrelevant; voice quality is the whole game and they trail it.
- **Device-native only** — zero cost and already the fallback, but a synthetic voice
  undercuts the coaching feel that motivated the feature.

## Gaps folded into the plan

1. **Regeneration drift** → a small versioned `voice_config` (voice ID, model version,
   output format) lives next to the generation script, plus a manifest (line id → text hash
   → asset file) so only changed lines regenerate. Same versioning discipline as
   `scoring_config`.
2. **AI-voice disclosure** (OpenAI requires it; good practice under any vendor) → one line
   in app settings/about: the coach voice is AI-generated. Costs nothing, keeps every
   vendor's terms satisfied.
3. **Asset weight** → hundreds of short lines at ~48kbps Opus ≈ a few MB. Bundle; no CDN
   needed at launch.
4. **No runtime vendor dependency** → generation is a repo script; the app only plays local
   assets. Offline works; "AI never a hard dependency" holds structurally.
5. **Spend + account** → creating the ElevenLabs account and paid plan is a Taylor action
   (money + credential). Becomes a `docs/HANDOFF.md` row when the voice work is actually
   scheduled — not before.

## Path forward

**Just a decision** — voice v1 is part of the focus-mode brainstorm, which is not yet
absorbed into the roadmap. When it is, this work lands inside that feature's steps. On
Taylor's acceptance: add a numbered `Dxx` entry to `docs/decisions/analysis-and-ai.md`
("Spoken feedback is a pre-generated ElevenLabs line bank, versioned, bundled, device-TTS
fallback").

## Open threads

- Voice selection itself (which voice is "the SwingSage coach") is a product taste call for
  Taylor at build time — the architecture only pins that it must be one stable voice ID.

---

## Amendment (2026-08-14, same day): Gemini 3.1 Flash TTS evaluated → becomes the pick

Taylor asked to evaluate `gemini-3.1-flash-tts`, having listened to it and found the voices
highly realistic. Facts verified 2026-08-14:

- **Pricing:** $20/M audio-output tokens at 25 tokens/sec of audio → **$0.03 per minute of
  generated audio**. The whole bank (~500 lines × ~4s ≈ 33 min) ≈ **$1**; AI Studio's free
  quota may cover batches entirely. (Sources: ai.google.dev pricing coverage; OpenRouter
  model page.)
- **Capabilities:** 30 prebuilt voices with personality labels; **natural-language style
  direction** with inline tags — per-line emotional steering ("warm and encouraging",
  "excited", `[whispers]`). Output PCM 24kHz/16-bit mono; all output SynthID-watermarked
  (inaudible; harmless for this use).
- **License:** Gemini API output is owned by the customer, commercial use permitted, API
  data not used for training. Clean for bundling in a commercial app.
- **Caveat:** the model is listed as **preview** (`gemini-3.1-flash-tts-preview` on
  OpenRouter) — Google preview models get replaced on Google's schedule, so voice timbre is
  not durably pinnable.

**Why the verdict changes.** The original ElevenLabs edge was two things: quality and
regeneration stability. On quality, Taylor's own ear — the taste that matters — rates Gemini
at the bar, and its per-line style direction is a genuine feature fit this workload uniquely
rewards: moment lines *want* different emotional registers (celebration vs calm cue), and no
other candidate steers that per line in plain language. On stability, the honest
re-examination is that **the drift criterion is neutralized by policy, not by vendor**: at
~$1–5 per full bank, the manifest simply regenerates the *entire* bank whenever the model or
voice changes, so mixed-voice drift never ships — under that policy ElevenLabs' pinned voice
IDs stop being a differentiator (and its voice-library voices are not immortal either).
Structurally, the generation script is a repo script with the vendor behind a flag, and
generated assets are owned and archived — switching vendors later is a re-run, not a
migration, which makes this a deliberately low-stakes decision.

**Amended verdict: Gemini 3.1 Flash TTS**, with (a) the whole-bank-regeneration-on-change
policy in `voice_config` + manifest, (b) the vendor kept behind a script flag with
ElevenLabs as the named fallback if the preview graduates badly or the voice disappoints on
longer listening, (c) likely zero new vendor surface — a Google Cloud project already exists
(the OAuth client in ENVIRONMENT.md); an AI Studio API key is the only addition, still a
Taylor credential action when scheduled. All prior gap-solutions (disclosure line, Opus
assets, no runtime dependency) carry over unchanged. The bank should be generated at a fixed
model version recorded in `voice_config`, and a 10-line side-by-side against ElevenLabs at
build time is the cheap way to confirm the taste call before generating the full bank.

Road not taken (updated): **ElevenLabs** — still excellent, loses on style steerability and
on needing a new paid vendor account; retained as the explicit fallback. OpenAI / Google
Cloud TTS classic / Polly / device-native — unchanged from the original analysis.

**Addendum 2026-08-17 — Replicate is the generation route.** Taylor has a Replicate account
in active use (ENVIRONMENT.md § Replicate) and pointed out — correcting an initial wrong
claim in this addendum's first draft — that **the chosen model itself is on Replicate as an
official listing: `replicate.com/google/gemini-3.1-flash-tts`** (verified 2026-08-17: same
30 voices, style prompts plus inline tags `[whispering]`/`[excitedly]`/`[short pause]` etc.).
That collapses the plumbing: **D57's model choice is unchanged, and its API route becomes
Replicate** — one existing account now covers the chosen model AND the bake-off alternates
(MiniMax Speech 02 HD ≈ $5/bank, Chatterbox ≈ $1.25, Kokoro ≈ $1, ElevenLabs remains the
off-Replicate fallback vendor). The Google AI Studio key HANDOFF row is superseded by a
`REPLICATE_API_TOKEN` in the generation script's env; `voice_config` pins the Replicate
model ref + voice, and the whole-bank regeneration policy is unchanged. The model page lists
no explicit price — immaterial at bank scale; read it off the page when the bank first
generates. Separately noted: Replicate's larger potential lever is the analyzer worker host
(custom Cog models, per-second GPU billing — fits the bursty session shape); that belongs to
the open worker-host decision, not this record.

## Full candidate comparison (verified 2026-08-14)

Workload normalization: the whole bank ≈ 500 short lines ≈ 50k characters ≈ 33 minutes of
audio. **Cost is a non-factor for every candidate** (all ≤ ~$8 per full bank); the decision
turns on quality, style control, and regeneration stability.

| Model | Pricing | Bank cost | Quality & style control | License for bundling | Key risks / downsides |
|---|---|---|---|---|---|
| **Gemini 3.1 Flash TTS** ← pick | $20/M audio tokens (25 tok/s) = $0.03/min; $1/M text-in | **~$1** (AI Studio free quota may cover it) | Very realistic (Taylor's ear confirms); 30 voices; **per-line natural-language style direction** — unique among candidates | Output owned by customer, commercial use OK, API data not trained on | **Preview model** — Google can replace it and shift timbre (mitigated: whole-bank regen ≈ $1); SynthID watermark on all output; 24kHz mono PCM ceiling; 2-speaker cap (irrelevant here) |
| **ElevenLabs** (fallback) | $0.10/1k chars (Multilingual), $0.05 (Flash); commercial license needs any paid plan (from $5/mo) | ~$5 (+$5 one month of Starter) | Arguably the quality ceiling; huge voice library; stable pinnable voice IDs; style control coarser (voice settings, not per-line prose) | Perpetual rights to generated audio on paid plans — survive cancellation | New paid vendor account; voice-library voices can still be delisted; per-char price 3–5× the field (still trivial) |
| **OpenAI gpt-4o-mini-tts** | $0.60/M text-in + $12/M audio-out ≈ 1.5¢/min | ~$0.50 | Good, a notch below the two above for a warm coach register; some tone steerability via instructions | Output ownership assigned; commercial OK; **requires disclosing AI voice to users** | Voices ride model versions that deprecate on OpenAI's schedule — same drift risk as Gemini but without the style-control upside; no other synergy now that realtime/STT is iceboxed |
| **Google Cloud TTS (classic)** | Neural2 $16/M chars; Chirp 3 HD $30/M; Studio $160/M | $0.80–8 | Solid utility voices; Studio tier decent; clearly below Gemini/ElevenLabs for warmth; minimal style control (SSML) | Standard GCP terms, commercial OK | Sounds like an IVR next to the leaders; SSML tuning is tedious for hundreds of lines |
| **Amazon Polly** | Neural $16/M chars; Generative $30/M | $0.80–1.50 | Generative engine improved (expanded Mar 2026) but still trails; SSML only | Standard AWS terms, commercial OK | Weakest coach-register quality of the cloud options; new AWS surface for no offsetting benefit |
| **Device-native TTS** (expo-speech) | $0 | $0 | Synthetic, flat; zero style control | N/A — nothing generated or bundled | Undercuts the entire premise of a coach voice; kept as the **offline/missing-asset fallback**, never the product voice |

Cross-cutting consideration regardless of vendor: assets are generated once, owned, archived,
and bundled — the app never calls a TTS vendor at runtime, the generation script keeps the
vendor behind a flag, and the AI-voice disclosure line in settings satisfies every vendor's
terms at once.
