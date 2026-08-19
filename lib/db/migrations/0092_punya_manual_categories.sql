-- H6 — BRD 7.2's five manual award categories.
--
-- The manual award was a single undifferentiated bucket: punyaAwardSchema
-- accepted {student_id, points, note?} with no feature_key, so festival, seva,
-- helping others, competition and MSV shivir all collapsed into one
-- `manual_award` row distinguished only by free text — and `note` was optional,
-- so web-originated rows showed nothing at all in the audit.
--
-- Each category is its own catalogue row with its own bounds, so "seva is
-- 10-50" is data the API enforces rather than a number in someone's head.
--
-- Distinct keys from the automated ones on purpose: `competition` is awarded by
-- the results-publish path, and folding a hand-granted award into the same key
-- would make it impossible to tell a published result from an admin's
-- discretionary grant. `msv_shivir` is the exception - AT28 already designates
-- it as the MANUAL path for shivir Punya, so it is reused rather than
-- duplicated.
--
-- requires_reason is true for all of them. BRD 7.2 makes it mandatory for three
-- and is silent on the rest; the mobile sheet already demanded a reason for
-- every award, and the honest default for "an adult gave a child points by
-- hand" is that they say why. It is a per-row column, so relaxing one later is
-- a data change, not a deploy.

INSERT INTO "punya_features"
  ("key", "label", "min_points", "max_points", "default_points",
   "is_manual", "requires_reason", "is_active")
SELECT 'manual_festival', 'Festival participation', 0, 50, 15, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'manual_festival'
);--> statement-breakpoint

INSERT INTO "punya_features"
  ("key", "label", "min_points", "max_points", "default_points",
   "is_manual", "requires_reason", "is_active")
SELECT 'manual_seva', 'Seva', 10, 50, 10, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'manual_seva'
);--> statement-breakpoint

INSERT INTO "punya_features"
  ("key", "label", "min_points", "max_points", "default_points",
   "is_manual", "requires_reason", "is_active")
SELECT 'manual_helping', 'Helping others', 10, 30, 10, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'manual_helping'
);--> statement-breakpoint

INSERT INTO "punya_features"
  ("key", "label", "min_points", "max_points", "default_points",
   "is_manual", "requires_reason", "is_active")
SELECT 'manual_competition', 'Competition (manual)', 0, 100, 25, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'manual_competition'
);--> statement-breakpoint

-- AT28's manual shivir path becomes selectable in the same picker.
UPDATE "punya_features"
   SET "is_manual" = true, "requires_reason" = true
 WHERE "key" = 'msv_shivir';
