-- Scope-array GIN indexes for SQL-filtered quiz list routes + window btrees.

CREATE INDEX IF NOT EXISTS "idx_quiz_events_state_ids_gin" ON "quiz_events" USING gin ("state_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quiz_events_city_ids_gin" ON "quiz_events" USING gin ("city_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quiz_events_centre_ids_gin" ON "quiz_events" USING gin ("centre_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quiz_events_batch_ids_gin" ON "quiz_events" USING gin ("batch_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quiz_events_window" ON "quiz_events" ("start_at", "end_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_push_quizzes_state_ids_gin" ON "push_quizzes" USING gin ("state_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_quizzes_city_ids_gin" ON "push_quizzes" USING gin ("city_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_quizzes_centre_ids_gin" ON "push_quizzes" USING gin ("centre_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_quizzes_batch_ids_gin" ON "push_quizzes" USING gin ("batch_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_quizzes_expires_at" ON "push_quizzes" ("expires_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_questions_centre_ids_gin" ON "questions" USING gin ("centre_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_questions_batch_ids_gin" ON "questions" USING gin ("batch_ids");
