# Changes Incorporated in v2

This package supersedes the earlier planning pack. Main changes:

| Area | Prior direction | v2 decision |
|---|---|---|
| User impact mark | trim seed; could be misunderstood as useful prior | explicitly forbidden from server impact inference |
| Pre-upload weak audio | end-of-clip heuristic | conditional sparse visual motion fallback, only when needed |
| Pre-upload selected window | no explicit CV guard | cheap swing-window sanity check before upload |
| Slow-motion metadata | vulnerable to remux tag loss | authoritative separate source/trim manifest |
| Pre-upload validation | mainly server-side | local post-remux preflight plus server repeat |
| Club architecture | sparse detector + dense local club analysis | strengthened into CADDIE-inspired five-keypoint club pose |
| Low-confidence club observations | candidate logic | explicitly retain bounded plausible low-confidence candidates for sequence solve |
| Trackers | optional | ByteTrack/OC-SORT ideas are candidate generators only, not authoritative architecture |
| Club gaps | honest dashed gaps | unchanged; reject unproven curved reconstruction |
| Impact | multimodal | reaffirmed; explicitly reject audio-authoritative design |
| Body interpolation | display support | scoring-critical frames require direct observation when configured |
| Event model | coarse-to-fine | add SwingNet as benchmark baseline, not final requirement |
| Runtime | batching/GPU optimization | keep, but speed/cost estimates remain hypotheses until measured |
| Warm GPUs | optimize later | explicitly test session-aware warmth/upload overlap before permanent warm pool |
