/**
 * CU26 — bilingual course/section certificate PDF.
 * Must use PdfBuilder.createBilingual() so CU17 Devanagari honorifics render.
 */
import { PdfBuilder } from "./pdf";
import { firstName } from "./route-helpers";

export type CertificateHonorific = {
  en: string;
  hi: string;
};

/** CU17 — three branches; nullable/other gender must not default to Guruji. */
export function honorificForGender(
  gender: string | null | undefined,
): CertificateHonorific {
  if (gender === "male") {
    return { en: "Certified by Guruji", hi: "गुरुजी द्वारा प्रमाणित" };
  }
  if (gender === "female") {
    return { en: "Certified by Didi", hi: "दीदी द्वारा प्रमाणित" };
  }
  return { en: "Certified", hi: "प्रमाणित" };
}

export type SectionScopeSnapshot = {
  kind: "section";
  course_id: string;
  course_name_en: string;
  course_name_hi: string | null;
  section_id: string;
  section_title_en: string;
  section_title_hi: string;
  certified_by_name: string | null;
  honorific_en: string;
  honorific_hi: string;
  student_full_name: string;
};

export type CourseScopeSnapshot = {
  kind: "course";
  course_id: string;
  course_name_en: string;
  course_name_hi: string | null;
  sections: Array<{ id: string; title_en: string; title_hi: string }>;
  certified_by_name: string | null;
  honorific_en: string;
  honorific_hi: string;
  student_full_name: string;
};

export type CertificateScopeSnapshot = SectionScopeSnapshot | CourseScopeSnapshot;

export async function buildCourseCertificatePdf(opts: {
  kind: "section" | "course";
  snapshot: CertificateScopeSnapshot;
  verificationCode: string;
  issuedAt: Date;
}): Promise<Buffer> {
  const pdf = await PdfBuilder.createBilingual();
  const snap = opts.snapshot;
  const studentFirst = firstName(snap.student_full_name);
  const issued = opts.issuedAt.toISOString().slice(0, 10);

  if (opts.kind === "section" && snap.kind === "section") {
    pdf.title("Pathshala certificate / पाठशाला प्रमाणपत्र");
    pdf.spacer(6);
    pdf.bilingual("Section certificate", "अनुभाग प्रमाणपत्र");
    pdf.hr();
    pdf.bilingual(`Student: ${studentFirst}`, `विद्यार्थी: ${studentFirst}`);
    pdf.bilingual(
      `Course: ${snap.course_name_en}`,
      snap.course_name_hi ? `पाठ्यक्रम: ${snap.course_name_hi}` : undefined,
    );
    pdf.bilingual(
      `Section: ${snap.section_title_en}`,
      `अनुभाग: ${snap.section_title_hi}`,
    );
    pdf.bilingual(`Issued: ${issued}`, `जारी: ${issued}`);
    pdf.spacer(8);
    pdf.bilingual(snap.honorific_en, snap.honorific_hi);
    if (snap.certified_by_name) {
      pdf.bilingual(`By: ${snap.certified_by_name}`, `द्वारा: ${snap.certified_by_name}`);
    }
  } else if (snap.kind === "course") {
    pdf.title("Pathshala certificate / पाठशाला प्रमाणपत्र");
    pdf.spacer(6);
    pdf.bilingual("Course certificate", "पाठ्यक्रम प्रमाणपत्र");
    pdf.hr();
    pdf.bilingual(`Student: ${studentFirst}`, `विद्यार्थी: ${studentFirst}`);
    pdf.bilingual(
      `Course: ${snap.course_name_en}`,
      snap.course_name_hi ? `पाठ्यक्रम: ${snap.course_name_hi}` : undefined,
    );
    pdf.bilingual(`Issued: ${issued}`, `जारी: ${issued}`);
    pdf.spacer(4);
    pdf.heading("Sections covered / समाविष्ट अनुभाग");
    for (const s of snap.sections) {
      pdf.bilingual(`• ${s.title_en}`, `• ${s.title_hi}`);
    }
    pdf.spacer(8);
    pdf.bilingual(snap.honorific_en, snap.honorific_hi);
    if (snap.certified_by_name) {
      pdf.bilingual(`By: ${snap.certified_by_name}`, `द्वारा: ${snap.certified_by_name}`);
    }
  }

  pdf.hr();
  pdf.bilingual(
    `Verification code: ${opts.verificationCode}`,
    `सत्यापन कोड: ${opts.verificationCode}`,
  );
  return pdf.toBuffer();
}
