# SwingSage Product Goals & Feature Requirements

> **Working project name:** SwingSage  
> **Product name:** TBD  
> **Purpose of this document:** Define the product goals, required capabilities, user experiences, constraints, and feature inventory that should be used to create the implementation plan and build roadmap.
>
> **Important:** This document intentionally does **not** prescribe architecture, libraries, camera frameworks, AI models, vendors beyond the explicitly stated product constraints, or implementation solutions. The roadmap should determine how to achieve these requirements while protecting performance, reliability, scalability, and cross-platform compatibility.

---

# 1. Product Goal

Build a production-ready mobile application for **iPhone and Android** that helps golfers record, analyze, understand, and improve their golf swing over time.

The application should combine:

- High-quality golf swing video capture.
- AI-assisted swing analysis.
- Objective and subjective swing scoring.
- Visual swing overlays.
- Personalized coaching feedback.
- Training recommendations.
- Long-term improvement tracking.
- Comparison against previous swings and professional reference swings.
- Optional human coaching relationships.
- Coach-specific collaboration features.
- Multi-device synchronized recording.
- Subscription-based feature and usage access.

The product should be useful both as:

1. A self-guided golf improvement application.
2. A collaboration platform between golfers and coaches.

The application should feel useful after a single recorded swing while becoming more valuable as the golfer builds a history of swings, equipment information, goals, feedback, and coaching data.

---

# 2. Core Product Principles

The following should be treated as non-negotiable product goals.

## 2.1 Mobile-first

The primary product is a native-feeling mobile application for:

- iPhone.
- Android phones.

Tablet support may be considered later unless it naturally works within the application.

## 2.2 Performance over code-sharing purity

A single shared codebase is strongly preferred where practical.

However:

- Camera performance.
- Video quality.
- Frame rate.
- Overlay rendering.
- Video playback.
- Recording reliability.
- Device synchronization.
- Analysis accuracy.

must take priority over maintaining a completely shared implementation.

## 2.3 High-frame-rate capture

The application must support golf swing recording at a **minimum target of 60 FPS** on compatible devices.

The product should:

- Detect available recording capabilities on the device.
- Avoid silently degrading a required capture mode without informing the golfer.
- Clearly communicate when a device or camera cannot meet the requested recording capability.
- Preserve enough video quality and temporal detail for meaningful swing analysis.
- Support higher frame rates in the future where devices permit them.

## 2.4 Analysis must be explainable

The golfer should not receive only a generic score.

Analysis should communicate:

- What was detected.
- Why it matters.
- Whether it is good, neutral, or needs improvement.
- How important it is.
- What should be worked on first.
- What improvement would look like.
- Which drill or exercise may help.
- How the issue has changed over time.

## 2.5 Improvement over time is a core product outcome

SwingSage is not intended to be only a one-time video analyzer.

The product should help answer:

- Am I getting better?
- What has improved?
- What has gotten worse?
- What should I work on next?
- Which problems keep recurring?
- Which changes produced the biggest improvement?
- How does the current swing compare with previous swings?
- How close am I to the swing characteristics I am trying to achieve?

---

# 3. User Types and Roles

A single account may have one or more roles.

## 3.1 Golfer

A golfer can:

- Record swings.
- Upload swing videos.
- Maintain a swing log.
- View analysis.
- Interact with the AI Coach.
- Track improvement.
- Manage equipment.
- Set goals.
- Compare swings.
- Request a coach.
- Receive coach feedback.
- Follow coach-created plans.

## 3.2 Coach

A coach can:

- Have a coach profile.
- Appear in the coach directory when eligible.
- Receive golfer coaching requests.
- Approve or reject coaching requests.
- View assigned golfers.
- Access permitted golfer swings.
- Review analysis.
- Comment on swings.
- Add annotations.
- Send messages.
- Provide personalized tips.
- Create improvement plans.
- Track golfer progress.
- Use future coach-specific functionality not available to normal golfers.

## 3.3 Golfer + Coach

The same user may be both:

- A golfer managing their own swing.
- A coach managing other golfers.

The application should clearly separate personal golfer activity from coaching activity without requiring separate accounts.

## 3.4 Administrator

An administrator can manage product-level content and configuration, including professional reference swings and other administrative settings described later in this document.

---

# 4. Authentication and Account Management

## 4.1 Passwordless authentication

Users should be able to create and access a SwingSage account using passwordless authentication.

Supabase is the required account/authentication platform.

## 4.2 Multi-device account access

A user must be able to remain logged into the same account on multiple phones.

This is required for synchronized multi-phone swing recording.

## 4.3 Account lifecycle

Users should be able to:

- Create an account.
- Sign in.
- Sign out.
- Update profile information.
- Update profile photo.
- Manage subscription status.
- Manage account preferences.
- Delete their account.
- Request deletion of their stored data.
- Understand what data will be removed when an account is deleted.

## 4.4 Role onboarding

During onboarding, users should be able to indicate whether they are:

- A golfer.
- A coach.
- Both.

Users should be able to add or change eligible roles later.

---

# 5. User Profiles

All users should have a profile.

## 5.1 Shared profile information

Profiles may include:

- Name.
- Profile photo.
- Location or general region if the user chooses to provide it.
- Short bio.
- Account role or roles.
- Membership/subscription status where appropriate.
- App preferences.

Sensitive or private information should not automatically be publicly visible.

## 5.2 Golfer profile

A golfer profile may include:

- Height.
- Age.
- Handedness.
- Experience level.
- Handicap or approximate skill level.
- Typical scoring range.
- Swing goals.
- Practice goals.
- Common miss.
- Typical ball flight.
- Injuries, mobility limitations, or physical constraints only if the golfer voluntarily chooses to provide relevant information.
- Preferred coaching style or feedback depth.
- Current areas of focus.

These fields should be available to the AI Coach where relevant to personalization.

## 5.3 Goal customization

Golfers should be able to identify what they want to improve.

Examples include:

- More distance.
- More consistency.
- Better contact.
- Reduce slice.
- Reduce hook.
- Improve driver.
- Improve iron play.
- Improve tempo.
- Improve posture.
- Improve sequencing.
- Improve swing plane.
- Improve a coach-assigned issue.
- General swing improvement.

Goals should influence:

- AI responses.
- Recommendation priority.
- Progress tracking.
- Training plans.
- Which improvements are emphasized.

Goals should be editable over time.

---

# 6. Equipment Profile

Golfers should be able to maintain equipment information so swing analysis can be interpreted with additional context.

## 6.1 Club inventory

A golfer should be able to create individual clubs or club configurations.

Possible information includes:

- Club category.
- Club type.
- Club number or loft.
- Brand.
- Model.
- Shaft brand.
- Shaft model.
- Shaft stiffness/flex.
- Club length if known.
- Loft if known.
- Lie if known.
- Custom notes.

## 6.2 Ball information

The golfer may save:

- Ball brand.
- Ball model.
- Custom ball information.

## 6.3 Equipment linked to swings

A golfer should be able to indicate which club was used for a swing.

The application should preserve this information with the swing so comparisons and improvement tracking can be filtered appropriately.

---

# 7. Swing Record

A **Swing** is a core object in the product.

A swing should represent one golf shot or swing event and may include one or more synchronized video views.

## 7.1 Swing video views

A swing may contain:

- Down-the-line view.
- Face-on/front view.
- Both views.
- Additional views in the future.

A golfer should not be required to provide both views.

## 7.2 Swing information

Each swing may include:

- Date and time.
- Video or videos.
- View type.
- Club used.
- Golfer notes.
- Practice/session information.
- Manually entered launch or simulator data.
- AI analysis.
- Scores.
- Findings.
- Overlays.
- Training recommendations.
- Coach comments.
- Coach annotations.
- Comparison references.
- Processing status.
- Analysis version where appropriate.

## 7.3 Swing naming and organization

The product should make swings easy to find later.

Useful organization capabilities should include:

- Date.
- Club.
- Practice session.
- Score.
- View.
- Favorite/bookmark.
- Tags.
- Analysis status.
- Coach-reviewed status.

---

# 8. Practice Sessions

Golfers should be able to group related swings into a practice session.

A practice session may represent:

- A range session.
- Simulator session.
- Lesson.
- Round warm-up.
- At-home practice session.

Sessions may contain:

- Multiple swings.
- Session notes.
- Clubs used.
- Session goals.
- Coach plan association.
- Summary of improvement during the session.
- Best swing or selected representative swing.

This should improve long-term organization beyond a flat list of individual swings.

---

# 9. In-App Swing Recording

Golfers should be able to record a swing directly inside the application.

## 9.1 Supported recording modes

The golfer should be able to record:

- Down-the-line only.
- Face-on only.
- Both angles using synchronized devices.

## 9.2 Recording experience

The recording flow should be designed around golf rather than behaving like a generic camera application.

The golfer should be able to:

- Position the phone.
- Confirm the selected camera/view.
- Confirm frame-rate capability.
- Start recording.
- Stop recording.
- Review the recorded swing.
- Retake it.
- Save it as a swing.
- Assign the club.
- Add optional metadata.

## 9.3 Hands-free recording

The product should support a workflow where the golfer does not need to touch the phone immediately before the swing.

This can include product capabilities such as:

- Delayed recording.
- Automatic swing detection.
- Remote capture controls where supported.
- External shutter or remote-trigger support where appropriate.

The implementation method should be determined during planning.

## 9.4 Long recording support

A golfer may start recording before they are ready and may:

- Walk into frame.
- Place the ball.
- Take practice swings.
- Address the ball for several seconds.
- Walk away afterward.

The application should still be able to identify the actual golf swing inside a longer recording.

---

# 10. Uploading Existing Swing Videos

Golfers should be able to create a swing using prerecorded videos from their phone.

## 10.1 Single-angle upload

The golfer can upload:

- One down-the-line video.
- One face-on video.

## 10.2 Dual-angle upload

The golfer can upload two prerecorded videos and associate them with the same swing.

The product should allow the golfer to identify which video is:

- Face-on.
- Down-the-line.

## 10.3 Video validation

The app should detect and communicate when an uploaded video may not be suitable for analysis because of issues such as:

- Golfer not visible.
- Swing not detected.
- Severe camera movement.
- Poor framing.
- Very low frame rate.
- Video too short.
- Video too long.
- Unsupported file.
- Multiple golfers creating ambiguity.
- Multiple swings where the intended swing cannot be confidently determined.

The product should guide the user toward correcting the problem rather than failing without explanation.

---

# 11. Automatic Swing Detection

The app should automatically identify the actual golf swing within a longer recording.

The product should be able to distinguish the target swing from non-swing portions such as:

- Walking into frame.
- Setup.
- Practice movement.
- Waiting.
- Ball placement.
- Post-shot movement.
- Walking away.

The detected segment should become the useful analysis/playback portion of the swing while preserving the original recording where appropriate.

If multiple possible swings are detected, the golfer should be able to select the correct one.

---

# 12. Multi-Phone Synchronized Recording

One of the major differentiating features is the ability to use two phones to capture the same swing from two angles.

## 12.1 Account synchronization

The same golfer can be logged into SwingSage on both phones at the same time.

## 12.2 Device pairing for a swing

The golfer should be able to identify:

- Phone A as one view.
- Phone B as the other view.

Common configuration:

- Face-on.
- Down-the-line.

## 12.3 Coordinated recording

Starting the capture workflow should allow both devices to record the same swing event.

The experience should minimize the need for the golfer to interact separately with both phones.

## 12.4 Swing association

The resulting videos should automatically be associated with the same Swing record rather than appearing as unrelated recordings.

## 12.5 Synchronized playback

Dual-angle videos should be synchronized closely enough that the golfer can:

- Scrub both views together.
- Pause both at approximately the same swing position.
- Compare body and club positions across views.
- View overlays in the context of the same swing event.

## 12.6 Partial capture recovery

If one phone fails, disconnects, runs out of storage, stops recording, or otherwise does not produce a usable video:

- The successful video should not be lost.
- The golfer should be informed what happened.
- The swing should still be usable as a single-angle swing when possible.

---

# 13. Swing Video Player

The video player is a core analysis surface.

It should support golfer-focused review capabilities such as:

- Play.
- Pause.
- Scrubbing.
- Slow playback.
- Frame-by-frame review.
- Easy movement to important swing positions.
- Full-screen playback.
- Switching between available views.
- Synchronized playback of two views.
- Overlays.
- Annotation display.
- Comparison mode.

The product should remain responsive while displaying overlays and video.

---

# 14. Swing Overlays

Swing videos will support visual overlays.

Existing or planned overlay types include:

- Club-head tracing.
- Body movement / stick-figure tracking.
- Silhouette.
- Other swing geometry or movement overlays.

## 14.1 Overlay behavior

Overlays should:

- Track the correct frame.
- Stay aligned with the golfer/video.
- Remain useful during playback and scrubbing.
- Work in supported comparison views.
- Be individually enabled or disabled where appropriate.
- Respect subscription entitlements.

## 14.2 Future overlay categories

The product should be capable of adding future overlays such as:

- Body angles.
- Swing plane.
- Head movement.
- Hip movement.
- Shoulder movement.
- Spine angle.
- Club path.
- Hand path.
- Alignment references.
- Position checkpoints.
- Before/after comparison overlays.

These are feature categories, not a commitment that every overlay must exist in the first release.

---

# 15. Swing Analysis

Each analyzed swing should produce structured feedback.

## 15.1 Overall analysis

The golfer should receive:

- Overall swing score.
- Category scores.
- Key findings.
- Positive findings.
- Areas for improvement.
- Priority order.
- Recommended next focus.
- Relevant drills.
- Historical context where available.

## 15.2 Internal scoring criteria

SwingSage will maintain internal scoring criteria that define what should be evaluated.

The scoring system may consider:

- Setup.
- Posture.
- Alignment.
- Backswing.
- Transition.
- Downswing.
- Impact.
- Follow-through.
- Sequencing.
- Body movement.
- Club movement.
- Tempo.
- Consistency.
- Other defined swing mechanics.

The exact scoring framework can evolve without changing the fundamental Swing record.

## 15.3 Confidence and uncertainty

Analysis should avoid presenting uncertain findings as absolute facts.

Where relevant, the product should distinguish:

- High-confidence findings.
- Lower-confidence findings.
- Insufficient video/data.
- Metrics that cannot be evaluated from the available angle.

---

# 16. Priority Coaching System

The AI Coach should not simply list every detected issue.

It should prioritize what the golfer should work on first.

## 16.1 Priority factors

Priority should be informed by factors such as:

- Importance to overall swing quality.
- Impact on ball striking or performance.
- Whether the issue causes downstream problems.
- Dependencies between swing mechanics.
- Order of operations.
- Severity.
- Confidence of the finding.
- Difficulty of correcting it.
- Golfer goals.
- Current coach plan.
- Repeated occurrence across swings.
- Whether a prerequisite should be fixed first.
- Potential improvement value.

Example:

If setup or posture is creating downstream swing problems, the golfer may be directed to correct setup before being told to focus on a later swing position.

## 16.2 Focus limits

The AI Coach should avoid overwhelming golfers with too many simultaneous corrections.

The product should emphasize a manageable number of high-priority focus areas.

---

# 17. AI Coach

Golfers should have access to an AI Coach that can discuss their swing.

## 17.1 Swing-aware conversations

The golfer should be able to ask questions such as:

- What is wrong with this swing?
- Why did I slice this shot?
- What should I work on first?
- Did my posture improve?
- Compare this with my previous swing.
- What changed since last week?
- Why is this finding important?
- What drill should I do?
- Is this issue happening with every club?
- How does this compare with the professional reference?

## 17.2 Personalized context

Where appropriate, AI responses should use available context including:

- Current swing.
- Previous swings.
- Golfer goals.
- Golfer profile.
- Handedness.
- Height.
- Experience.
- Equipment.
- Club used.
- Simulator/launch data.
- Existing coach plan.
- Coach comments.
- Prior findings.
- Improvement trends.

## 17.3 Conversation scope

AI interactions may be associated with:

- A specific swing.
- A practice session.
- A golfer's overall improvement history.
- A coach-created plan.

## 17.4 AI response quality

Responses should be:

- Specific to the golfer.
- Grounded in available analysis/data.
- Actionable.
- Easy to understand.
- Able to explain technical concepts when requested.
- Consistent with the current priority plan.

---

# 18. Training Drills and Exercises

SwingSage should recommend training exercises based on detected findings.

The drill library is intended to be **preconfigured**, rather than requiring the AI to invent a new drill each time.

Each drill may include:

- Name.
- Purpose.
- What issue it addresses.
- Instructions.
- Difficulty.
- Required equipment.
- Repetitions/time guidance.
- Relevant swing phase.
- Common mistakes.
- Optional media.
- Related findings.

Analysis findings should map to appropriate drills.

The AI Coach may explain or contextualize a drill, but the underlying drill should come from the managed drill library.

---

# 19. Swing Comparison

Golfers should be able to compare swings.

## 19.1 Compare against personal swings

The golfer should be able to compare the current swing with:

- Previous swing.
- Most recent swing with the same club.
- A manually selected swing.
- Best/favorite swing.
- A swing from another date or session.

## 19.2 Compare against professional swings

The golfer should be able to compare against administrator-managed professional reference swings.

## 19.3 Comparison capabilities

Comparison should support useful review capabilities such as:

- Side-by-side video.
- Synchronized playback.
- Slow motion.
- Frame-by-frame review.
- Matching important swing positions.
- Score comparison.
- Finding comparison.
- Overlay comparison.
- Visible changes between swings.

## 19.4 Comparison context

When comparing swings, the product should make important differences clear rather than requiring the golfer to interpret two videos without guidance.

---

# 20. Professional Reference Swing Library

Administrators should be able to maintain professional/reference swings.

## 20.1 Professional profile

Reference content may include:

- Golfer/pro name.
- Profile information.
- Handedness.
- Swing type.
- Club used.
- View type.
- Relevant tags.
- Reference notes.

## 20.2 Reference videos

The administrator should be able to upload and manage:

- Face-on reference swings.
- Down-the-line reference swings.
- Multiple clubs.
- Multiple swings per professional.
- Different reference categories.

## 20.3 Availability

The administrator should be able to control which professional swings are:

- Active.
- Hidden.
- Featured.
- Available to specific subscription tiers.

---

# 21. Swing Log and History

Each golfer should have a personal swing log.

## 21.1 Log capabilities

The golfer should be able to:

- Browse swings.
- Search/filter swings.
- View recent swings.
- View swings by club.
- View swings by session.
- View favorites.
- View coach-reviewed swings.
- View score changes.
- Open a swing for full analysis.
- Delete eligible swings.
- Compare swings.

## 21.2 Historical improvement

The product should show improvement over time for:

- Overall score.
- Category scores.
- Important findings.
- Repeated issues.
- Resolved issues.
- Club-specific performance.
- Coach-plan progress.
- User goals.

## 21.3 Trends

The golfer should be able to understand:

- Whether a metric is improving.
- Whether it is stable.
- Whether it is getting worse.
- Whether recent results are unusually different.
- Whether improvement is consistent across multiple swings.

---

# 22. Manually Entered Swing and Launch Data

Golfers may optionally attach additional performance data to a swing.

This is an advanced feature.

Possible metrics include:

- Club-head speed.
- Ball speed.
- Carry distance.
- Total distance.
- Attack angle.
- Launch angle.
- Spin rate.
- Spin axis.
- Club path.
- Face angle.
- Face-to-path.
- Smash factor.
- Apex/peak height.
- Dynamic loft.
- Low point.
- Descent angle.
- Other simulator or launch-monitor metrics.

## 22.1 Manual entry

Golfers should be able to manually enter available values.

Not every metric is required.

## 22.2 Context

The application should preserve which data belongs to which swing.

## 22.3 Future extensibility

The feature should leave room for future import/integration with launch monitors or simulator platforms without making those integrations a requirement for the initial product.

---

# 23. Coach Directory

Golfers should be able to browse a directory of participating coaches.

## 23.1 Coach listing

A coach listing may include:

- Profile photo.
- Name.
- Location/region.
- Bio.
- Coaching specialties.
- Experience.
- Credentials or certifications if supplied.
- Remote/in-person availability.
- Skill levels served.
- Coaching style.
- Pricing information if this becomes part of the product.
- Rating/testimonials if added in the future.
- Verified status if the product introduces coach verification.

## 23.2 Coach discovery

Golfers should be able to:

- Browse coaches.
- Search/filter coaches.
- View coach profiles.
- Request coaching access.

---

# 24. Golfer-Coach Relationship

Coach access to golfer information should be based on an explicit relationship.

## 24.1 Request flow

A golfer can request a coach.

A coach can:

- Approve.
- Decline.

## 24.2 Relationship control

The golfer should remain in control of the relationship and be able to end coach access.

A coach should also be able to end the relationship.

## 24.3 Access boundaries

A coach should only be able to access golfer information allowed by the product and relationship.

Ending the relationship should remove ongoing coach access while preserving appropriate historical records where required.

## 24.4 Relationship status

Possible states include:

- No relationship.
- Requested.
- Approved/active.
- Declined.
- Ended.

---

# 25. Coach Workspace

Coaches should have a dedicated area for managing golfers.

## 25.1 Golfer roster

Coaches should be able to see:

- Assigned golfers.
- Pending requests.
- Recent golfer activity.
- Swings needing review.
- Active plans.
- Unread messages.

## 25.2 Golfer detail

For an assigned golfer, a coach should be able to access relevant information such as:

- Profile.
- Goals.
- Equipment.
- Swing log.
- Swing analysis.
- Progress history.
- Current plan.
- Messages.
- Coach notes.

## 25.3 Swing review

A coach should be able to:

- Watch golfer swings.
- Use slow motion/frame review.
- View overlays.
- View AI findings.
- Add comments.
- Add annotations.
- Provide personalized tips.
- Mark a swing as reviewed.

---

# 26. Coach Comments and Annotations

## 26.1 Comments

Coaches should be able to leave feedback associated with:

- A swing.
- A finding.
- A training plan.
- A practice session.

## 26.2 Video annotations

Coaches should be able to annotate a swing.

Annotations may include:

- Drawing.
- Lines.
- Angles.
- Circles.
- Arrows.
- Text.
- Frame-specific notes.
- Position-specific notes.

Annotations should remain associated with the intended frame or section of the video.

## 26.3 Golfer visibility

Golfers should be able to clearly distinguish:

- AI-generated findings.
- Coach comments.
- Coach annotations.
- Their own notes.

---

# 27. Two-Way Messaging

Golfers and their approved coach should be able to communicate inside SwingSage.

Messaging may support:

- Text messages.
- Swing references.
- Plan references.
- Drill references.
- Coach feedback notifications.
- Future attachments where useful.

The experience should keep coaching conversations connected to the golfer's improvement history.

---

# 28. Coach-Created Improvement Plans

Coaches should be able to create custom plans for golfers.

## 28.1 Plan contents

A plan may contain:

- Title.
- Goal.
- Description.
- Priority focus areas.
- Assigned drills.
- Practice instructions.
- Target frequency.
- Expected duration.
- Milestones.
- Coach notes.
- Completion/progress state.

## 28.2 Plan relationship to AI

The AI Coach should be aware of an active human-coach plan.

It should avoid contradicting the plan without clearly explaining why another issue may require attention.

Human coach guidance should be clearly distinguishable from AI guidance.

---

# 29. Notifications

The application should notify users about important events without becoming noisy.

Potential notification events include:

### Golfer

- Swing analysis completed.
- Coach approved request.
- Coach declined request.
- Coach reviewed a swing.
- New coach comment.
- New coach annotation.
- New coach message.
- New or updated coach plan.
- Subscription or usage-limit event where appropriate.

### Coach

- New golfer request.
- New golfer swing available.
- Golfer replied to a message.
- Golfer completed or progressed through an assigned plan.
- Swing specifically submitted/requested for review.

Notification preferences should be user-manageable where appropriate.

---

# 30. Subscription Tiers

SwingSage will have multiple subscription tiers.

Required tiers:

- Free.
- Pro.
- Coach Standard.
- Coach Pro.

Stripe is the requested billing platform.

The build roadmap must ensure subscription behavior is compatible with the distribution requirements of the iPhone and Android applications.

## 30.1 Entitlement system

Features and usage should be controlled by subscription entitlement rather than being hard-coded into isolated screens.

Potential entitlement dimensions include:

- Number of swings analyzed.
- Number of swings uploaded.
- Number of swings retained in the log.
- Video storage duration.
- Analysis depth.
- Number of AI questions/messages.
- AI feature availability.
- Overlay availability.
- Comparison availability.
- Professional comparison availability.
- Dual-phone recording.
- Advanced historical analysis.
- Advanced simulator data.
- Coach relationships.
- Number of golfers a coach can manage.
- Coach messaging.
- Coach annotations.
- Coach plans.
- Storage limits.
- Export/share functionality.
- Future premium capabilities.

Exact tier limits should remain configurable.

## 30.2 Upgrade experience

When a user reaches a limit or attempts to use a locked feature:

- The application should clearly explain the limit.
- The application should show which plan unlocks it.
- Existing user data should not unexpectedly disappear without warning.
- The user should be able to understand what changes when upgrading or downgrading.

## 30.3 Subscription lifecycle

The product should account for:

- New subscription.
- Upgrade.
- Downgrade.
- Cancellation.
- Expired subscription.
- Failed payment.
- Restored entitlement.
- Promotional/free access.
- Administrator-granted access where needed.

---

# 31. Administrative Area

An administrator should have access to product administration capabilities.

## 31.1 Professional swing management

Administrator can:

- Create professional profiles.
- Upload professional swings.
- Edit professional metadata.
- Activate/deactivate reference swings.
- Organize professional swings.
- Configure which plans can access them.

## 31.2 Drill library management

Administrator should be able to manage:

- Drills.
- Drill instructions.
- Drill media.
- Drill-to-finding relationships.
- Active/inactive drills.

## 31.3 Swing scoring configuration

Administrative configuration should support management of product-defined swing evaluation content such as:

- Scoring categories.
- Findings.
- Importance.
- Priority relationships.
- Dependencies.
- Recommendation mappings.
- Drill mappings.
- Explanatory content.

The roadmap should determine which of these require an administrator interface versus managed configuration, but they should not require redesigning the product whenever scoring logic evolves.

## 31.4 Subscription and feature configuration

Administrator should be able to manage or inspect:

- Tier entitlements.
- Usage limits.
- Feature availability.
- Promotional access where supported.

## 31.5 Coach administration

Administrative capabilities may include:

- Coach listing approval.
- Coach visibility.
- Verified status.
- Coach suspension.
- Directory moderation.

---

# 32. Analysis Processing Experience

Video analysis may not always be instantaneous.

The application should have clear states such as:

- Uploading.
- Waiting for analysis.
- Processing.
- Analysis complete.
- Analysis failed.
- Needs user action.
- Unsupported/insufficient video.

Users should be able to leave the processing screen and return later without losing the swing.

The application should avoid making the user repeat a successful upload because analysis is still in progress.

---

# 33. Failure Handling and Recovery

The product should account for real-world failure scenarios.

Examples include:

- Internet connection lost during upload.
- Upload interrupted.
- Analysis fails.
- Device storage is insufficient.
- Recording permission denied.
- Camera unavailable.
- Microphone unavailable if audio is used.
- One synchronized phone disconnects.
- User closes the app.
- User receives a phone call or system interruption.
- Video cannot be decoded.
- Swing cannot be detected.
- Overlay generation fails.
- Subscription status cannot be confirmed temporarily.

The goal is to preserve the golfer's recording or work whenever possible and clearly communicate what action is needed.

---

# 34. Privacy, Permissions, and Data Control

Swing videos and coaching data are personal user content.

The product should provide clear control over this content.

## 34.1 User control

Users should be able to understand:

- Who can view their swings.
- Whether a coach can access them.
- What information appears publicly in the coach directory.
- How long content is stored.
- How subscription retention limits affect content.
- How to delete content.
- How to delete their account.

## 34.2 Coach access

Coach access must be limited to authorized golfer relationships.

## 34.3 Administrative access

Administrative access to user content should be restricted to appropriate product/support purposes.

## 34.4 Public sharing

Swing videos should not become publicly accessible unless the golfer intentionally uses a future sharing feature that clearly indicates the visibility.

---

# 35. Sharing and Export

A golfer may eventually need to share a swing outside of the direct coach relationship.

Useful product capabilities may include:

- Share a swing with controlled access.
- Export/download an eligible swing.
- Export a swing with selected overlays.
- Share a progress comparison.
- Share a coach-reviewed swing.

These capabilities may be tier-restricted and do not need to be part of the first release unless prioritized by the roadmap.

---

# 36. Search, Filtering, and Organization

As users accumulate data, the application should remain usable.

Potential filtering should include:

- Date.
- Club.
- Session.
- View.
- Score.
- Finding.
- Goal.
- Coach-reviewed status.
- Favorite.
- Professional comparison.
- Analysis status.

Coaches should have equivalent organization tools for larger golfer rosters.

---

# 37. Product Analytics and Quality Measurement

The product should be able to measure whether golfers are successfully using core features.

Important product events may include:

- Account created.
- Onboarding completed.
- Swing recorded.
- Swing uploaded.
- Swing successfully analyzed.
- Swing analysis failed.
- Overlay viewed.
- Comparison started.
- AI Coach used.
- Drill opened.
- Goal created.
- Coach requested.
- Coach relationship approved.
- Coach reviewed swing.
- Plan created.
- Subscription started.
- Upgrade completed.
- User reached usage limit.
- User returned for another practice session.

The roadmap should include the ability to measure reliability and feature adoption without compromising user privacy.

---

# 38. Production Readiness and Scale Goals

The application should be designed as a real production product rather than a prototype.

It should be capable of supporting many concurrent users performing activities such as:

- Recording.
- Uploading large videos.
- Processing swings.
- Viewing analysis.
- Rendering overlays.
- Chatting with AI.
- Messaging coaches.
- Reviewing swing history.

Key product expectations include:

- Responsive mobile experience.
- Reliable recording.
- Reliable uploads.
- Clear processing state.
- Graceful recovery from failures.
- Scalable analysis workload.
- Efficient repeated access to completed analysis.
- No unnecessary reprocessing of the same completed swing.
- Appropriate storage lifecycle based on subscription.
- Protection against one user's workload degrading the experience for everyone else.
- Operational visibility into errors and failed analysis.
- Safe configuration and secrets handling.

---

# 39. Required / Preferred Technology Constraints

These are the technologies explicitly requested by the product owner.

Required or preferred components:

- Supabase.
- Upstash.
- Railway.
- Infisical.
- Stripe.
- Azure preferred over GCP or AWS for additional cloud needs.

All other technical decisions should be evaluated in the build roadmap based on the product requirements in this document.

The technical plan should not preserve a preferred technology at the expense of a non-negotiable product capability such as:

- 60 FPS capture.
- Reliable camera access.
- Accurate overlays.
- Synchronized multi-device recording.
- Video performance.
- Production reliability.

---

# 40. Platform and Device Compatibility Goals

The roadmap should define supported devices and compatibility expectations.

The product should account for differences across phones including:

- Available cameras.
- Supported frame rates.
- Video resolution.
- Device performance.
- Available storage.
- Operating system version.
- Camera permission behavior.
- Background/interruption behavior.

The user should receive a clear compatibility message when a requested feature cannot be performed on a specific device.

---

# 41. Accessibility and General Usability

The app should remain usable in real golf environments.

Considerations include:

- Bright outdoor conditions.
- One-handed interaction.
- Large, obvious capture controls.
- Easy reading during range sessions.
- Clear state changes.
- Minimal setup before recording.
- Avoiding excessive steps between swings.
- Accessible text sizing and interaction targets.
- Clear error messaging.
- Sensible handling of portrait and landscape video where supported.

---

# 42. Suggested Product Phases for Roadmap Planning

This section does **not** prescribe implementation. It groups the feature set so the AI coder can create a practical roadmap.

## Foundation

- Authentication.
- Profiles.
- Roles.
- Basic golfer profile.
- Basic coach profile.
- Subscription entitlement foundation.
- Admin access.
- Swing data model/product behavior.
- Product analytics foundation.
- Error and processing states.

## Core Golfer Experience

- In-app recording.
- Prerecorded video upload.
- Single-angle swing creation.
- Automatic swing detection.
- Swing log.
- Video player.
- Initial overlays.
- Swing analysis.
- Scores/findings.
- Priority coaching.
- Drill recommendations.
- AI Coach.

## Improvement Tracking

- Practice sessions.
- Historical trends.
- Goal tracking.
- Equipment profiles.
- Swing comparison.
- Professional reference library.
- Advanced filters/search.

## Dual-Device Capture

- Multi-device account use.
- Device pairing.
- Coordinated recording.
- Dual-angle swing association.
- Synchronized playback.
- Failure recovery.

## Coach Platform

- Coach directory.
- Golfer requests.
- Coach roster.
- Swing review.
- Comments.
- Annotations.
- Messaging.
- Coach-created plans.
- Coach notifications.

## Advanced Data

- Manual simulator metrics.
- More advanced trend analysis.
- More overlays.
- More detailed comparison.
- Future simulator/launch-monitor integrations.

## Production Expansion

- Larger-scale concurrency.
- Storage/retention controls.
- Expanded administration.
- Moderation.
- Sharing/export.
- More granular subscriptions.
- Operational reliability improvements.
- Broader device support.

The roadmap may reorganize these phases if dependencies make another sequence more appropriate.

---

# 43. Product Decisions the Roadmap Should Explicitly Resolve

The following items should not be silently assumed. The build roadmap should make a recommendation or mark them as explicit product decisions.

## Accounts and profiles

- Minimum supported age.
- Whether age should be exact or stored as an age range/birth year.
- Which golfer profile fields are required versus optional.
- Whether public golfer profiles ever exist.
- Whether coach profiles require approval before directory publication.

## Coach relationships

- Whether a golfer can have one active coach or multiple active coaches.
- Whether a coach can invite a golfer or only golfers can initiate requests.
- Whether coach access covers all historical swings or only selected swings.
- Whether golfers can submit specific swings for review.
- Whether coach roster size is determined by subscription tier.

## Swing capture

- Default recording duration/workflow.
- Whether audio is recorded.
- Whether higher-than-60-FPS capture is exposed when supported.
- Whether external remote/shutter controls are an initial-release requirement or later enhancement.
- How users identify face-on versus down-the-line during capture.
- Whether a third camera angle is intentionally supported in the future.

## Swing data

- Which swing fields are required.
- Whether practice sessions are automatically created or manually created.
- Whether a swing can be moved between sessions.
- Whether raw recordings are retained in addition to trimmed analysis clips.
- How long each subscription tier retains video and analysis.

## Analysis

- Initial scoring categories.
- Score scale.
- How confidence is represented.
- How many priority findings should be shown at once.
- How analysis changes are handled when the internal scoring model evolves.
- Whether old swings can be reanalyzed using newer scoring criteria.
- What constitutes a "best swing."

## AI Coach

- AI usage limits by tier.
- Whether conversations persist indefinitely.
- Whether AI can reference all historical swings or only selected history.
- How AI guidance and human coach guidance should interact when they disagree.

## Professional comparisons

- Which professional swings are available initially.
- Whether professional reference access varies by tier.
- Whether comparisons can be filtered by handedness, club, swing style, or other attributes.

## Coach platform

- Whether coaches set their own pricing inside SwingSage.
- Whether SwingSage will eventually facilitate coach payments.
- Whether coach ratings/reviews will exist.
- Whether coaches need identity or credential verification.
- Whether messaging is available only during an active coach relationship.

## Subscriptions

- Exact limits for Free.
- Exact limits for Pro.
- Exact limits for Coach Standard.
- Exact limits for Coach Pro.
- Downgrade behavior when stored swings exceed a new plan's limit.
- Grace periods before retention-based deletion.
- Whether users can purchase temporary add-ons.
- Whether administrator-granted complimentary access is needed.

## Sharing

- Whether golfers can create external share links.
- Whether shared swings can include overlays and comments.
- Whether public/social sharing is in scope.

## Notifications

- Push notification requirements.
- Email notification requirements.
- Which events should notify immediately versus be grouped.

---

# 44. Explicitly Out of Scope for This Requirements Document

The build roadmap may solve these problems, but this requirements document should not dictate them.

Do not treat this document as prescribing:

- React Native versus another mobile framework.
- Native camera frameworks.
- Video codec.
- Video transport method.
- Device-to-device communication method.
- Synchronization protocol.
- AI model/provider.
- Computer-vision model.
- Pose-estimation technology.
- Club-tracking technology.
- Queue implementation.
- Cache implementation.
- Database schema.
- API design.
- Infrastructure topology.
- Container strategy.
- Background-job architecture.
- CDN choice.
- File-storage provider.
- Monitoring vendor.
- CI/CD implementation.
- Exact Azure services.

Those should be decided by the technical roadmap based on the requirements above.

---

# 45. Definition of Product Success

SwingSage should ultimately allow a golfer to:

1. Create an account quickly.
2. Set basic golf goals and profile information.
3. Record or upload a swing without leaving the app.
4. Capture at least 60 FPS on supported devices.
5. Create a swing from one or two camera angles.
6. Automatically isolate the meaningful golf swing from extra recording time.
7. Receive useful visual overlays.
8. Receive structured swing scores and findings.
9. Understand what to work on first and why.
10. Receive an appropriate drill.
11. Ask the AI Coach follow-up questions.
12. Save the swing into a personal history.
13. Compare it with previous swings.
14. Track improvement over time.
15. Add equipment and optional simulator data for additional context.
16. Optionally connect with a human coach.
17. Receive coach comments, annotations, messages, and plans.
18. Use two logged-in phones to capture synchronized face-on and down-the-line views.
19. Upgrade subscription access as their needs grow.
20. Trust that their videos, analysis, profile, subscription, and coaching relationships work reliably in a production application.

The final build roadmap should translate this feature set into a staged plan with clear dependencies, milestones, acceptance criteria, testing requirements, and documentation requirements without reducing the core performance and usability goals.
