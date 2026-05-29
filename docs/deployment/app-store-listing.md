# Apple App Store listing — Jain Pathshala

## App identity

| Field                | Value                        |
| -------------------- | ---------------------------- |
| App name             | Jain Pathshala               |
| Bundle ID            | `org.jainpathshala.app`      |
| Subtitle (30 chars)  | Daily Jain learning for kids |
| Category — Primary   | Education                    |
| Category — Secondary | Lifestyle                    |
| Pricing              | Free                         |
| Age rating           | 4+ (parent-mediated)         |

## Promotional text (170 chars)

> The official app for the MSV Jain Pathshala network — attendance, Niyams, Punya, exams, and more for parents, students, and teachers. Bilingual EN/HI.

## Keywords (100 chars total, comma-separated)

```
jain,pathshala,niyam,punya,attendance,parenting,education,hindi,gujarati,msv,homework,quiz,donate
```

## Description (4,000 chars max)

(Use the same prose as the Play Store listing — see `play-store-listing.md`. The
Apple review board generally accepts identical body text.)

## Screenshot specs

Required:

- 6.7" iPhone (15 Pro Max) — 1290×2796, 5 screenshots minimum.
- 5.5" iPhone (legacy) — 1242×2208, can be auto-resized.
- 12.9" iPad Pro — 2048×2732 (optional but recommended).

Files: `apps/mobile/assets/store/apple/<size>-<order>.png`.

## Privacy nutrition labels

| Data collected                      | Linked to user | Tracking |
| ----------------------------------- | -------------- | -------- |
| Phone number                        | Yes            | No       |
| User photos                         | Yes            | No       |
| Identifiers (user_id)               | Yes            | No       |
| Coarse location (shikshak GPS only) | Yes            | No       |
| Purchases (donation amount)         | Yes            | No       |
| Diagnostics (crash logs via Sentry) | No             | No       |

Tracking: **None.** No third-party ad SDK, no analytics that tracks across
apps/sites.

## Review notes (for Apple reviewer)

```
Test account:
  Phone: +91 9999000000
  OTP: any 6-digit code accepts during review (dev provider)

For donation testing:
  - Choose ₹1 amount → use Razorpay test card 4111 1111 1111 1111
  - Expiry: any future date, CVV: any 3 digits
  - The receipt PDF generates within 30 seconds

Children-and-Education exemption: This app is parent-mediated. Children
under 13 cannot create accounts; only parents can register their children.
A 13+ "student view" toggle is available from the parent's account and
shows only that child's data — never another user's. See SPEC.md Q4 for
the underlying business rule.

Religious content: Educational app for the Jain community. No
proselytising; no content rated above 4+.

Support / privacy URLs:
  Support: https://jainpathshala.org/support
  Privacy: https://jainpathshala.org/privacy
```
