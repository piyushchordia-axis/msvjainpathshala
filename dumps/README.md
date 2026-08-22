# Local database dumps

**Do not commit `.dump` files** — they contain PII (phones, names, etc.).

## Restore to production / E2E (schema must already exist)

Custom-format data dump from local `jainpathshala` (Docker `jp-postgres`, port 5434).

```powershell
$env:PGPASSWORD = "YOUR_REMOTE_PASSWORD"
pg_restore `
  -h YOUR_HOST -p YOUR_PORT -U YOUR_USER -d YOUR_DATABASE `
  --data-only `
  --disable-triggers `
  --no-owner `
  --no-privileges `
  -v `
  "path\to\jainpathshala_data_YYYY-MM-DD_HHmm.dump"
```

**pgAdmin:** right-click database → **Restore** → select the `.dump` file → enable **Data only**.

If restore fails on `punya_transactions` (circular FK), `--disable-triggers` is required (see above).

Uploaded media (photos, PDFs) are **not** in the dump — only database rows.
