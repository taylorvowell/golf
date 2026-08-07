Capture a future / nice-to-have / "someday" feature idea into the backlog at `docs/icebox/` (or manage it).

Invoke the `icebox` skill. Usage:
- `/future <idea>` — capture an idea. The skill elaborates your (possibly brief) description into a structured
  user-story entry, filling in the blanks (user stories, why it matters, a first-pass sketch, dependencies, open
  questions), writes `docs/icebox/ICE-NNN-*.md`, regenerates the index, and offers to refine.
- `/future list` — show the backlog.
- `/future develop <ICE-NNN>` — start building a backlog item (routes into the build system; scaffolds a track if it's
  a 3+-step epic).
- `/future done <ICE-NNN>` — remove an item once it has shipped.

Disambiguation: if it's unclear whether you want the feature built **now** vs filed for **later**, the skill ASKS
before filing — it never assumes, and never starts building a current feature under the guise of capturing an idea.
