# Google Play Store listing — Jain Pathshala

## App identity

| Field                | Value                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| App name             | Jain Pathshala — पाठशाला                                                                              |
| Package name         | `org.jainpathshala.app`                                                                               |
| Default language     | English (en-IN)                                                                                       |
| Additional languages | Hindi (hi-IN), Gujarati (gu-IN)                                                                       |
| Category             | Education                                                                                             |
| Content rating       | Everyone — explicit during the IARC questionnaire that this is a religious-education app for families |
| Pricing              | Free, in-app donations only                                                                           |

## Short description (80 chars max)

> Daily Jain learning for families — attendance, Niyams, Punya, exams, and gallery.

## Full description (4,000 chars max)

```
Jain Pathshala — the official app for the Megh Sanskar Vatika (MSV) network of Jain pathshalas across India.

Built for parents, students, teachers (Guruji / Didi), centre heads (Sanchalak), and city administrators, Jain Pathshala brings the full pathshala experience to your phone — without ever losing the warmth of in-person teaching.

What you can do
• See your child's attendance, Punya progress, and reports — updated in real time
• Submit daily Niyams via photo proof; earn Punya and streak badges
• Get push + SMS alerts for critical notices, holidays, and exams
• Browse the city Gallery (opt-in) and the bilingual library of audio, video, and PDFs
• Take online exams and push quizzes — auto-graded with instant Punya
• View your child's digital ID card; download monthly reports as PDF
• Donate (with 80G certificate where eligible) via UPI / netbanking / cards through Razorpay

Built for India
• Full bilingual EN / HI interface — switch any time
• Devanagari rendering tuned for low-end Android
• Designed for unreliable networks — every submission queues locally and syncs when you come back online
• Privacy-first: only your authorised parent account sees your child's records

Who's this for
• Parents / Abhivaavak — manage all your children from one account
• Students 13 and older — switch to "student view" from your parent's app
• Shikshaks — mark attendance, review Niyams, assign homework, run live quizzes
• Sanchalaks + city administrators — approve enrolments, post notices, run Shivirs

Made by Enaa Creations for Megh Sanskar Vatika. © 2026.
```

## Screenshot specs

Provide 8 portrait screenshots per device tier:

- Phone — 1080×1920 (or matching aspect 9:16), PNG.
- 7" tablet — 1200×1920.
- 10" tablet — 1440×2560.

Order: Home → Children list → Attendance calendar → Niyam upload → Punya
tier → Exam → Gallery → Donate.

## Feature graphic

- 1024×500 PNG/JPG, no transparency.
- Background = saffron `#D4621A`; logo + tagline in cream `#FDF8F2`.
- File: `apps/mobile/assets/store/play/feature-graphic.png` (placeholder until design hands over final).

## Data Safety form

Submit per Google Play's 2024 data-safety questionnaire.

| Data type                         | Collected?                    | Purpose                                         | Optional?                   |
| --------------------------------- | ----------------------------- | ----------------------------------------------- | --------------------------- |
| Phone number                      | Yes                           | App functionality (OTP login)                   | Required                    |
| User-generated photos             | Yes                           | Niyam proof; Gallery (opt-in)                   | Required for Niyam          |
| App activity (in-app actions)     | Yes                           | Analytics + app function                        | Required                    |
| Approximate location              | Yes (one-off on GPS check-in) | Shikshak GPS attendance verification            | Required for shikshaks only |
| Financial info (Razorpay payment) | Yes (via Razorpay SDK)        | Donations                                       | Optional                    |
| Children's data                   | Yes                           | Education service to parent-authorised accounts | Required                    |

Data is encrypted in transit (TLS 1.2+) and at rest (RDS KMS + S3 SSE-KMS).
Users can request export or deletion via support@jainpathshala.org.

## Review notes

- **Test account**: phone `+91 9999000000`. Submit any 6-digit OTP — the
  dev SMS provider auto-accepts.
- **Children's app exemption**: We're a parent-mediated app per Google's
  policy; no separate child account exists.
- **Religious content**: This is an educational app for the Jain
  community; no proselytising content.
