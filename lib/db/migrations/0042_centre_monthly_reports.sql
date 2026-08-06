-- Centre monthly aggregate PDF reports (Sanchalak / admin export).
CREATE TABLE IF NOT EXISTS centre_monthly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id uuid NOT NULL REFERENCES centres(id) ON DELETE CASCADE,
  month varchar(7) NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  pdf_url text,
  error_message text,
  snapshot jsonb,
  generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centre_monthly_reports_month_chk CHECK (month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT centre_monthly_reports_status_chk CHECK (
    status IN ('queued', 'generating', 'ready', 'failed')
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_centre_monthly_reports_centre_month
  ON centre_monthly_reports (centre_id, month DESC, created_at DESC);--> statement-breakpoint
