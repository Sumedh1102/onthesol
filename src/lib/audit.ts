import { formatMoney } from "./format";

/**
 * Vocabulary of the activity log: which module an action belongs to, its label, how its
 * metadata is cleaned before it is stored and how it is summarised for display. Pure and shared
 * by the server (server/audit.ts, queries) and the Activity Log page.
 */
export const AUDIT_MODULES = [
  { key: "auth", label: "Authentication" },
  { key: "booking", label: "Booking" },
  { key: "payment", label: "Payment" },
  { key: "court", label: "Court" },
  { key: "staff", label: "Staff" },
  { key: "settings", label: "Settings" },
] as const;

export type AuditModule = (typeof AUDIT_MODULES)[number]["key"];

/** Every activity the application records. Older or unknown actions fall back to a readable label. */
export const AUDIT_ACTIONS = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.password_changed": "Changed own password",
  "booking.created": "Booking created",
  "booking.confirmed": "Booking confirmed",
  "booking.cancel": "Booking cancelled (no refund)",
  "booking.cancel_refund": "Booking cancelled and refunded",
  "booking.refund": "Cancelled booking refunded",
  "booking.expired": "Booking expired",
  "booking.status_changed": "Booking status changed",
  "payment.initiated": "Payment initiated",
  "payment.succeeded": "Payment successful",
  "payment.failed": "Payment failed",
  "payment.refund_requested": "Refund requested",
  "payment.refund_completed": "Refund completed",
  "payment.refund_failed": "Refund failed",
  "court.block": "Court blocked",
  "court.unblock": "Court unblocked",
  "court.update": "Court details updated",
  "court.price_hourly_changed": "Hourly prices changed",
  "court.price_monthly_changed": "Monthly prices changed",
  "court.status_changed": "Court status changed",
  "staff.created": "Staff account created",
  "staff.role_changed": "Staff role changed",
  "staff.activated": "Account activated",
  "staff.deactivated": "Account deactivated",
  "staff.password_reset": "Staff password reset",
  "staff.sessions_revoked": "Sessions revoked",
  "settings.booking_hours": "Booking hours changed",
} as const satisfies Record<string, string>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function moduleOf(action: string): AuditModule | null {
  const prefix = action.split(".")[0];
  return AUDIT_MODULES.find((m) => m.key === prefix)?.key ?? null;
}

export function moduleLabel(action: string): string {
  const key = moduleOf(action);
  return AUDIT_MODULES.find((m) => m.key === key)?.label ?? "Other";
}

export function actionLabel(action: string): string {
  if (action in AUDIT_ACTIONS) return AUDIT_ACTIONS[action as AuditAction];
  const text = action.replace(/[._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Keys whose values must never reach the log, matched anywhere in the (nested) metadata. */
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|signature|hash|authorization|cookie|api[-_]?key|card|cvv|otp/i;
const MAX_STRING = 300;
const MAX_DEPTH = 4;

/** Copies `meta` without sensitive keys, long strings or non-JSON values. */
export function sanitizeAuditMeta(meta: unknown, depth = 0): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key) || value === undefined || typeof value === "function") continue;
    if (value === null || typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => (v && typeof v === "object" ? (depth < MAX_DEPTH ? sanitizeAuditMeta(v, depth + 1) : null) : typeof v === "string" ? v.slice(0, MAX_STRING) : v));
    else if (typeof value === "object" && depth < MAX_DEPTH) out[key] = sanitizeAuditMeta(value, depth + 1);
  }
  return Object.keys(out).length ? out : null;
}

const DETAIL_ORDER = ["code", "receipt", "court", "email", "name", "from", "to", "role", "reason"];

const MONEY_KEY = /^(amount|total|subtotal|price\w*|monthlyPrice\w*)$/;

function show(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" && MONEY_KEY.test(key)) return formatMoney(value);
  if (typeof value === "object") {
    const change = value as { from?: unknown; to?: unknown };
    if ("from" in change && "to" in change) return `${show(key, change.from)} → ${show(key, change.to)}`;
    return JSON.stringify(value);
  }
  return String(value);
}

/** One-line summary of an event's metadata ("code: SP-AB12 · reason: …"), at most `max` entries. */
export function summarizeAuditMeta(meta: Record<string, unknown> | null | undefined, max = 6): string {
  if (!meta) return "";
  const keys = Object.keys(meta);
  keys.sort((a, b) => {
    const ia = DETAIL_ORDER.indexOf(a);
    const ib = DETAIL_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return keys
    .slice(0, max)
    .map((k) => `${k}: ${show(k, meta[k])}`)
    .join(" · ");
}
