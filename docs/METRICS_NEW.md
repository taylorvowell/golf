# SwingSage Comprehensive Multimodal Swing Analysis Specification

## Completed deliverable

I rebuilt the specification as a single comprehensive Markdown document that starts with the **61 measurements and quality fields already present in SwingSage**, preserves their existing identity, marks corrections as **UPDATE**, and then expands the system through **192 numbered swing, club, simulator, derived, and quality metrics**, plus **27 golfer/club/calibration context fields** and **37 multimodal diagnostic rules**. The starting inventory came from your current SwingSage metrics document. fileciteturn0file0

**[Download the complete updated Markdown specification](sandbox:/mnt/data/SwingSage_Comprehensive_Multimodal_Swing_Metrics.md)**

The resulting document is designed around the actual inputs you described:

**DTL video + face-on video + stick-figure joints + silhouette + club/clubface tracking + simulator data + golfer height + club/shaft metadata + Pro 1 reference movement.**

It also explicitly supports incomplete uploads. A swing can contain only DTL, only face-on, only simulator data, or any combination. Every metric now has an implied or explicit data requirement, and missing information is supposed to produce **N/A / insufficient evidence**, not a zero or fabricated measurement.

## The biggest conceptual change

The most important research conclusion is that **Pro 1 should absolutely be usable as your movement gauge, but Pro 1 should not be treated as the one universal definition of biomechanical correctness**.

Research on professional and highly skilled golfers shows meaningful variation in pelvis and thorax motion, posture, coordination, and movement strategy. A study of 25 PGA and 25 LPGA professionals found significant differences in trunk forward tilt, pelvis orientation and impact rotation between the groups. Another study of skilled golfers concluded that male and female players used different upper-body movement strategies while both progressively reduced hand and clubhead trajectory variability approaching contact. citeturn11search10turn11search6turn11search8

That led me to separate four concepts that should not be mixed into one score:

| Score                                | What it actually means                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| **Impact & Outcome Score**           | How well the club and ball behaved at impact according to simulator physics |
| **Delivery & Body Mechanics Score**  | Whether observable club/body movements supported a robust delivery          |
| **Pro 1 Reference Similarity Score** | How closely the player's normalized movement resembles Pro 1                |
| **Coverage & Confidence Score**      | How much trustworthy evidence was actually available                        |

This distinction is particularly important because skilled golfers can have different body-motion strategies while still producing very repeatable clubhead behavior near impact. citeturn11search8

So SwingSage can still tell somebody:

> **Your finish is 92% similar to Pro 1.**

while separately telling them:

> **Your measured delivery is excellent despite the difference. No mechanical correction is recommended.**

That is much safer than teaching the software that every visible deviation from one professional must be a fault.

## What was added to the metric system

The downloadable specification contains the complete registry, but there are several major new families.

### The requested DTL and silhouette measurements

Your requested observations were incorporated directly, including the trailing-foot finish, butt-line retention, posture, finish hip line, leg structure, arm/spine relationships, downswing-under-backswing path, impact trail-arm relationship, hip/shoulder separation, shoulder tilt and trail-heel behavior.

A particularly important addition is the new **silhouette-first pelvis-depth system**.

Instead of relying only on a mid-hip keypoint, SwingSage can establish the golfer's rear-most pelvis or "butt line" at address and continuously measure the silhouette against it through P4, P5, P6 and impact. That becomes a much closer representation of what a coach visually means when discussing maintaining hip depth.

The new DTL family includes, among others:

| New/updated measurement                       | Purpose                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| **Trail-foot finish toe support**             | Measures heel elevation, toe support and sole roll at P10                    |
| **Pelvis/butt-line depth retention**          | Tracks rear pelvis silhouette against address line                           |
| **Lead glute depth retention**                | Determines whether lead-side depth is preserved/replaced through rotation    |
| **Trail glute depth retention**               | Tracks backswing and transition pelvis depth                                 |
| **Head-neck-spine collinearity**              | Quantifies the straight head/neck/back relationship you identified           |
| **Finish pelvis levelness**                   | Measures hip line relative to calibrated ground                              |
| **Finish pelvis-facing-target proxy**         | Qualitative rotational finish measure                                        |
| **Finish lead-leg extension**                 | Measures lead knee flex at P10                                               |
| **Finish thigh orientation**                  | Measures each femur from vertical and the relationship between them          |
| **Finish leg separation**                     | Measures knee/ankle separation and silhouette overlap                        |
| **Finish spine angle**                        | Direct Pro 1 comparison at P10                                               |
| **Lead-arm straightness envelope**            | Measures elbow flex continuously from takeaway through impact                |
| **Lead forearm-to-spine angle at P4**         | Implements your fully-coiled backswing comparison                            |
| **DTL shallowing-loop index**                 | Compares downswing against backswing at matched hand heights                 |
| **DTL over-the-top index**                    | Quantifies the opposite reroute                                              |
| **Trail upper-arm-to-spine at impact**        | Implements your requested impact geometry                                    |
| **Trail-elbow/rib gap**                       | Quantifies visible arm/body separation                                       |
| **Trail-elbow flex at impact**                | Measures the slightly bent trail-arm condition                               |
| **Trail-vs-lead arm proximity**               | Tests the relationship you described without falsely calling it lag          |
| **Pelvis openness proxy at impact**           | Qualitative projected pelvis state                                           |
| **Thorax openness proxy at impact**           | Qualitative projected thorax state                                           |
| **Pelvis-thorax separation proxy**            | Determines whether pelvis appears rotationally ahead                         |
| **Impact shoulder tilt**                      | Checks whether trail shoulder is projected lower                             |
| **Trail heel lift at impact**                 | Measures actual heel elevation and timing                                    |
| **Handle depth through delivery**             | Detects loss of hand/body space                                              |
| **Head depth through delivery**               | Separates head movement from pelvic movement                                 |
| **Shaft-to-trail-forearm relationship at P6** | Describes delivery-plane organization                                        |
| **Hand-path and clubhead loop area**          | Measures the complete backswing/downstroke reroute rather than a still image |
| **Finish balance hold**                       | Measures movement after the golfer reaches the finish                        |

These are intentionally not all weighted equally. Finish measurements are useful diagnostic and Pro-reference measurements, but because the ball has already left the club by the finish, they should receive much less causal weight than impact and pre-impact delivery.

### A complete face-on metric family

Your current system is overwhelmingly DTL-focused. The new document adds the face-on side required to assess quantities DTL simply cannot see properly.

The major face-on additions include:

**Setup:** ball position within stance, stance width, hands relative to ball, true projected shaft lean, spine side tilt, shoulder tilt, hip tilt, head relative to pelvis, pelvis within stance, and knee-flex asymmetry.

**Backswing:** pelvis lateral sway, head lateral sway, sternum sway, trail-side loading pose proxy, trail-knee retention and top position.

**Transition:** targetward pelvis shift, lead-hip organization over the lead ankle, head versus pelvis translation and lower-body sequencing.

**Impact:** head relative to ball, sternum relative to ball, spine side tilt, shoulder tilt, hands ahead of ball, forward shaft lean, lead-leg extension, trail-knee motion, pelvis target shift, trail-heel behavior and head stability.

**Finish:** pelvis over lead foot, finish support-side proxy, lead-leg straightness, spine side tilt, shoulder levelness, hip levelness, body-facing proxy, trail-toe finish and finish head stability.

This also fixes an important problem in the existing system: several quantities need to be **split by view** instead of being treated as though the same 2D number means the same thing from every camera.

Single-camera video can be useful for properly chosen image-plane and temporal measurements, but transverse body rotation and out-of-plane joint motion are inherently more difficult. Validated IMU work, for example, can achieve strong agreement with 3D motion capture for pelvis and upper-torso rotational biomechanics, which is a much better model for eventually unlocking true X-factor and rotational sequence. citeturn11search13

## Important corrections to the existing assumptions

Deep research produced several places where I would change the present implementation rather than merely adding more metrics.

### Shaft lean must be view-gated

The existing iron and driver shaft-lean scores need to be **face-on only**, or derived from calibrated multi-view data.

A DTL camera sees the shaft primarily in the swing-plane projection. Forward shaft lean points substantially into/out of the camera's depth dimension and therefore should not be presented as the same physical measurement.

The updated specification keeps the DTL shaft angle, but relabels it as an **in-plane shaft orientation/delivery metric**.

### Lead wrist does not equal clubface angle

The existing file describes lead-wrist condition at impact very strongly, effectively equating it with clubface condition. That wording should be softened.

Lead-wrist geometry can be extremely useful, but clubface presentation is also affected by forearm/shaft roll, grip relationship and shaft/clubhead dynamics. Research on shaft and clubhead kinematics shows the moving club system can alter head orientation relative to the grip. citeturn12search0

The new hierarchy therefore becomes:

**wrist condition → supporting face-control evidence**

while

**simulator face angle → actual measured face orientation at impact**

when the simulator supplies it.

### "Lag" should not come from the trail arm alone

Your proposed observation that the trail arm should remain bent and closer to the body at impact is useful, and I included both measurements.

But I separated them from the actual **lag/release metric**.

The stronger measurable concept is:

**lead forearm-to-shaft angle over time + how long it is retained + when it begins opening + rate of release.**

So the app can say:

> Trail arm is 24° flexed and relatively close to the torso.

and separately:

> Wrist-to-shaft angle began releasing at 71% of the downswing, 8% earlier than Pro 1.

That is more meaningful than concluding "you lost lag" from elbow position alone.

### The lead arm should not be required to be perfectly locked

I preserved your desire for lead-arm straightness but converted it into a **straightness envelope**.

Rather than "180° is ideal from backswing through impact," the system now examines:

- median elbow flex,
- maximum elbow flex,
- when flex occurs,
- whether there is a sudden collapse,
- and whether the arm is sufficiently in the camera plane for the angle to be believable.

That also addresses the current projection problem already visible in your existing DTL arm metrics. fileciteturn0file0

### Trail heel lift is useful, but not universal proof of weight transfer

The app can absolutely measure whether the trail heel has begun lifting at impact, how much it has lifted, when it starts moving, how the foot rolls, and whether the golfer reaches a toe-supported finish.

What it should **not** say is:

> Your weight has shifted correctly because your heel lifted.

Actual ground-reaction force and center-of-pressure require force/pressure measurement. Golf biomechanics research connects force-plate variables with performance, which is exactly why video should distinguish observable foot/body motion from actual measured force. citeturn10view12

The document therefore calls these **loading/ground-use pose proxies**.

### X-factor and pelvis rotation should remain deferred as absolute degrees

The existing pipeline was right to become suspicious of its projected rotation family. fileciteturn0file0

Shoulder-width projection, hip-width projection and line tilt from one 2D view are not reliable substitutes for true axial body rotation.

I retained them for:

> projected rotation state  
> Pro 1 similarity  
> facing classification

but not for statements such as:

> pelvis is exactly 42° open.

True rotational scoring should eventually come from synchronized calibrated views, a true 3D pose reconstruction, or validated IMUs. Research comparing IMUs with 3D motion capture found very strong agreement for upper-torso and pelvic rotation metrics. citeturn11search13

### Finish metrics should not dominate the swing score

Your finish observations are useful and all of them are in the document.

But the finish cannot cause the impact that occurred earlier.

So I recommend that the final app distinguish:

> **Impact causal metric**

from

> **Finish consequence / balance / Pro-reference metric**

For example, a golfer who finishes with a lower trail heel than Pro 1 but delivers a centered, highly efficient shot should not have the app tell them the trail heel was the cause of a fault.

## Simulator integration and what the screenshot changes

The screenshot is extremely useful because it gives the app access to **actual club-delivery and ball-flight evidence** instead of requiring body appearance to stand in for impact physics.

The visible Full Swing screen gives:

| Simulator field  |   Supplied shot |
| ---------------- | --------------: |
| Face to Path     | **14.2° right** |
| Face Angle       |  **9.5° right** |
| Club Path        |   **4.7° left** |
| Horizontal Angle |  **6.7° right** |
| Carry            |    **127.7 yd** |
| Total            |    **134.0 yd** |
| Launch Angle     |       **24.6°** |
| Ball Speed       |   **101.4 mph** |
| Club Speed       |    **87.5 mph** |

Full Swing currently lists 16 KIT club/ball data fields in total: carry, total, spin rate, spin axis, face angle, face to path, attack angle, launch angle, ball speed, club speed, smash factor, club path, horizontal angle, apex height, side carry and side total. citeturn11search0turn11search1

I incorporated all 16 as first-class simulator fields, plus optional cross-vendor fields such as dynamic loft, spin loft, swing direction, swing plane, low point, impact height, impact offset, dynamic lie and landing angle when a particular launch monitor makes them available.

### The screenshot also gives you a valuable automatic data-integrity test

TrackMan's technical definition is:

**Face to Path = Face Angle − Club Path.** citeturn10view1

For your screenshot:

**9.5 − (−4.7) = 14.2°**

which exactly matches the displayed **14.2° Face to Path**.

That means SwingSage can automatically perform this sanity check whenever those three fields are imported. If OCR or data ingestion produces:

> Face = 9.5  
> Path = −4.7  
> F2P = 4.2

the app can immediately flag the simulator parse as internally inconsistent instead of coaching from bad data.

The same screenshot yields a derived smash factor of approximately **1.159** from 101.4 mph ball speed divided by 87.5 mph club speed. However, it would be wrong to grade that value as good or bad without knowing the club. Launch, ball speed, spin, carry and efficiency targets are substantially club and delivery dependent. Attack-angle guidance is likewise club and player dependent. TrackMan specifically notes that shots hit from the ground generally use a negative attack angle, while driver optimization depends on speed, loft and fitting. citeturn10view3

Most importantly, the screenshot shows exactly why multimodal reasoning matters:

**Face = +9.5°**  
**Path = −4.7°**  
**Face to Path = +14.2°**

That is a very large separation between where the club is traveling and where the face points. Under centered-contact assumptions, face-to-path is a major determinant of expected curvature/spin axis. citeturn10view1

But SwingSage should still ask for **spin axis and impact location** before declaring the complete mechanism. Off-center strike can materially change the relationship between delivery and resulting ball flight, so impact location deserves its own independent input rather than being guessed from pose. citeturn12search4

## The new combined reasoning layer

This is the part I consider most important for taking the app past superficial swing analysis.

The new `.md` contains **37 explicit combination rules**. Rather than saying:

> "Your hands are outside Pro 1's."

the system can reason:

> **Observed:** downswing trace is above/outside the backswing trace.  
> **Observed:** simulator club path is substantially left of target.  
> **Observed:** face is open relative to that path.  
> **Observed:** spin axis/curvature agrees.  
> **Conclusion:** high-confidence out-to-in/open-to-path curvature mechanism.  
> **Likely area to work on:** delivery path and transition, not simply face alignment.

TrackMan defines club path as the horizontal direction of the clubhead's geometric center at maximum compression and explicitly notes that excessively positive or negative path can require face compensation. It also emphasizes that the ideal path depends on the intended shot shape. citeturn10view2

Some of the other combinations added are:

### Pelvis-space diagnosis

**Butt line lost + handle raises + dynamic lie changes + heel-side strike**

becomes a much stronger early-extension / lost-space hypothesis than:

**Butt moved 3 cm**

by itself.

Conversely:

**Butt line lost + club delivery remains excellent + strike remains centered**

should substantially lower the priority of correcting the visible body movement.

### Compression diagnosis

For an iron, the app can combine:

**negative attack angle + target-side low point + hands ahead + face-on shaft lean + appropriate dynamic loft**

before saying that the golfer is producing a strong forward-low-point/compressed delivery.

That is deliberately more rigorous than the current tendency to equate forward shaft appearance with compression. Attack angle directly measures the clubhead's vertical movement at maximum compression. citeturn10view3 Dynamic loft and spin loft add additional information about the delivered face/club relationship. citeturn10view4turn10view5

### Early-release diagnosis

**Wrist-to-shaft angle opens early + release velocity peaks early + delivered dynamic loft rises + ball-speed efficiency falls**

supports an early-release/casting explanation.

But:

**trail elbow is not tucked**

alone does not.

### Compensation detection

Suppose the golfer has:

**path = 7° left**  
**face = 1° left**

The resulting face is much closer to target than the path. Rather than saying "face looks good," SwingSage can recognize that the golfer may be using face orientation to compensate for a path that is far from the intended delivery.

That matters because face-to-path, not face-to-target alone, heavily influences expected curvature under centered contact. citeturn10view1

### Functional individual style detection

The opposite is equally important:

**Body differs from Pro 1 + simulator delivery is excellent + strike is centered + session dispersion is low**

should produce:

> **Functional individual pattern. No high-priority mechanical correction indicated.**

That conclusion is directly consistent with skilled-golfer research showing that different body movement strategies can coexist with very low hand/clubhead variability approaching impact. citeturn11search8

### Consistency becomes a separate skill dimension

The document also adds session-level standard deviation/IQR measures for:

face angle, club path, face-to-path, attack angle, strike location, ball speed, carry/offline, and body checkpoint repeatability.

That is important because lower-handicap golfers have been reported to show lower shot-to-shot variability in clubhead speed, efficiency, impact location, attack angle, path and face angle than higher-handicap golfers. citeturn12search1

A player could therefore have:

> **Average Mechanics: 86**  
> **Best Swing: 94**  
> **Repeatability: 57**

which is considerably more informative than treating the best-looking single swing as representative.

## What I would prioritize in the actual app

The first priority is not adding every metric simultaneously. It is preventing the app from being confidently wrong.

The current SwingSage inventory already identifies several serious issues, including the duplicate spine-change score, projection-sensitive trail-elbow measurement, DTL shaft-lean problem and deferred rotation family. fileciteturn0file0

I would implement the revised architecture in this order:

**First:** fix view validity and duplication. True shaft lean becomes face-on only; DTL and face-on sway receive different meanings; the duplicate spine score disappears; repeated manifestations of the same fault are grouped instead of double-counted.

**Second:** ingest simulator data in a normalized vendor schema while retaining the original raw fields. Add automatic integrity checks such as `face angle - club path = face-to-path`. Full Swing's currently documented 16-field set gives you enough data to build a strong initial version of this layer. citeturn11search0

**Third:** build the silhouette butt-line/pelvis-depth model. This is one of the strongest additions available specifically because your software can see more than skeletal joints.

**Fourth:** introduce face-on processing, including ball detection and target-line calibration. Ball position deserves particular attention because research in elite golfers found that changing ball position altered club-face aim, club path and attack angle at impact. citeturn12search2turn12search3

**Fifth:** build full hand and club trajectory comparison, including matched-height downswing-versus-backswing path, OTT index, shallowing index, shaft delivery shift and release timing.

**Sixth:** add the fused evidence engine so every diagnosis records observations, supporting evidence, contradictions, missing information and diagnostic confidence.

**Seventh:** add repeated-swing consistency scoring.

**Eighth:** later add synchronized multi-view 3D reconstruction or IMU support for true pelvis/thorax rotation and sequencing. Validated IMU research makes this a credible future path rather than trying to extract exact axial rotation from a single projected skeleton. citeturn11search13

The central rule built into the new specification is:

> **Measure what the camera or simulator can actually observe, call proxies proxies, compare style to Pro 1 without declaring it universally correct, and increase diagnostic certainty only when independent body, club and ball-flight evidence agree.**

That turns the system from a pose-matching application into a genuine multimodal golf-swing diagnostic framework.

**[Download the complete updated comprehensive `.md`](sandbox:/mnt/data/SwingSage_Comprehensive_Multimodal_Swing_Metrics.md)**
