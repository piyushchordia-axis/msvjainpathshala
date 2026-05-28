/**
 * Bilingual templates keyed by `NotificationEvent`.
 *
 * Two callable surfaces:
 *   - `renderTemplate(event, data)` → `{title_en, title_hi, body_en, body_hi}`.
 *     Used by the fanout worker when it inserts the in-app row.
 *   - `pickContent(content, language)` → `{title, body}` for the language
 *     the recipient prefers (used at delivery time by push / sms / email).
 *
 * Devanagari content uses Mukta-renderable script (no transliteration) per
 * CLAUDE.md "Bilingual requirements". Untranslated Jain terms (Pathshala,
 * Niyam, Punya, Guruji, Sanchalak, Abhivaavak) are kept as-is in both
 * locales, per CLAUDE.md "UI tone rules".
 */

import type { NotificationContent, NotificationEvent } from './notifications.types';
import type { Language } from '@jp/shared';

type Renderer = (data: Record<string, unknown>) => NotificationContent;

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const TEMPLATES: Record<NotificationEvent, Renderer> = {
  'enrolment.submitted': (d) => ({
    title_en: 'Enrolment received',
    title_hi: 'प्रवेश आवेदन प्राप्त हुआ',
    body_en: `We've received the enrolment for ${asString(d.full_name, 'your child')}. A Sanchalak will review it shortly.`,
    body_hi: `${asString(d.full_name, 'आपके बच्चे')} का प्रवेश आवेदन प्राप्त हुआ। Sanchalak जल्द ही समीक्षा करेंगे।`,
  }),
  'enrolment.approved': (d) => ({
    title_en: 'Enrolment approved',
    title_hi: 'प्रवेश स्वीकृत',
    body_en: `${asString(d.full_name, 'Your child')} is now enrolled. Their Pathshala ID is ${asString(d.student_code, 'on the way')}.`,
    body_hi: `${asString(d.full_name, 'आपके बच्चे')} का प्रवेश स्वीकृत हो गया है। Pathshala ID: ${asString(d.student_code, '—')}`,
  }),
  'enrolment.rejected': (d) => ({
    title_en: 'Enrolment update',
    title_hi: 'प्रवेश से जुड़ी सूचना',
    body_en: `Your enrolment couldn't be approved. ${asString(d.reason, 'Tap to read the reason.')}`,
    body_hi: `आपका प्रवेश स्वीकृत नहीं किया जा सका। ${asString(d.reason, 'विवरण के लिए स्पर्श करें।')}`,
  }),
  'enrolment.waitlisted': (_d) => ({
    title_en: 'Added to the waitlist',
    title_hi: 'प्रतीक्षा सूची में जोड़ा गया',
    body_en: "Your enrolment is on the waitlist — we'll notify you the moment a seat opens up.",
    body_hi: 'आपका प्रवेश प्रतीक्षा सूची में है — सीट खाली होते ही आपको सूचित किया जाएगा।',
  }),
  'attendance.marked': (d) => ({
    title_en: `Attendance marked: ${asString(d.status_label, 'updated')}`,
    title_hi: `उपस्थिति दर्ज: ${asString(d.status_label_hi, 'अपडेट हो गई')}`,
    body_en: `${asString(d.full_name, 'Your child')}'s attendance for today was marked.`,
    body_hi: `${asString(d.full_name, 'आपके बच्चे')} की आज की उपस्थिति दर्ज की गई।`,
  }),
  'niyam.assigned': (d) => ({
    title_en: 'A new Niyam for you',
    title_hi: 'आपके लिए नया Niyam',
    body_en: asString(d.title, 'Tap to see this week’s Niyam.'),
    body_hi: asString(d.title_hi, 'इस सप्ताह का Niyam देखने के लिए स्पर्श करें।'),
  }),
  'niyam.rejected': (d) => ({
    title_en: 'Niyam submission needs a fix',
    title_hi: 'Niyam में सुधार की आवश्यकता',
    body_en: `${asString(d.reason, 'Your submission was rejected.')} Punya has been reversed.`,
    body_hi: `${asString(d.reason, 'आपका Niyam अस्वीकृत किया गया।')} Punya वापस ले लिया गया है।`,
  }),
  'homework.assigned': (d) => ({
    title_en: `New homework: ${asString(d.title, 'see details')}`,
    title_hi: `नया गृहकार्य: ${asString(d.title_hi, 'विवरण देखें')}`,
    body_en: 'Tap to view due date and instructions.',
    body_hi: 'अंतिम तिथि और निर्देश देखने के लिए स्पर्श करें।',
  }),
  'homework.approved': (d) => ({
    title_en: 'Homework approved',
    title_hi: 'गृहकार्य स्वीकृत',
    body_en: `Punya +${asNumber(d.punya, 0)} credited.`,
    body_hi: `Punya +${asNumber(d.punya, 0)} जोड़े गए।`,
  }),
  'notice.published': (d) => ({
    title_en: asString(d.title, 'New notice'),
    title_hi: asString(d.title_hi, 'नई सूचना'),
    body_en: asString(d.body, 'Tap to read.'),
    body_hi: asString(d.body_hi, 'पढ़ने के लिए स्पर्श करें।'),
  }),
  'notice.critical': (d) => ({
    title_en: `Important: ${asString(d.title, 'please read')}`,
    title_hi: `महत्वपूर्ण: ${asString(d.title_hi, 'कृपया पढ़ें')}`,
    body_en: asString(d.body, 'A critical notice has been published.'),
    body_hi: asString(d.body_hi, 'एक महत्वपूर्ण सूचना प्रकाशित की गई है।'),
  }),
  'shivir.registered': (d) => ({
    title_en: 'Shivir registration confirmed',
    title_hi: 'Shivir पंजीकरण की पुष्टि',
    body_en: `${asString(d.full_name, 'You')} are registered for ${asString(d.shivir_name, 'the upcoming Shivir')}.`,
    body_hi: `${asString(d.full_name, 'आप')} ${asString(d.shivir_name_hi, 'आगामी Shivir')} के लिए पंजीकृत हैं।`,
  }),
  'shivir.reminder': (d) => ({
    title_en: 'Shivir starts soon',
    title_hi: 'Shivir जल्द ही शुरू होगा',
    body_en: `${asString(d.shivir_name, 'Your Shivir')} begins ${asString(d.when, 'soon')}.`,
    body_hi: `${asString(d.shivir_name_hi, 'आपका Shivir')} ${asString(d.when_hi, 'जल्द ही')} शुरू होता है।`,
  }),
  'exam.result_published': (d) => ({
    title_en: 'Exam results are out',
    title_hi: 'परीक्षा परिणाम घोषित',
    body_en: `Result for ${asString(d.exam_name, 'your exam')} is now available.`,
    body_hi: `${asString(d.exam_name_hi, 'आपकी परीक्षा')} का परिणाम अब उपलब्ध है।`,
  }),
  'quiz.scheduled': (d) => ({
    title_en: 'A new push-quiz is open',
    title_hi: 'नया push-quiz उपलब्ध है',
    body_en: `Open it now — closes ${asString(d.closes_at, 'soon')}.`,
    body_hi: `अभी खोलें — समाप्ति ${asString(d.closes_at_hi, 'जल्द ही')}।`,
  }),
  'donation.receipt_ready': (d) => ({
    title_en: 'Donation receipt ready',
    title_hi: 'दान रसीद तैयार है',
    body_en: `Receipt for ₹${asNumber(d.amount_inr, 0)} is available in your inbox and the app.`,
    body_hi: `₹${asNumber(d.amount_inr, 0)} की रसीद आपके इनबॉक्स और ऐप में उपलब्ध है।`,
  }),
  'idcard.ready': (d) => ({
    title_en: 'Digital ID card is ready',
    title_hi: 'डिजिटल ID कार्ड तैयार है',
    body_en: `${asString(d.full_name, 'Your child')}'s Pathshala ID is now available.`,
    body_hi: `${asString(d.full_name, 'आपके बच्चे')} का Pathshala ID कार्ड अब उपलब्ध है।`,
  }),
  'birthday.wish': (d) => ({
    title_en: 'Happy birthday!',
    title_hi: 'जन्मदिन की शुभकामनाएँ!',
    body_en: `Wishing ${asString(d.full_name, 'you')} a very happy birthday from your Pathshala family.`,
    body_hi: `${asString(d.full_name, 'आपको')} Pathshala परिवार की ओर से जन्मदिन की हार्दिक शुभकामनाएँ।`,
  }),
  'holiday.announced': (d) => ({
    title_en: 'Holiday announced',
    title_hi: 'अवकाश घोषित',
    body_en: `${asString(d.name, 'Pathshala holiday')} on ${asString(d.start_date, '—')}.`,
    body_hi: `${asString(d.name, 'Pathshala अवकाश')} ${asString(d.start_date, '—')} को।`,
  }),
  centre_holiday_announced: (d) => ({
    title_en: 'Centre holiday',
    title_hi: 'केंद्र अवकाश',
    body_en: `${asString(d.name, 'Pathshala holiday')} on ${asString(d.start_date, '—')}.`,
    body_hi: `${asString(d.name, 'Pathshala अवकाश')} ${asString(d.start_date, '—')} को।`,
  }),
  'session.cancelled': (d) => ({
    title_en: 'Class cancelled today',
    title_hi: 'आज की कक्षा रद्द',
    body_en: asString(d.reason, "Today's class has been cancelled."),
    body_hi: asString(d.reason_hi, 'आज की कक्षा रद्द कर दी गई है।'),
  }),
  'competition.result': (d) => ({
    title_en: 'Competition result',
    title_hi: 'प्रतियोगिता परिणाम',
    body_en: `${asString(d.full_name, 'You')} placed ${asString(d.position, '—')} in ${asString(d.competition_name, 'the competition')}.`,
    body_hi: `${asString(d.full_name, 'आप')} ने ${asString(d.competition_name_hi, 'प्रतियोगिता')} में ${asString(d.position, '—')} स्थान प्राप्त किया।`,
  }),
  'service_request.resolved': (_d) => ({
    title_en: 'Your request is resolved',
    title_hi: 'आपका अनुरोध हल हो गया',
    body_en: 'Tap to see the update.',
    body_hi: 'विवरण देखने के लिए स्पर्श करें।',
  }),
  'punya.tier_upgrade': (d) => ({
    title_en: `Tier upgraded to ${asString(d.tier, '—')}`,
    title_hi: `Tier बढ़ा: ${asString(d.tier_hi, '—')}`,
    body_en: 'Your spiritual progress has been recognised.',
    body_hi: 'आपकी आध्यात्मिक प्रगति की सराहना की गई है।',
  }),
  'streak.badge_earned': (d) => ({
    title_en: `${asString(d.badge_label, 'Streak badge')} unlocked`,
    title_hi: `${asString(d.badge_label_hi, 'Streak badge')} प्राप्त`,
    body_en: 'Keep the streak going!',
    body_hi: 'streak बनाए रखें!',
  }),
};

export function renderTemplate(
  event: NotificationEvent,
  data: Record<string, unknown> = {},
): NotificationContent {
  const renderer = TEMPLATES[event];
  if (!renderer) {
    // Defensive fallback so a misnamed event doesn't crash the worker.
    return {
      title_en: 'Update',
      title_hi: 'अपडेट',
      body_en: 'You have a new update in your Pathshala account.',
      body_hi: 'आपके Pathshala खाते में एक नई अपडेट है।',
    };
  }
  return renderer(data);
}

export function pickContent(
  content: NotificationContent,
  language: Language,
): { title: string; body: string } {
  return language === 'hi'
    ? { title: content.title_hi, body: content.body_hi }
    : { title: content.title_en, body: content.body_en };
}
