-- F3: pointer from a graded homework submission to its Punya award row.
-- ON DELETE SET NULL so ledger cleanup never orphan-blocks submissions.

ALTER TABLE "homework_submissions"
  ADD COLUMN IF NOT EXISTS "punya_transaction_id" uuid
  REFERENCES "punya_transactions"("id") ON DELETE SET NULL;
