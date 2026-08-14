/**
 * Unit tests for 2Factor delivery-only SMS adapter (mocked fetch — no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TwoFactorSmsProvider,
  normalizePhoneForSms,
  getSmsProvider,
  _resetSmsProvider,
} from "../src/lib/sms";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetSmsProvider();
  delete process.env.TWO_FACTOR_API_KEY;
  delete process.env.TWO_FACTOR_TEMPLATE;
  delete process.env.SMS_PROVIDER;
  delete process.env.MSG91_AUTH_KEY;
  delete process.env.MSG91_TEMPLATE_ID;
  delete process.env.SMS_API_URL;
});

describe("normalizePhoneForSms", () => {
  it("strips a leading + and spaces", () => {
    expect(normalizePhoneForSms("+91 98123 45678")).toBe("919812345678");
  });

  it("leaves a bare 10-digit number alone", () => {
    expect(normalizePhoneForSms("9812345678")).toBe("9812345678");
  });
});

describe("TwoFactorSmsProvider", () => {
  it("sends our OTP via SMS/{phone}/{otp}/{template} and accepts Status Success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ Status: "Success", Details: "session-ignored" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new TwoFactorSmsProvider("key-uuid", "oceanlogin");
    await provider.sendOtp("+919812345678", "482913");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toBe(
      "https://2factor.in/API/V1/key-uuid/SMS/919812345678/482913/oceanlogin",
    );
  });

  it("throws when Status is not Success even if HTTP would be 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ Status: "Error", Details: "Invalid Template" }),
    }) as unknown as typeof fetch;

    const provider = new TwoFactorSmsProvider("key-uuid", "oceanlogin");
    await expect(provider.sendOtp("+919812345678", "123456")).rejects.toThrow(
      /Invalid Template/,
    );
  });

  it("checkBalance hits BAL/SMS", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ Status: "Success", Details: "42" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new TwoFactorSmsProvider("key-uuid", "oceanlogin");
    const body = await provider.checkBalance();
    expect(body.Details).toBe("42");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://2factor.in/API/V1/key-uuid/BAL/SMS",
    );
  });
});

describe("getSmsProvider factory (2factor)", () => {
  beforeEach(() => {
    _resetSmsProvider();
  });

  it("requires TWO_FACTOR_TEMPLATE when the API key is set", () => {
    process.env.TWO_FACTOR_API_KEY = "key-uuid";
    delete process.env.TWO_FACTOR_TEMPLATE;
    expect(() => getSmsProvider()).toThrow(/TWO_FACTOR_TEMPLATE/);
  });

  it("builds a 2factor provider when key + template are set", () => {
    process.env.TWO_FACTOR_API_KEY = "key-uuid";
    process.env.TWO_FACTOR_TEMPLATE = "oceanlogin";
    const provider = getSmsProvider();
    expect(provider.name).toBe("2factor");
    expect(provider.ownsCode).toBe(false);
  });
});
