# How SwingSage finds the moment of impact in an uploaded clip, before any user edit

A raw uploaded video (often 30–60 seconds of a golfer walking out, swinging, and walking back)
becomes a ~5-second single-swing clip with no user input in the common case. This describes
that mechanism and its timing behavior.

## The detection

- **The signal is audio only — no video decode.** An on-device detector reads the clip's audio
  track for strike-shaped transients. A real strike is a *whoosh with a click on the end*; a
  practice swing is a whoosh without one, which is what ranks actual ball contact above
  rehearsal swings without special-casing. Because it never touches the video, it costs a few
  hundred milliseconds regardless of clip length, resolution, or frame rate, and runs behind
  the brief loading screen right after the user picks a clip.
- **Edge weighting.** The first and last ~5 seconds of the clip are down-weighted (not
  excluded): a golfer filming alone walks away from the phone and walks back, so the clip's
  edges are footsteps and phone handling. It is a prior, not a filter — a loud genuine strike
  at the edge can still win.
- **The last plausible strike wins, not the loudest.** Up to three scored candidates come
  back. The strongest wins unless a *later* candidate scores at least 60% of it, in which case
  the later one is taken — when two balls are genuinely struck in one take, the second is the
  one being saved.
- **Silence is never an error.** If nothing strike-like is heard, the mark falls 6 seconds
  from the end of the clip (where a swing tends to sit when the golfer walked back to stop the
  recording), and the user simply sees that window to accept or correct.

## What it does timing-wise to get the swing

- **The window is a fixed 5 real seconds: 2.5 s before the detected strike to 2.5 s after**,
  clamped to the clip's bounds. That envelope covers setup through finish for any normal swing.
- **Slow-motion files are converted through their slow-mo factor.** A phone slow-mo clip
  captured at 240 fps is written with a 30 fps timeline that runs 8× slower than the world, so
  2.5 real seconds = 20 file-timeline seconds. The window math is done in real seconds and
  multiplied through, so the saved clip always holds the same 5 real seconds of swing.
- **The preview is the cut.** The confirmation screen loops exactly this window through the
  same arithmetic that later trims it — what the user watches is byte-for-byte what gets saved.
- **The cut itself is a remux, not a re-encode.** On save, a 0.1 s pad is added to each side
  (invisible slack so a slightly-early edge never clips the takeaway), and the range is copied
  out at the container level — milliseconds of work, no quality loss. The cut snaps to the
  previous keyframe, so it may start slightly earlier than asked, never later.
- **If the user answers "no" and edits**, they drag a single mark ("where you hit the ball")
  on a scrubber seeded at the detected moment; the same 5-second window is cut around wherever
  the mark lands. The user never chooses clip edges — only the strike moment.

## Scope and authority

This mechanism decides only **what gets trimmed and uploaded**. It is deliberately never a
measurement: the analyzer later derives the true impact frame visually from the club-head
trajectory (cross-checked by a server-side audio witness and the ball's disappearance frame),
and neither the client's audio seed nor a hand-dragged mark ever overrides that. The seed only
has to be roughly right — its failure cost is one drag on the edit screen.
