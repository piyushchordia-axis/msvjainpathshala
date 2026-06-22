import { Router, type IRouter, type Request, type Response } from "express";

/**
 * Public, unauthenticated legal pages (privacy policy / terms). Both the App
 * Store and Google Play require a live, publicly-reachable privacy-policy URL,
 * so this is served as plain HTML from the API at:
 *   GET /privacy   and   GET /privacy-policy  (alias)
 *   GET /terms
 *
 * Content reflects what the Jain Pathshala app actually collects (phone for OTP
 * login, profile, attendance location, ID-card QR camera). Edit CONTACT_EMAIL /
 * ORG_NAME below to match the operating organisation.
 */
const router: IRouter = Router();

const LAST_UPDATED = "22 June 2026";
const ORG_NAME = "Jain Pathshala (Megh Sanskar Vatika network)";
const CONTACT_EMAIL = "support@jainpathshala.enaacreations.com";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>${title} · Jain Pathshala</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #FDF6EC; color: #2A1A12;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 64px; }
  header { border-bottom: 2px solid #E8541A22; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { color: #7B1E1E; font-size: 28px; margin: 0 0 4px; }
  h2 { color: #7B1E1E; font-size: 20px; margin: 32px 0 8px; }
  .meta { color: #9A6A4E; font-size: 14px; }
  a { color: #B23A12; }
  ul { padding-left: 22px; }
  li { margin: 6px 0; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #E8541A22; color: #9A6A4E; font-size: 14px; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${title}</h1>
  <div class="meta">${ORG_NAME} — last updated ${LAST_UPDATED}</div>
</header>
${body}
<footer>Questions about this policy? Contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</footer>
</div>
</body>
</html>`;
}

const PRIVACY_BODY = `
<p>This Privacy Policy explains how ${ORG_NAME} ("we", "us") collects, uses, and
protects information when you use the <strong>Jain Pathshala</strong> mobile app
("the app"). The app is provided to students, parents, and teachers
(sanchalaks/shikshaks) of participating Jain Pathshala centres.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Mobile number</strong> — used to sign you in via a one-time code (OTP). Only numbers already registered with a centre can sign in.</li>
  <li><strong>Profile details</strong> — your name, student/member code, centre, batch, age group, and role, as registered by your centre.</li>
  <li><strong>Location</strong> — accessed <em>only</em> when a teacher marks class attendance, to verify presence at the centre. Location is not tracked in the background.</li>
  <li><strong>Camera</strong> — used <em>only</em> to scan student ID-card QR codes for shivir/attendance check-in. Images are not stored.</li>
  <li><strong>Activity data</strong> — attendance, homework, exam/quiz results, niyam (vow) submissions, and punya points generated through normal use of the app.</li>
  <li><strong>Device & notification token</strong> — to deliver push notifications and keep the app secure.</li>
</ul>

<h2>How we use your information</h2>
<ul>
  <li>To authenticate you and keep your account secure.</li>
  <li>To run everyday Pathshala activities: attendance, homework, exams, progress reports, digital ID cards, niyam tracking, and announcements.</li>
  <li>To communicate important updates and notices from your centre.</li>
</ul>

<h2>How we share your information</h2>
<p>We do <strong>not</strong> sell your personal information and we do <strong>not</strong> use it for advertising. Information is visible only within your Pathshala organisation (your centre's teachers and administrators) as needed to run the programme. We use trusted infrastructure providers to host the service; they process data only on our instructions. We may disclose information if required by law.</p>

<h2>Children's privacy</h2>
<p>Many students are minors. Student accounts are created and managed by the centre and the student's parent/guardian, who consent to the collection of the limited data described above. We collect only what is needed to run the Pathshala programme and never require children to provide more than necessary.</p>

<h2>Data security &amp; retention</h2>
<p>We protect your information with industry-standard safeguards (encrypted transport, access controls). We keep your information for as long as your account is active or as needed to provide the service, and delete or anonymise it when it is no longer needed, subject to legal requirements.</p>

<h2>Your rights</h2>
<p>You may request access to, correction of, or deletion of your personal information by contacting your centre or us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

<h2>Changes to this policy</h2>
<p>We may update this policy from time to time. The "last updated" date above reflects the latest version.</p>
`;

const TERMS_BODY = `
<p>By using the <strong>Jain Pathshala</strong> app you agree to use it only for
its intended purpose — participating in and administering Jain Pathshala
activities for your centre. Access is limited to registered members. Do not
misuse the service, attempt to access data that is not yours, or disrupt the
service. The app is provided "as is"; we work to keep it reliable but do not
guarantee uninterrupted availability. For questions, contact
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`;

function send(res: Response, html: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(html);
}

const SUPPORT_BODY = `
<p>Need help with the <strong>Jain Pathshala</strong> app? We're happy to assist
students, parents, and teachers of participating centres.</p>
<h2>Contact us</h2>
<ul>
  <li>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li>
  <li>Or reach out to your Pathshala centre's administrator.</li>
</ul>
<h2>Common questions</h2>
<ul>
  <li><strong>Can't sign in?</strong> Only the mobile number registered with your centre can receive a one-time code. Ask your centre to confirm your registered number.</li>
  <li><strong>Wrong details?</strong> Your centre administrator can update your profile, batch, or centre.</li>
  <li><strong>Want to delete your account?</strong> See <a href="/delete-account">Delete your account &amp; data</a>.</li>
</ul>
`;

// Dedicated account-/data-deletion instructions. Google Play requires apps that
// allow account creation to publish a public URL where users can request
// account + data deletion; this is that page.
const DELETE_ACCOUNT_BODY = `
<p>You can ask us to delete your <strong>Jain Pathshala</strong> account and the
personal data associated with it at any time. The app signs you in with your
mobile number, so there is no self-serve delete button inside the app — instead,
send us a short request and we will remove your account for you.</p>

<h2>How to request deletion</h2>
<ul>
  <li>Email <a href="mailto:${CONTACT_EMAIL}?subject=Delete%20my%20account">${CONTACT_EMAIL}</a> from, or mentioning, the mobile number registered with your centre.</li>
  <li>Include your full name and the name of your Pathshala centre so we can locate your account.</li>
  <li>For a student account managed by a parent/guardian or centre, the parent/guardian or the centre administrator may make the request on the student's behalf.</li>
</ul>

<h2>What gets deleted</h2>
<p>On verifying the request we permanently delete your account and personal data, including your profile (name, mobile number, email, centre/batch), your digital ID card, uploaded photos, and your activity records (attendance, homework, exam/quiz results, niyam submissions, and punya points).</p>

<h2>What we may retain</h2>
<p>We may keep a limited set of records where the law requires it or to resolve disputes and prevent abuse — for example, donation/transaction records needed for financial and tax compliance. Such records are retained only as long as required and are otherwise deleted or anonymised.</p>

<h2>Timeline</h2>
<p>We action verified deletion requests within <strong>30 days</strong> and email you to confirm once it is done. Deleting your account removes your access to the app.</p>

<p>Questions? Contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`;

router.get(["/privacy", "/privacy-policy"], (_req: Request, res: Response) =>
  send(res, page("Privacy Policy", PRIVACY_BODY)),
);
router.get(["/terms", "/terms-of-service"], (_req: Request, res: Response) =>
  send(res, page("Terms of Service", TERMS_BODY)),
);
router.get("/support", (_req: Request, res: Response) =>
  send(res, page("Support", SUPPORT_BODY)),
);
router.get(["/delete-account", "/data-deletion", "/account-deletion"], (_req: Request, res: Response) =>
  send(res, page("Delete Your Account & Data", DELETE_ACCOUNT_BODY)),
);

export default router;
