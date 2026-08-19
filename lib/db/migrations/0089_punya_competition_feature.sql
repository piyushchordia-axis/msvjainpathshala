-- Catalogue integrity: `competition` is awarded at runtime
-- (routes/v1/competitions.ts -> lib/competition-punya.ts) but was registered in
-- no catalogue at all. Every competition ledger row joined to no feature, so it
-- carried a raw key on the parent's ledger and dropped out of any
-- catalogue-joined analytics.
--
-- No punya_configs row on purpose: unlike attendance or quizzes, the amounts
-- come from competitions.winner_points / participant_points on the competition
-- itself, so a global default would be a value nothing reads. The feature row
-- exists to give the key a label and bounds.
INSERT INTO "punya_features" ("key", "label", "min_points", "max_points", "is_active")
SELECT 'competition', 'Competition result', 0, 100000, true
WHERE NOT EXISTS (
  SELECT 1 FROM "punya_features" WHERE "key" = 'competition'
);
