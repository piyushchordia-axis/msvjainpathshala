-- Section 17 v3 section 17.1.2 — the Granth section type.
--
-- Separate file: ALTER TYPE ... ADD VALUE is kept away from the DDL in 0073 so a
-- retry of 0073 never re-runs it (matches 0015 / 0045 / 0072).
--
-- The client renders the two-tab Granth screen (Online Granth + the physical
-- library directory) off this value, never off the section name.

ALTER TYPE "library_section_type_enum" ADD VALUE IF NOT EXISTS 'granth';
