-- UAT repair: parent_mobile form field + optional student mobile labels.
-- Safe to re-run.

INSERT INTO join_form_fields (
  kind, field_key, label_hi, label_en, field_type, options,
  placeholder_hi, placeholder_en, is_required, is_active, display_order
)
SELECT
  'student',
  'parent_mobile',
  'अभिभावक मोबाइल',
  'Parent mobile',
  'text',
  NULL,
  '10 अंक',
  '10 digits',
  true,
  true,
  3
WHERE NOT EXISTS (
  SELECT 1 FROM join_form_fields
  WHERE kind = 'student' AND field_key = 'parent_mobile'
);

UPDATE join_form_fields
SET
  label_hi = 'विद्यार्थी मोबाइल (वैकल्पिक)',
  label_en = 'Student mobile (optional)',
  is_required = false,
  display_order = 4,
  placeholder_hi = COALESCE(placeholder_hi, '10 अंक'),
  placeholder_en = COALESCE(placeholder_en, '10 digits'),
  updated_at = NOW()
WHERE kind = 'student' AND field_key = 'mobile';

UPDATE join_form_fields
SET is_required = false, updated_at = NOW()
WHERE kind = 'student' AND field_key IN ('family_members', 'will_attend');
