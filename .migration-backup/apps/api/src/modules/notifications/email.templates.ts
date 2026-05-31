/**
 * Email templates — bilingual HTML/text builders.
 *
 * Each template returns `{subject, html, text}`. The render layer here is
 * deliberately string-based (template literals + escape helper) so we don't
 * pull in the React Email runtime for Step 12. When react-email/Resend's
 * MJML pipeline is wanted, swap one function per template — the public
 * `renderEmail(template, language, data)` contract stays the same.
 *
 * Brand colours come from CLAUDE.md Design System palette so emails feel
 * consistent with the in-app surface.
 */

import type { EmailDeliveryPayload } from './notifications.types';
import type { Language } from '@jp/shared';

const PALETTE = {
  saffron: '#D4621A',
  maroon: '#7A1818',
  cream: '#FDF8F2',
  ink: '#1A0A00',
  inkSub: '#8B6F5E',
  gold: '#C8941F',
};

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

function shell({ title, bodyHtml }: { title: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${PALETTE.cream};font-family:'Mukta','Helvetica Neue',Arial,sans-serif;color:${PALETTE.ink};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;background:${PALETTE.cream};">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;padding:32px;border-top:4px solid ${PALETTE.saffron};max-width:560px;width:100%;">
          <tr><td>
            <h1 style="font-family:'Tiro Devanagari Sanskrit',Georgia,serif;color:${PALETTE.maroon};font-size:24px;line-height:30px;margin:0 0 16px;">${escapeHtml(title)}</h1>
            ${bodyHtml}
            <p style="font-size:12px;color:${PALETTE.inkSub};margin-top:32px;line-height:18px;">— Jain Pathshala · Megh Sanskar Vatika</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

type TemplateRenderer = (language: Language, data: Record<string, unknown>) => Rendered;

const enrolmentApproved: TemplateRenderer = (language, data) => {
  const name = asString(data['full_name'], 'your child');
  const code = asString(data['student_code'], '—');
  const title = language === 'hi' ? 'प्रवेश स्वीकृत' : 'Enrolment approved';
  const intro =
    language === 'hi'
      ? `<p style="font-size:15px;line-height:23px;">नमस्ते,</p><p style="font-size:15px;line-height:23px;">${escapeHtml(name)} का Pathshala प्रवेश स्वीकृत किया गया है। Pathshala ID: <b>${escapeHtml(code)}</b>.</p>`
      : `<p style="font-size:15px;line-height:23px;">Pranam,</p><p style="font-size:15px;line-height:23px;">${escapeHtml(name)}'s Pathshala enrolment has been approved. Their Pathshala ID is <b>${escapeHtml(code)}</b>.</p>`;
  return {
    subject:
      language === 'hi'
        ? `Pathshala प्रवेश स्वीकृत — ${name}`
        : `Pathshala enrolment approved — ${name}`,
    html: shell({ title, bodyHtml: intro }),
    text:
      language === 'hi'
        ? `${name} का Pathshala प्रवेश स्वीकृत किया गया है। Pathshala ID: ${code}.`
        : `${name}'s Pathshala enrolment has been approved. Pathshala ID: ${code}.`,
  };
};

const monthlyReportReady: TemplateRenderer = (language, data) => {
  const name = asString(data['full_name'], 'your child');
  const period = asString(data['period_label'], '');
  const title =
    language === 'hi' ? 'मासिक प्रगति रिपोर्ट तैयार है' : 'Monthly progress report ready';
  const body =
    language === 'hi'
      ? `<p style="font-size:15px;line-height:23px;">${escapeHtml(name)} की ${escapeHtml(period)} की प्रगति रिपोर्ट तैयार है — Pathshala ऐप में देखें।</p>`
      : `<p style="font-size:15px;line-height:23px;">${escapeHtml(name)}'s progress report for ${escapeHtml(period)} is now available — tap into the Pathshala app to view.</p>`;
  return {
    subject:
      language === 'hi' ? `${name} की ${period} रिपोर्ट तैयार` : `${name}'s ${period} report ready`,
    html: shell({ title, bodyHtml: body }),
    text:
      language === 'hi'
        ? `${name} की ${period} की प्रगति रिपोर्ट तैयार है।`
        : `${name}'s progress report for ${period} is now available.`,
  };
};

const donationReceipt: TemplateRenderer = (language, data) => {
  const amount = asNumber(data['amount_inr'], 0);
  const number = asString(data['receipt_number'], '—');
  const title = language === 'hi' ? 'दान रसीद' : 'Donation receipt';
  const body =
    language === 'hi'
      ? `<p style="font-size:15px;line-height:23px;">आपके ₹${amount.toLocaleString('en-IN')} के दान के लिए धन्यवाद। रसीद संख्या: <b>${escapeHtml(number)}</b>.</p>`
      : `<p style="font-size:15px;line-height:23px;">Thank you for your donation of ₹${amount.toLocaleString('en-IN')}. Receipt number: <b>${escapeHtml(number)}</b>.</p>`;
  return {
    subject:
      language === 'hi'
        ? `दान रसीद — ₹${amount.toLocaleString('en-IN')}`
        : `Donation receipt — ₹${amount.toLocaleString('en-IN')}`,
    html: shell({ title, bodyHtml: body }),
    text:
      language === 'hi'
        ? `आपके ₹${amount.toLocaleString('en-IN')} के दान के लिए धन्यवाद। रसीद ${number}.`
        : `Thank you for your donation of ₹${amount.toLocaleString('en-IN')}. Receipt ${number}.`,
  };
};

const eightyGCertificate: TemplateRenderer = (language, data) => {
  const number = asString(data['certificate_number'], '—');
  const fy = asString(data['financial_year'], '—');
  const title = language === 'hi' ? '80G प्रमाण-पत्र तैयार है' : '80G certificate ready';
  const body =
    language === 'hi'
      ? `<p style="font-size:15px;line-height:23px;">FY ${escapeHtml(fy)} के लिए आपका 80G प्रमाण-पत्र तैयार है। प्रमाण-पत्र संख्या: <b>${escapeHtml(number)}</b>. ऐप में डाउनलोड करें।</p>`
      : `<p style="font-size:15px;line-height:23px;">Your 80G certificate for FY ${escapeHtml(fy)} is ready. Certificate number: <b>${escapeHtml(number)}</b>. Download it from the Pathshala app.</p>`;
  return {
    subject: language === 'hi' ? `80G प्रमाण-पत्र — FY ${fy}` : `80G certificate — FY ${fy}`,
    html: shell({ title, bodyHtml: body }),
    text:
      language === 'hi'
        ? `FY ${fy} के लिए आपका 80G प्रमाण-पत्र तैयार है। ${number}.`
        : `Your 80G certificate for FY ${fy} is ready (${number}).`,
  };
};

const weeklyDigest: TemplateRenderer = (language, data) => {
  const scopeLabel = asString(data['scope_label'], 'your scope');
  const title = language === 'hi' ? 'सप्ताह की रिपोर्ट' : 'This week in Pathshala';
  const body =
    language === 'hi'
      ? `<p style="font-size:15px;line-height:23px;">${escapeHtml(scopeLabel)} की साप्ताहिक डाइजेस्ट तैयार है। मुख्य अंक ऐप के डैशबोर्ड पर देखें।</p>`
      : `<p style="font-size:15px;line-height:23px;">The weekly digest for ${escapeHtml(scopeLabel)} is ready. Open the admin dashboard to see the headlines.</p>`;
  return {
    subject: language === 'hi' ? `सप्ताह की रिपोर्ट — ${scopeLabel}` : `This week in ${scopeLabel}`,
    html: shell({ title, bodyHtml: body }),
    text:
      language === 'hi'
        ? `${scopeLabel} की साप्ताहिक डाइजेस्ट तैयार है।`
        : `Weekly digest for ${scopeLabel} is ready.`,
  };
};

const generic: TemplateRenderer = (language, data) => {
  const subject = asString(
    data['subject'],
    language === 'hi' ? 'Pathshala अपडेट' : 'Pathshala update',
  );
  const message = asString(data['body'], '');
  return {
    subject,
    html: shell({
      title: subject,
      bodyHtml: `<p style="font-size:15px;line-height:23px;">${escapeHtml(message)}</p>`,
    }),
    text: message,
  };
};

const TEMPLATES: Record<EmailDeliveryPayload['template'], TemplateRenderer> = {
  'enrolment-approved': enrolmentApproved,
  'monthly-report-ready': monthlyReportReady,
  'donation-receipt': donationReceipt,
  'eighty-g-certificate': eightyGCertificate,
  'weekly-digest-city-admin': weeklyDigest,
  'weekly-digest-sanchalak': weeklyDigest,
  generic,
};

export function renderEmail(
  template: EmailDeliveryPayload['template'],
  language: Language,
  data: Record<string, unknown> = {},
): Rendered {
  return TEMPLATES[template](language, data);
}
