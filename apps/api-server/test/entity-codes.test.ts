/**
 * Entity display-code formats + allocation.
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  composePathshalaCode,
  formatMsvCode,
  formatPersonaCode,
  localityToken,
  allocateStudentCode,
  allocateMsvCode,
} from "../src/lib/entity-codes";
import { pool, db } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import request from "supertest";
import app from "../src/app";

afterAll(async () => {
  await pool.end();
});

describe("entity code formats", () => {
  it("composes Pathshala and persona codes", () => {
    expect(localityToken("Ghatkopar East").length).toBeGreaterThanOrEqual(2);
    expect(composePathshalaCode("MUM", "GHK")).toBe("MUM-GHK");
    expect(formatPersonaCode("STU", "MUM", 42)).toBe("MUM-STU-00042");
    expect(formatPersonaCode("PAR", "MUM", 12)).toBe("MUM-PAR-00012");
    expect(formatPersonaCode("SHK", "MUM-GHK", 3)).toBe("MUM-GHK-SHK-00003");
    expect(formatPersonaCode("SAN", "MUM-GHK", 3)).toBe("MUM-GHK-SAN-00003");
    expect(formatPersonaCode("CAD", "MUM", 1)).toBe("MUM-CAD-00001");
    expect(formatPersonaCode("SAD", "MH", 1)).toBe("MH-SAD-00001");
    expect(formatMsvCode(1)).toBe("MSV00001");
  });

  it("allocates sequential student codes per city", async () => {
    const a = await allocateStudentCode(db, "TST");
    const b = await allocateStudentCode(db, "TST");
    expect(a).toMatch(/^TST-STU-\d{5}$/);
    expect(b).toMatch(/^TST-STU-\d{5}$/);
    const na = Number(a.split("-")[2]);
    const nb = Number(b.split("-")[2]);
    expect(nb).toBe(na + 1);
  });

  it("issues city-scoped student_code on admin create", async () => {
    const admin = await loginAs("super_admin");
    const centresRes = await request(app).get("/v1/admin/centres").set(auth(admin.token));
    expect(centresRes.status).toBe(200);
    const ghatkopar = (
      centresRes.body.data.items as Array<{ id: string; name: string; code?: string }>
    ).find((c) => c.code === "MUM-GHK" || c.name.includes("Ghatkopar"));
    expect(ghatkopar).toBeTruthy();

    const batches = await request(app).get("/v1/admin/batches").set(auth(admin.token));
    expect(batches.status).toBe(200);
    const batch = (batches.body.data.items as Array<{ id: string; centre_id: string; name: string }>).find(
      (b) => b.centre_id === ghatkopar!.id && b.name.includes("Bal Batch"),
    );
    expect(batch).toBeTruthy();

    const phone = `+9198${Date.now().toString().slice(-8)}`;
    const res = await request(app)
      .post("/v1/admin/students")
      .set(auth(admin.token))
      .send({
        full_name: "Code Format Child",
        dob: "2018-05-01",
        centre_id: batch!.centre_id,
        batch_id: batch!.id,
        parent_phone: phone,
        parent_full_name: "Code Format Parent",
        guardian_relation: "father",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.student_code).toMatch(/^MUM-STU-\d{5}$/);
  });

  it("allocates MSV codes globally", async () => {
    const a = await allocateMsvCode(db);
    const b = await allocateMsvCode(db);
    expect(a).toMatch(/^MSV\d{5}$/);
    expect(Number(b.slice(3))).toBe(Number(a.slice(3)) + 1);
  });
});
