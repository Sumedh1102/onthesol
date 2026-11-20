import { describe, expect, it } from "vitest";
import { actionLabel, AUDIT_ACTIONS, moduleLabel, moduleOf, sanitizeAuditMeta, summarizeAuditMeta } from "./audit";

describe("activity vocabulary", () => {
  it("puts every known action in a module", () => {
    for (const action of Object.keys(AUDIT_ACTIONS)) expect(moduleOf(action), action).not.toBeNull();
  });

  it("maps actions, including those logged before roles existed, to modules and labels", () => {
    expect(moduleLabel("booking.cancel_refund")).toBe("Booking");
    expect(moduleLabel("court.unblock")).toBe("Court");
    expect(moduleLabel("settings.booking_hours")).toBe("Settings");
    expect(moduleLabel("payment.refund_completed")).toBe("Payment");
    expect(moduleLabel("staff.role_changed")).toBe("Staff");
    expect(moduleLabel("legacy.thing")).toBe("Other");
    expect(actionLabel("court.block")).toBe("Court blocked");
    expect(actionLabel("legacy.some_thing")).toBe("Legacy some thing");
  });
});

describe("sanitizeAuditMeta", () => {
  it("drops passwords, tokens, signatures and hashes at any depth", () => {
    const clean = sanitizeAuditMeta({
      email: "a@b.co",
      password: "hunter2hunter2",
      newPassword: "x",
      passwordHash: "scrypt$…",
      token: "t",
      razorpay_signature: "sig",
      Authorization: "Bearer x",
      nested: { apiKey: "k", ok: 1 },
      list: [{ secret: "s", keep: "yes" }],
    });
    expect(clean).toEqual({ email: "a@b.co", nested: { ok: 1 }, list: [{ keep: "yes" }] });
  });

  it("keeps money and booleans, truncates long text and returns null for nothing useful", () => {
    expect(sanitizeAuditMeta({ amount: 90_000, ok: true })).toEqual({ amount: 90_000, ok: true });
    expect((sanitizeAuditMeta({ reason: "x".repeat(500) })!.reason as string).length).toBe(301);
    expect(sanitizeAuditMeta({ password: "x" })).toBeNull();
    expect(sanitizeAuditMeta(undefined)).toBeNull();
    expect(sanitizeAuditMeta([1, 2])).toBeNull();
  });
});

describe("summarizeAuditMeta", () => {
  it("shows the identifying fields first and formats money and changes", () => {
    expect(summarizeAuditMeta({ amount: 90_000, reason: "Rain", code: "SP-1" })).toBe("code: SP-1 · reason: Rain · amount: ₹900");
    expect(summarizeAuditMeta({ court: "Court 1", price1h: { from: 50_000, to: 60_000 } })).toBe("court: Court 1 · price1h: ₹500 → ₹600");
    expect(summarizeAuditMeta(null)).toBe("");
  });
});
