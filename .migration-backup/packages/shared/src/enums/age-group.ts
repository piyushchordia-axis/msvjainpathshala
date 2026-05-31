/**
 * `age_group_enum` (SPEC §5.1). Locked colours live in `@jp/design-tokens`
 * (colors.age.bal/kishor/tarun/yuva). Display ordering goes youngest → oldest
 * per CLAUDE.md "Design system → Age group colours".
 *
 * Note: concrete age-year ranges are NOT specified in SPEC §5.1; they are
 * per-city configurable via `registration_form_configs` (SPEC §5.4 / Step 6).
 * No ranges are encoded here to avoid baking in wrong values.
 */

export const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];
