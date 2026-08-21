/**
 * Step 4 — course certificates, bilingual PDF, public verify (CU24–CU27).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { pool } from "@workspace/db";
import app from "../src/app";
import { loginAs, auth } from "./helpers";
import { registerReportJobs } from "../src/jobs/report-jobs";
import { processCourseCertificatePdf } from "../src/jobs/course-certificate-pdf";
import {
  buildCourseCertificatePdf,
  honorificForGender,
} from "../src/lib/course-certificate-pdf";
import { PdfBuilder } from "../src/lib/pdf";
import { issueCourseCertificate } from "../src/services/course-certificates";

/** pdf-lib compresses content streams — search inflated bodies for the font name. */
function pdfStreamContains(buf: Buffer, needle: string): boolean {
  let i = 0;
  const marker = Buffer.from("stream\n");
  const endMarker = Buffer.from("\nendstream");
  while (i < buf.length) {
    const idx = buf.indexOf(marker, i);
    if (idx < 0) break;
    const start = idx + marker.length;
    const end = buf.indexOf(endMarker, start);
    if (end < 0) break;
    try {
      const inflated = inflateSync(buf.subarray(start, end));
      if (inflated.toString("utf8").includes(needle)) return true;
    } catch {
      /* not flate */
    }
    i = end + 1;
  }
  return buf.toString("latin1").includes(needle);
}

afterAll(async () => {
  await pool.end();
});

beforeAll(() => {
  registerReportJobs();
});

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mumbaiCityId(superToken: string): Promise<string> {
  const geo = await request(app).get("/v1/admin/geography").set(auth(superToken));
  if (geo.status === 200 && Array.isArray(geo.body.data?.cities)) {
    const mumbai = (geo.body.data.cities as Array<{ id: string; name: string }>).find((c) =>
      /mumbai/i.test(c.name),
    );
    if (mumbai) return mumbai.id;
    return geo.body.data.cities[0].id;
  }
  const centres = await request(app).get("/v1/admin/centres").set(auth(superToken));
  const item = (centres.body.data.items as Array<{ city_id: string }>)[0];
  return item!.city_id;
}

async function publishableCourse(
  adminToken: string,
  cityId: string,
  opts?: { sections?: number; punya?: number },
): Promise<{ courseId: string; sectionIds: string[] }> {
  const create = await request(app)
    .post("/v1/admin/courses")
    .set(auth(adminToken))
    .send({
      name_en: `Cert course ${stamp()}`,
      name_hi: "प्रमाणपत्र पाठ्यक्रम",
      kind: "standard",
      academic_year: "2025-26",
      city_id: cityId,
      punya_points: 20,
    });
  expect(create.status).toBe(200);
  const courseId = create.body.data.id as string;
  const sectionIds: string[] = [];
  const n = opts?.sections ?? 1;
  for (let i = 0; i < n; i++) {
    const sec = await request(app)
      .post(`/v1/courses/${courseId}/sections`)
      .set(auth(adminToken))
      .send({
        title_en: `Sec ${i}`,
        title_hi: `अनुभाग ${i}`,
        punya_points: opts?.punya ?? 50,
      });
    expect(sec.status).toBe(200);
    sectionIds.push(sec.body.data.id);
  }
  return { courseId, sectionIds };
}

async function shikshakStudent(): Promise<{ studentId: string; fullName: string }> {
  const kid = await pool.query<{ id: string; full_name: string }>(
    `select s.id, s.full_name from students s
       join shikshak_batch_assignments a on a.batch_id = s.batch_id and a.is_active = true
       join users u on u.id = a.user_id
      where u.phone = '+919800000005' and s.status = 'active' and s.deleted_at is null
      limit 1`,
  );
  expect(kid.rows[0]?.id).toBeTruthy();
  return { studentId: kid.rows[0]!.id, fullName: kid.rows[0]!.full_name };
}

async function ensureShikshakGender(gender: "male" | "female" | null): Promise<void> {
  await pool.query(`update users set gender = $1 where phone = '+919800000005'`, [gender]);
}

async function completeAndCertify(
  shikshakToken: string,
  sectionId: string,
  studentId: string,
): Promise<string[]> {
  await request(app)
    .post(`/v1/courses/nodes/${sectionId}/progress`)
    .set(auth(shikshakToken))
    .send({ student_id: studentId, status: "completed" })
    .expect(200);
  const certify = await request(app)
    .post(`/v1/courses/nodes/${sectionId}/certify`)
    .set(auth(shikshakToken))
    .send({ student_id: studentId });
  expect(certify.status).toBe(200);
  return (certify.body.data.certificate_ids as string[]) ?? [];
}

async function waitForStorageKey(certId: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await pool.query<{ storage_key: string | null }>(
      `select storage_key from course_certificates where id = $1`,
      [certId],
    );
    if (r.rows[0]?.storage_key) return r.rows[0].storage_key;
    // Redis may be set — run worker path explicitly.
    await processCourseCertificatePdf(certId);
    const again = await pool.query<{ storage_key: string | null }>(
      `select storage_key from course_certificates where id = $1`,
      [certId],
    );
    if (again.rows[0]?.storage_key) return again.rows[0].storage_key!;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`certificate ${certId} never got storage_key`);
}

describe("CU17 honorific branches", () => {
  it("male / female / null-or-other are three distinct strings", () => {
    expect(honorificForGender("male")).toEqual({
      en: "Certified by Guruji",
      hi: "गुरुजी द्वारा प्रमाणित",
    });
    expect(honorificForGender("female")).toEqual({
      en: "Certified by Didi",
      hi: "दीदी द्वारा प्रमाणित",
    });
    expect(honorificForGender(null)).toEqual({ en: "Certified", hi: "प्रमाणित" });
    expect(honorificForGender("other")).toEqual({ en: "Certified", hi: "प्रमाणित" });
    expect(honorificForGender(undefined)).toEqual({ en: "Certified", hi: "प्रमाणित" });
  });
});

describe("course certificates step 4", () => {
  it("1 — certify a section → row + worker PDF with Devanagari honorific", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 2,
    });
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    const ids = await completeAndCertify(shikshak.token, sectionIds[0]!, studentId);
    expect(ids.length).toBeGreaterThanOrEqual(1);

    const row = await pool.query<{
      id: string;
      kind: string;
      verification_code: string;
      storage_key: string | null;
      scope_snapshot: { honorific_hi?: string };
    }>(
      `select id, kind, verification_code, storage_key, scope_snapshot
         from course_certificates
        where student_id = $1 and section_id = $2`,
      [studentId, sectionIds[0]],
    );
    expect(row.rows[0]).toBeTruthy();
    expect(row.rows[0]!.kind).toBe("section");
    expect(row.rows[0]!.verification_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(row.rows[0]!.scope_snapshot.honorific_hi).toBe("गुरुजी द्वारा प्रमाणित");

    const key = await waitForStorageKey(row.rows[0]!.id);
    const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
    const pdfPath = path.join(uploadsDir, ...key.split("/"));
    const buf = await readFile(pdfPath);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    // createBilingual embeds NotoSansDevanagari — name appears in Flate content streams.
    expect(pdfStreamContains(buf, "NotoSansDevanagari")).toBe(true);

    // Contrast: English-first create() strips Devanagari and never embeds Noto.
    const bare = await PdfBuilder.create();
    bare.bilingual("Certified by Guruji", "गुरुजी द्वारा प्रमाणित");
    const bareBuf = await bare.toBuffer();
    expect(pdfStreamContains(bareBuf, "NotoSansDevanagari")).toBe(false);
    expect(buf.byteLength).toBeGreaterThan(bareBuf.byteLength);

    const bilingual = await buildCourseCertificatePdf({
      kind: "section",
      snapshot: {
        kind: "section",
        course_id: courseId,
        course_name_en: "Test",
        course_name_hi: "परीक्षण",
        section_id: sectionIds[0]!,
        section_title_en: "Sec 0",
        section_title_hi: "अनुभाग 0",
        certified_by_name: "Guruji Test",
        honorific_en: "Certified by Guruji",
        honorific_hi: "गुरुजी द्वारा प्रमाणित",
        student_full_name: "Aarav Sharma",
      },
      verificationCode: "0123456789AB",
      issuedAt: new Date(),
    });
    expect(pdfStreamContains(bilingual, "NotoSansDevanagari")).toBe(true);
  });

  it("1b — a female Guruji (Didi) honorific reaches the real scope_snapshot, not just the pure honorificForGender() function", async () => {
    // Every other integration test in this file runs ensureShikshakGender("male")
    // — a regression hardcoding "Guruji" into loadCertifierContext would pass
    // every one of them. This is the only integration run on the female branch.
    await ensureShikshakGender("female");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    const ids = await completeAndCertify(shikshak.token, sectionIds[0]!, studentId);
    expect(ids.length).toBeGreaterThanOrEqual(1);

    const row = await pool.query<{
      id: string;
      scope_snapshot: { honorific_en?: string; honorific_hi?: string };
    }>(
      `select id, scope_snapshot from course_certificates
         where student_id = $1 and section_id = $2`,
      [studentId, sectionIds[0]],
    );
    expect(row.rows[0]).toBeTruthy();
    expect(row.rows[0]!.scope_snapshot.honorific_en).toBe("Certified by Didi");
    expect(row.rows[0]!.scope_snapshot.honorific_hi).toBe("दीदी द्वारा प्रमाणित");

    const key = await waitForStorageKey(row.rows[0]!.id);
    const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
    const buf = await readFile(path.join(uploadsDir, ...key.split("/")));
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdfStreamContains(buf, "NotoSansDevanagari")).toBe(true);

    // Restore the shared seed shikshak to the gender the rest of this file
    // (and courses.test.ts, which shares the same seeded phone) assumes.
    await ensureShikshakGender("male");
  });

  it("2 — a certified sub-section awards 0 Punya and issues no course_certificates row (CU21/CU24 — only section/course kinds are certificate-worthy)", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 1,
    });
    const sectionId = sectionIds[0]!;

    const sub = await request(app)
      .post(`/v1/courses/sections/${sectionId}/subsections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Leaf", title_hi: "पत्ती" });
    expect(sub.status).toBe(200);
    const subsectionId = sub.body.data.id as string;

    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    const beforeBal = await pool.query<{ total_points: number }>(
      `select coalesce(total_points, 0)::int as total_points from punya_balances where student_id = $1`,
      [studentId],
    );

    await request(app)
      .post(`/v1/courses/nodes/${subsectionId}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);
    const certify = await request(app)
      .post(`/v1/courses/nodes/${subsectionId}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(certify.status).toBe(200);
    expect(certify.body.data.section_points_awarded).toBe(0);
    expect(certify.body.data.course_points_awarded).toBe(0);
    expect(certify.body.data.certificate_ids).toEqual([]);

    const afterBal = await pool.query<{ total_points: number }>(
      `select coalesce(total_points, 0)::int as total_points from punya_balances where student_id = $1`,
      [studentId],
    );
    expect(afterBal.rows[0]?.total_points ?? 0).toBe(beforeBal.rows[0]?.total_points ?? 0);

    // The progress row itself IS starred (CU17 — sub-sections can be certified too)...
    const progressRow = await pool.query<{ certified_at: Date | null }>(
      `select certified_at from student_course_progress
        where student_id = $1 and subsection_id = $2`,
      [studentId, subsectionId],
    );
    expect(progressRow.rows[0]?.certified_at).toBeTruthy();

    // ...but no certificate row exists anywhere for this student/course — CU24's
    // kind IN ('section','course') means a sub-section never mints one.
    const certs = await pool.query<{ n: string }>(
      `select count(*)::text as n from course_certificates
        where student_id = $1 and course_id = $2`,
      [studentId, courseId],
    );
    expect(certs.rows[0]!.n).toBe("0");
  });

  it("3 — all sections → exactly one course cert; zero-section course → none", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 2,
      punya: 40,
    });
    await pool.query(`update courses set punya_points = 15 where id = $1`, [courseId]);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    await completeAndCertify(shikshak.token, sectionIds[0]!, studentId);
    await completeAndCertify(shikshak.token, sectionIds[1]!, studentId);

    const courseCerts = await pool.query<{ id: string }>(
      `select id from course_certificates
        where student_id = $1 and course_id = $2 and section_id is null and kind = 'course'`,
      [studentId, courseId],
    );
    expect(courseCerts.rows).toHaveLength(1);

    const sectionCerts = await pool.query<{ n: string }>(
      `select count(*)::text as n from course_certificates
        where student_id = $1 and course_id = $2 and kind = 'section'`,
      [studentId, courseId],
    );
    expect(Number(sectionCerts.rows[0]!.n)).toBe(2);

    // Zero-section course — publish gate blocks empty courses, so call the issuer directly.
    const empty = await request(app)
      .post("/v1/admin/courses")
      .set(auth(superAdmin.token))
      .send({
        name_en: `Empty ${stamp()}`,
        name_hi: "खाली",
        kind: "standard",
        academic_year: "2025-26",
        city_id: cityId,
        punya_points: 10,
      });
    expect(empty.status).toBe(200);
    const issued = await issueCourseCertificate({
      studentId,
      courseId: empty.body.data.id,
      actorId: shikshak.user.id,
    });
    expect(issued).toBeNull();
    const none = await pool.query<{ n: string }>(
      `select count(*)::text as n from course_certificates
        where student_id = $1 and course_id = $2`,
      [studentId, empty.body.data.id],
    );
    expect(none.rows[0]!.n).toBe("0");
  });

  it("4 — add section after course cert → not voided; verify still valid vs snapshot", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 1,
    });
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    await completeAndCertify(shikshak.token, sectionIds[0]!, studentId);

    const before = await pool.query<{
      id: string;
      verification_code: string;
      voided_at: Date | null;
      scope_snapshot: { sections?: unknown[] };
    }>(
      `select id, verification_code, voided_at, scope_snapshot
         from course_certificates
        where student_id = $1 and course_id = $2 and kind = 'course'`,
      [studentId, courseId],
    );
    expect(before.rows[0]).toBeTruthy();
    expect(before.rows[0]!.voided_at).toBeNull();
    const snapSections = before.rows[0]!.scope_snapshot.sections?.length ?? 0;
    expect(snapSections).toBe(1);

    const add = await request(app)
      .post(`/v1/courses/${courseId}/sections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Late sec", title_hi: "बाद में", punya_points: 50 });
    expect(add.status).toBe(200);

    const after = await pool.query<{ voided_at: Date | null; id: string }>(
      `select voided_at, id from course_certificates where id = $1`,
      [before.rows[0]!.id],
    );
    expect(after.rows[0]!.voided_at).toBeNull();

    const courseCount = await pool.query<{ n: string }>(
      `select count(*)::text as n from course_certificates
        where student_id = $1 and course_id = $2 and kind = 'course'`,
      [studentId, courseId],
    );
    expect(courseCount.rows[0]!.n).toBe("1");

    const verify = await request(app).get(
      `/v1/certificates/verify/${before.rows[0]!.verification_code}`,
    );
    expect(verify.status).toBe(200);
    expect(verify.body.data.validity).toBe("valid");
    expect(verify.body.data.title_en).toBeTruthy();
  });

  it("5 — super_admin correction voids; PDF kept; verify → void", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 1,
    });
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    await completeAndCertify(shikshak.token, sectionIds[0]!, studentId);

    const cert = await pool.query<{
      id: string;
      verification_code: string;
      storage_key: string | null;
    }>(
      `select id, verification_code, storage_key from course_certificates
        where student_id = $1 and section_id = $2`,
      [studentId, sectionIds[0]],
    );
    expect(cert.rows[0]).toBeTruthy();
    const key = await waitForStorageKey(cert.rows[0]!.id);
    const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
    const pdfPath = path.join(uploadsDir, ...key.split("/"));
    const beforeStat = await readFile(pdfPath);

    await request(app)
      .post(`/v1/courses/nodes/${sectionIds[0]}/certify/correct`)
      .set(auth(superAdmin.token))
      .send({ student_id: studentId })
      .expect(200);

    const voided = await pool.query<{
      voided_at: Date | null;
      storage_key: string | null;
    }>(`select voided_at, storage_key from course_certificates where id = $1`, [cert.rows[0]!.id]);
    expect(voided.rows[0]!.voided_at).toBeTruthy();
    expect(voided.rows[0]!.storage_key).toBe(key);
    const afterStat = await readFile(pdfPath);
    expect(afterStat.byteLength).toBe(beforeStat.byteLength);

    const verify = await request(app).get(
      `/v1/certificates/verify/${cert.rows[0]!.verification_code}`,
    );
    expect(verify.status).toBe(200);
    expect(verify.body.data.validity).toBe("void");
  });

  it("6 — verify body has no surname, DOB, centre, or uuid", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId);
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId, fullName } = await shikshakStudent();
    // Ensure a multi-part name so surname leak is detectable.
    const parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) {
      await pool.query(`update students set full_name = 'Aarav Sharma' where id = $1`, [
        studentId,
      ]);
    }
    const nameRow = await pool.query<{ full_name: string }>(
      `select full_name from students where id = $1`,
      [studentId],
    );
    const surname = nameRow.rows[0]!.full_name.trim().split(/\s+/).slice(1).join(" ");
    expect(surname.length).toBeGreaterThan(0);

    await completeAndCertify(shikshak.token, sectionIds[0]!, studentId);
    const cert = await pool.query<{ verification_code: string }>(
      `select verification_code from course_certificates
        where student_id = $1 and section_id = $2`,
      [studentId, sectionIds[0]],
    );

    const verify = await request(app).get(
      `/v1/certificates/verify/${cert.rows[0]!.verification_code}`,
    );
    expect(verify.status).toBe(200);
    const body = verify.body.data as Record<string, unknown>;
    const json = JSON.stringify(body);

    expect(body.validity).toBe("valid");
    expect(typeof body.student_first_name).toBe("string");
    expect(typeof body.title_en).toBe("string");
    expect(typeof body.issued_at).toBe("string");

    // Allowed keys only — no ids, centre, DOB, full name.
    expect(Object.keys(body).sort()).toEqual(
      ["issued_at", "student_first_name", "title_en", "title_hi", "validity"].sort(),
    );
    expect(json).not.toContain(surname);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(json.toLowerCase()).not.toMatch(/centre|center|dob|date_of_birth|student_id|course_id/);

    const list = await request(app)
      .get(`/v1/students/${studentId}/certificates`)
      .set(auth(shikshak.token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
    expect(list.body.data.items.length).toBeGreaterThan(0);
  });

  it("7 — C1: correcting a certified sub-section on a fully-certified course leaves the course bonus and course certificate untouched", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 1,
      punya: 40,
    });
    await pool.query(`update courses set punya_points = 25 where id = $1`, [courseId]);
    const sectionId = sectionIds[0]!;

    const sub = await request(app)
      .post(`/v1/courses/sections/${sectionId}/subsections`)
      .set(auth(superAdmin.token))
      .send({ title_en: "Leaf", title_hi: "पत्ती" });
    expect(sub.status).toBe(200);
    const subsectionId = sub.body.data.id as string;

    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();

    // Certify the sub-section (0 Punya, CU21) and — separately — the section,
    // which fully certifies this single-section course (section + course bonus).
    await request(app)
      .post(`/v1/courses/nodes/${subsectionId}/progress`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);
    const subCertify = await request(app)
      .post(`/v1/courses/nodes/${subsectionId}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(subCertify.status).toBe(200);

    await completeAndCertify(shikshak.token, sectionId, studentId);

    const balBefore = await pool.query<{ total_points: number }>(
      `select coalesce(total_points, 0)::int as total_points from punya_balances where student_id = $1`,
      [studentId],
    );
    const courseTxBefore = await pool.query<{ n: string }>(
      `select count(*)::text as n from punya_transactions
        where student_id = $1 and feature_key = 'course_completed' and points > 0`,
      [studentId],
    );
    const courseCertBefore = await pool.query<{ voided_at: Date | null }>(
      `select voided_at from course_certificates
        where student_id = $1 and course_id = $2 and section_id is null`,
      [studentId, courseId],
    );
    expect(courseCertBefore.rows[0]?.voided_at ?? null).toBeNull();

    // Correct the CERTIFIED SUB-SECTION — must not touch course-level state.
    const correct = await request(app)
      .post(`/v1/courses/nodes/${subsectionId}/certify/correct`)
      .set(auth(superAdmin.token))
      .send({ student_id: studentId });
    expect(correct.status).toBe(200);
    expect(correct.body.data.section_points_reversed).toBe(0);
    expect(correct.body.data.course_points_reversed).toBe(0);

    const balAfter = await pool.query<{ total_points: number }>(
      `select coalesce(total_points, 0)::int as total_points from punya_balances where student_id = $1`,
      [studentId],
    );
    expect(balAfter.rows[0]!.total_points).toBe(balBefore.rows[0]!.total_points);

    const courseTxAfter = await pool.query<{ n: string }>(
      `select count(*)::text as n from punya_transactions
        where student_id = $1 and feature_key = 'course_completed' and points > 0`,
      [studentId],
    );
    expect(courseTxAfter.rows[0]!.n).toBe(courseTxBefore.rows[0]!.n);

    const courseCertAfter = await pool.query<{ voided_at: Date | null }>(
      `select voided_at from course_certificates
        where student_id = $1 and course_id = $2 and section_id is null`,
      [studentId, courseId],
    );
    expect(courseCertAfter.rows[0]!.voided_at).toBeNull();
  });

  it("8 — C2: correcting a certified section then re-certifying revives the SAME certificate row; verify → valid", async () => {
    await ensureShikshakGender("male");
    const superAdmin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const cityId = await mumbaiCityId(superAdmin.token);
    const { courseId, sectionIds } = await publishableCourse(superAdmin.token, cityId, {
      sections: 1,
    });
    await request(app)
      .post(`/v1/admin/courses/${courseId}/publish`)
      .set(auth(superAdmin.token))
      .expect(200);

    const { studentId } = await shikshakStudent();
    const sectionId = sectionIds[0]!;
    await completeAndCertify(shikshak.token, sectionId, studentId);

    const cert = await pool.query<{ id: string; verification_code: string }>(
      `select id, verification_code from course_certificates
        where student_id = $1 and section_id = $2`,
      [studentId, sectionId],
    );
    expect(cert.rows[0]).toBeTruthy();
    const certId = cert.rows[0]!.id;
    const code = cert.rows[0]!.verification_code;

    await request(app)
      .post(`/v1/courses/nodes/${sectionId}/certify/correct`)
      .set(auth(superAdmin.token))
      .send({ student_id: studentId, status: "completed" })
      .expect(200);

    const voided = await pool.query<{ voided_at: Date | null }>(
      `select voided_at from course_certificates where id = $1`,
      [certId],
    );
    expect(voided.rows[0]!.voided_at).toBeTruthy();

    // Re-certify: C2 must revive the SAME row (partial unique index forbids
    // a second one for this student+section anyway), not leave it voided.
    const recert = await request(app)
      .post(`/v1/courses/nodes/${sectionId}/certify`)
      .set(auth(shikshak.token))
      .send({ student_id: studentId });
    expect(recert.status).toBe(200);
    expect(recert.body.data.certificate_ids).toContain(certId);

    const revived = await pool.query<{
      id: string;
      voided_at: Date | null;
      verification_code: string;
    }>(
      `select id, voided_at, verification_code from course_certificates
        where student_id = $1 and section_id = $2`,
      [studentId, sectionId],
    );
    expect(revived.rows).toHaveLength(1); // never a second row
    expect(revived.rows[0]!.id).toBe(certId);
    expect(revived.rows[0]!.voided_at).toBeNull();
    expect(revived.rows[0]!.verification_code).toBe(code);

    const verify = await request(app).get(`/v1/certificates/verify/${code}`);
    expect(verify.status).toBe(200);
    expect(verify.body.data.validity).toBe("valid");
  });
});
