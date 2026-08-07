import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import {
  assertValidHindiTranslation,
  __translateTestHooks,
  TranslationFailedError,
} from "../src/services/translate";

afterEach(() => {
  __translateTestHooks.mockProvider = null;
  delete process.env.TRANSLATION_PROVIDER;
  delete process.env.TRANSLATION_API_KEY;
  delete process.env.TRANSLATION_MODEL;
});

afterAll(async () => {
  await pool.end();
});

describe("POST /v1/translate", () => {
  it("returns 503 ERR_TRANSLATION_UNAVAILABLE when TRANSLATION_PROVIDER is unset", async () => {
    delete process.env.TRANSLATION_PROVIDER;
    delete process.env.TRANSLATION_API_KEY;

    const admin = await loginAs("sanchalak");
    const res = await request(app)
      .post("/v1/translate")
      .set(auth(admin.token))
      .send({ text: "Pathshala closed on Sunday", target: "hi", context: "notice" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ERR_TRANSLATION_UNAVAILABLE");
  });

  it("forbids a parent from calling translate", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .post("/v1/translate")
      .set(auth(parent.token))
      .send({ text: "Hello", target: "hi", context: "notice" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("fills Hindi when the provider stub returns valid Devanagari", async () => {
    process.env.TRANSLATION_PROVIDER = "openai";
    process.env.TRANSLATION_API_KEY = "test-key";
    __translateTestHooks.mockProvider = async () => "रविवार को पाठशाला बंद रहेगी।";

    const admin = await loginAs("sanchalak");
    const res = await request(app)
      .post("/v1/translate")
      .set(auth(admin.token))
      .send({
        text: "Pathshala closed on Sunday",
        target: "hi",
        context: "notice",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.text).toContain("पाठशाला");
  });

  it("GET /v1/translate reports available:false when provider is unset", async () => {
    delete process.env.TRANSLATION_PROVIDER;
    const admin = await loginAs("shikshak");
    const res = await request(app).get("/v1/translate").set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
  });
});

describe("assertValidHindiTranslation", () => {
  it("rejects a mocked Hinglish response", () => {
    expect(() =>
      assertValidHindiTranslation(
        "Pathshala starts at 9",
        "पाठशाला 9 बजे start होती है",
      ),
    ).toThrow(TranslationFailedError);

    try {
      assertValidHindiTranslation(
        "Pathshala starts at 9",
        "पाठशाला 9 बजे start होती है",
      );
      expect.fail("expected TranslationFailedError");
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationFailedError);
      expect((err as Error).message).toMatch(/Latin script|Hinglish/i);
    }
  });

  it("rejects a mocked response that translates Punya to Merit", () => {
    expect(() =>
      assertValidHindiTranslation("Earn Punya this week", "इस सप्ताह Merit कमाएँ"),
    ).toThrow(TranslationFailedError);

    try {
      assertValidHindiTranslation("Earn Punya this week", "इस सप्ताह Merit कमाएँ");
      expect.fail("expected TranslationFailedError");
    } catch (err) {
      expect(err).toBeInstanceOf(TranslationFailedError);
      expect((err as Error).message).toMatch(/Punya|Merit|पुण्य/);
    }
  });

  it("accepts Devanagari that keeps Jain glossary terms", () => {
    expect(() =>
      assertValidHindiTranslation(
        "Pathshala Punya Niyam",
        "पाठशाला में पुण्य और नियम",
      ),
    ).not.toThrow();
  });
});
