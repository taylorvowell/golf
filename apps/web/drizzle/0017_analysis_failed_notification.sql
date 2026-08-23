-- A swing whose analysis did not finish is now something the golfer is TOLD about (Taylor,
-- 2026-08-22), not something they discover by finding a swing with no score in it.
--
-- The row is the durable half of that: a toast is gone in four seconds and a golfer who starts an
-- upload usually puts the phone down. `analysis_failed` sits beside `analysis_ready` because they
-- are the two ends of the same event — the pipeline finished, one way or the other — and a client
-- that renders one already has the shape for the other.
--
-- Widening a CHECK is additive: every existing row still satisfies it, and no client that has
-- never heard of this kind can receive one it did not ask for.
--
-- Hand-written, like every migration since 0003.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  -- golfer (§29 + D55 + D60 + D62)
  'analysis_ready','analysis_failed','coach_request_approved','coach_request_declined',
  'swing_reviewed','coach_comment','coach_annotation','coach_message',
  'coach_plan','subscription_event','goal_assigned','goal_achieved',
  'goal_regressed','lesson_sent','conversation_reply','review_answered',
  'achievement_earned',
  -- coach
  'golfer_request','golfer_swing','golfer_reply','plan_progress',
  'review_requested','student_message','lesson_viewed','drill_done',
  'student_goal_achieved'));
