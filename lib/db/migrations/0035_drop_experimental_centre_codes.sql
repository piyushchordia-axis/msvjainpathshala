-- Drop prior experimental Pathshala code columns; canonical column is centres.code.
ALTER TABLE centres DROP COLUMN IF EXISTS short_code;
ALTER TABLE centres DROP COLUMN IF EXISTS centre_code;
