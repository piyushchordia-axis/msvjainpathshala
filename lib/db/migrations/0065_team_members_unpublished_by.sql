-- Admin-explicit Team card unpublish survives user reactivation.
ALTER TABLE "team_members"
  ADD COLUMN IF NOT EXISTS "unpublished_by" uuid
  REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
