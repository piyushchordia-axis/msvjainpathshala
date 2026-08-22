-- SU-1 (Notifications & Notices review, 2026-08) — notices.state_id /
-- city_id / centre_id / batch_id were ON DELETE CASCADE, so deleting a
-- state, city, centre or batch silently hard-deleted every notice that ever
-- targeted it (and cascaded onward through notice_reads), with no audit
-- entry recorded anywhere. Worse for centre_id: batch notices denormalise
-- their batch's centre, so deleting one centre destroyed both centre- and
-- batch-targeted history.
--
-- RESTRICT instead (CU29 pattern): the caller must explicitly reassign or
-- delete the notices first, same posture as 0100/0101's course-tree fix for
-- the identical mistake.
ALTER TABLE notices
  DROP CONSTRAINT notices_state_id_states_id_fk;--> statement-breakpoint
ALTER TABLE notices
  ADD CONSTRAINT notices_state_id_states_id_fk
  FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE notices
  DROP CONSTRAINT notices_city_id_cities_id_fk;--> statement-breakpoint
ALTER TABLE notices
  ADD CONSTRAINT notices_city_id_cities_id_fk
  FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE notices
  DROP CONSTRAINT notices_centre_id_centres_id_fk;--> statement-breakpoint
ALTER TABLE notices
  ADD CONSTRAINT notices_centre_id_centres_id_fk
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE notices
  DROP CONSTRAINT notices_batch_id_batches_id_fk;--> statement-breakpoint
ALTER TABLE notices
  ADD CONSTRAINT notices_batch_id_batches_id_fk
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
