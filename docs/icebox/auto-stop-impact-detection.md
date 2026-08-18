# Auto-stop recording on impact detection

**Status:** ICEBOX · **Filed:** 2026-08-18 · **Source:** session-mode spec (D61 — Taylor: "in future there is an auto stop in which it detects audio spike? or something? Ice box")

**Story.** As a golfer recording in session mode with the phone on a stand, I want the
recording to end itself shortly after my swing, so I never walk back to tap stop and my
clips don't carry long dead tails.

**Shape when revived.** The "Auto end recording" toggle already ships in session-mode's
settings sheet (default on, rendered "coming soon" and inert until this lands), so revival
is a detector, not a UI change. Candidate signals, cheapest first: **audio spike** (impact
is the loudest transient in a range bay — needs RECORD_AUDIO, a rolling dB baseline, and a
debounce so club-drops and neighbouring bays don't fire it), accelerometer/vibration
(phone-on-stand couples poorly — likely dead end), or a lightweight on-device motion cue
(frame-difference burst through the hitting zone — CPU cost while recording is the risk;
full CV stays in the analyzer, never the client). Fire = stop N seconds after the spike
(finish + follow-through padding), never instantly. False-positive posture: stopping early
loses the swing, so bias hard toward NOT firing — a missed auto-stop costs a tap, a wrong
one costs the recording. Manual stop always remains.

**Revive when:** session-mode wiring (steps 04–06) is stable on device, so there is a real
recording loop to measure detector precision against — and real range recordings exist to
tune the audio baseline on.
