import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLogs, bookings, courts, payments, sessions, users, courtBlocks } from "@/server/db/schema";
import { addDays, todayInTz } from "@/lib/time";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { createBookingHold } from "@/server/services/bookings";
import { startCheckout, verifyCheckout } from "@/server/payments/service";
import { changeStaffRole, createStaff, listStaff, resetStaffPassword, setStaffActive } from "@/server/services/staff";
import { listActivity } from "@/server/queries/admin";
import { fakePay } from "../fake-razorpay";

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (arg: string | { name: string }) => void jar.delete(typeof arg === "string" ? arg : arg.name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));

// Imported after the mocks above are registered.
const actions = await import("@/server/actions/admin");
const staffActions = await import("@/server/actions/staff");

const PASSWORD = "correct-horse-battery";
const FAKE = process.env.FAKE_RAZORPAY_URL!;
const form = (o: Record<string, string>) => Object.entries(o).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData());
const ok = (r: { ok: boolean }) => r.ok;

async function makeUser(role: "ADMIN" | "SUPERVISOR" | "MANAGER", name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@staff.test`, passwordHash: await hashPassword(PASSWORD), role, ...extra })
    .returning();
  return u!;
}

async function signInAs(user: { id: string; role: string }) {
  jar.clear();
  await createSession(user as Parameters<typeof createSession>[0]);
}

async function activity(action?: string) {
  const rows = await db.select().from(auditLogs).orderBy(auditLogs.createdAt);
  return action ? rows.filter((r) => r.action === action) : rows;
}

async function courtRow() {
  const [c] = await db.select().from(courts).where(eq(courts.slug, "badminton-court-1"));
  return c!;
}

beforeEach(async () => {
  jar.clear();
  await db.execute(sql`TRUNCATE audit_logs, sessions, rate_limits, bookings, booking_events, payments, court_blocks, payment_webhook_events, notification_deliveries RESTART IDENTITY CASCADE`);
  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@staff.test'`);
});

describe("signing in", () => {
  it("signs in an active administrator and an active supervisor, each with a session and an activity entry", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    for (const [user, role] of [[admin, "ADMIN"], [sup, "SUPERVISOR"]] as const) {
      jar.clear();
      await expect(actions.login(null, form({ email: user.email.toUpperCase(), password: PASSWORD }))).rejects.toMatchObject({ digest: expect.stringContaining("/admin") });
      expect(jar.has("sp_session")).toBe(true);
      const [event] = (await activity("auth.login")).filter((e) => e.actorId === user.id);
      expect(event!.actorRole).toBe(role);
    }
    expect(await db.select().from(sessions)).toHaveLength(2);
    expect((await db.select().from(users).where(eq(users.id, sup.id)))[0]!.lastLoginAt).not.toBeNull();
  });

  it("refuses inactive accounts, wrong passwords and legacy roles — and logs the failure without the password", async () => {
    const inactive = await makeUser("SUPERVISOR", "Ina Active", { isActive: false });
    const legacy = await makeUser("MANAGER", "Lee Gacy");
    const admin = await makeUser("ADMIN", "Ada Admin");
    for (const [email, password] of [
      [inactive.email, PASSWORD],
      [legacy.email, PASSWORD],
      [admin.email, "wrong-password-123"],
      ["nobody@staff.test", PASSWORD],
    ]) {
      const result = await actions.login(null, form({ email: email!, password: password! }));
      expect(result.ok).toBe(false);
    }
    expect(jar.has("sp_session")).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
    const failures = await activity("auth.login_failed");
    expect(failures).toHaveLength(4);
    expect(failures.every((f) => f.actorId === null)).toBe(true);
    expect(JSON.stringify(failures)).not.toContain(PASSWORD);
    expect(JSON.stringify(failures)).not.toContain("wrong-password-123");
  });

  it("logs a sign-out against the signed-in person", async () => {
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    await signInAs(sup);
    await expect(actions.logout()).rejects.toMatchObject({ digest: expect.stringContaining("/admin/login") });
    const [event] = await activity("auth.logout");
    expect(event).toMatchObject({ actorId: sup.id, actorRole: "SUPERVISOR" });
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe("server-side permissions (direct action calls)", () => {
  it("rejects every protected action when nobody is signed in", async () => {
    const court = await courtRow();
    for (const call of [
      () => staffActions.createStaffAction(null, form({ name: "X Y", email: "x@staff.test", password: PASSWORD, role: "ADMIN" })),
      () => actions.updateCourtAction(null, form({ courtId: court.id })),
      () => actions.updateBookingHoursAction(null, form({ openMinute: "420", closeMinute: "1320" })),
      () => actions.changePassword(null, form({ current: "a", password: PASSWORD, confirm: PASSWORD })),
    ]) {
      const r = await call();
      expect(r.ok).toBe(false);
    }
    expect(await db.select().from(users).where(eq(users.email, "x@staff.test"))).toHaveLength(0);
  });

  it("stops a supervisor from refunding, pricing, changing hours or managing staff", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    const court = await courtRow();
    await signInAs(sup);

    const price = await actions.updateCourtAction(
      null,
      form({ courtId: court.id, description: "", surface: "", status: "ACTIVE", price1h: "1", price2h: "1", monthlyPrice1m: "", monthlyPrice3m: "", monthlyPrice6m: "", monthlyPrice12m: "" }),
    );
    expect(price).toMatchObject({ ok: false, error: expect.stringContaining("administrator") });
    expect((await courtRow()).price1h).toBe(court.price1h);

    expect(await actions.updateBookingHoursAction(null, form({ openMinute: "360", closeMinute: "1380" }))).toMatchObject({ ok: false });
    expect(await actions.refundBookingAction(null, form({ bookingId: crypto.randomUUID(), reason: "Because" }))).toMatchObject({ ok: false, error: expect.stringContaining("administrator") });

    expect(await staffActions.createStaffAction(null, form({ name: "New Person", email: "np@staff.test", password: PASSWORD, role: "ADMIN" }))).toMatchObject({ ok: false });
    expect(await staffActions.changeStaffRoleAction(null, form({ userId: sup.id, role: "ADMIN" }))).toMatchObject({ ok: false });
    expect(await staffActions.setStaffActiveAction(null, form({ userId: admin.id, active: "no" }))).toMatchObject({ ok: false });
    expect(await staffActions.resetStaffPasswordAction(null, form({ userId: admin.id, password: "a-brand-new-password" }))).toMatchObject({ ok: false });

    const [still] = await db.select().from(users).where(eq(users.id, admin.id));
    expect([still!.isActive, still!.role]).toEqual([true, "ADMIN"]);
    expect((await db.select().from(users).where(eq(users.id, sup.id)))[0]!.role).toBe("SUPERVISOR");
    expect(await db.select().from(users).where(eq(users.email, "np@staff.test"))).toHaveLength(0);
  });

  it("stops a supervisor cancelling WITH a refund, but lets them cancel without one", async () => {
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    const court = await courtRow();
    const booking = await createBookingHold({ courtId: court.id, date: addDays(todayInTz(), 3), startMinute: 9 * 60, duration: 60, customer: { name: "Pat Player", phone: "+919876543210", email: "p@example.com" } });
    await signInAs(sup);

    const refused = await actions.cancelBookingAction(null, form({ bookingId: booking.id, reason: "Rain", refund: "yes" }));
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("administrator") });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]!.status).toBe("PENDING");

    await expect(actions.cancelBookingAction(null, form({ bookingId: booking.id, reason: "Rain", refund: "no" }))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]!.status).toBe("CANCELLED");
    expect(await activity("booking.cancel")).toMatchObject([{ actorId: sup.id, actorRole: "SUPERVISOR" }]);
  });

  it("lets a supervisor block and unblock court slots and change their own password", async () => {
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    const court = await courtRow();
    await signInAs(sup);
    const day = addDays(todayInTz(), 5);

    expect(ok(await actions.createBlockAction(null, form({ courtId: court.id, type: "MAINTENANCE", startDate: day, endDate: day, wholeDay: "yes", reason: "Net repair" })))).toBe(true);
    const [block] = await db.select().from(courtBlocks);
    expect(block).toBeDefined();
    await actions.deleteBlockAction(form({ blockId: block!.id }));
    expect(await db.select().from(courtBlocks)).toHaveLength(0);
    expect((await activity()).map((e) => e.action)).toEqual(expect.arrayContaining(["court.block", "court.unblock"]));

    const changed = await actions.changePassword(null, form({ current: PASSWORD, password: "another-long-password", confirm: "another-long-password" }));
    expect(changed.ok).toBe(true);
    const pw = await activity("auth.password_changed");
    expect(JSON.stringify(pw)).not.toContain("another-long-password");
  });

  it("lets an administrator reprice courts, and logs hourly, monthly and status changes", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const court = await courtRow();
    await signInAs(admin);
    try {
      const result = await actions.updateCourtAction(
        null,
        form({
          courtId: court.id,
          description: court.description ?? "",
          surface: court.surface ?? "",
          status: "MAINTENANCE",
          price1h: String(court.price1h / 100 + 100),
          price2h: String(court.price2h / 100),
          monthlyPrice1m: String((court.monthlyPrice1m ?? 600_000) / 100 + 500),
          monthlyPrice3m: String((court.monthlyPrice3m ?? 1_800_000) / 100),
          monthlyPrice6m: String((court.monthlyPrice6m ?? 3_600_000) / 100),
          monthlyPrice12m: String((court.monthlyPrice12m ?? 7_200_000) / 100),
        }),
      );
      expect(result.ok).toBe(true);
      const actionsLogged = (await activity()).map((e) => e.action);
      expect(actionsLogged).toEqual(expect.arrayContaining(["court.update", "court.price_hourly_changed", "court.price_monthly_changed", "court.status_changed"]));
      expect((await activity("court.price_hourly_changed"))[0]).toMatchObject({ actorId: admin.id, actorRole: "ADMIN" });
    } finally {
      await db.update(courts).set({ price1h: court.price1h, price2h: court.price2h, monthlyPrice1m: court.monthlyPrice1m, monthlyPrice3m: court.monthlyPrice3m, monthlyPrice6m: court.monthlyPrice6m, monthlyPrice12m: court.monthlyPrice12m, status: court.status }).where(eq(courts.id, court.id));
    }
  });
});

describe("sessions follow the account", () => {
  it("ends a session the moment the role changes or the account is deactivated", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    await createSession(sup); // a second device for the same person
    await createSession(sup);
    expect(await db.select().from(sessions).where(eq(sessions.userId, sup.id))).toHaveLength(2);

    await changeStaffRole(sup.id, "ADMIN", admin.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, sup.id))).toHaveLength(0);
    expect((await activity("staff.role_changed"))[0]!.meta).toMatchObject({ from: "SUPERVISOR", to: "ADMIN" });

    await createSession(sup);
    await setStaffActive(sup.id, false, admin.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, sup.id))).toHaveLength(0);
    // …and an inactive account has no usable session even if a cookie survived.
    expect((await actions.login(null, form({ email: sup.email, password: PASSWORD }))).ok).toBe(false);
    await setStaffActive(sup.id, true, admin.id);
    expect((await activity()).map((e) => e.action)).toEqual(expect.arrayContaining(["staff.deactivated", "staff.activated", "staff.sessions_revoked"]));
  });

  it("rejects a still-valid cookie once the account is deactivated directly in the database", async () => {
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    await signInAs(sup);
    expect((await staffActions.createStaffAction(null, form({ name: "Nope Nope", email: "nope@staff.test", password: PASSWORD, role: "SUPERVISOR" }))).ok).toBe(false);
    await db.update(users).set({ isActive: false }).where(eq(users.id, sup.id));
    expect((await actions.changePassword(null, form({ current: PASSWORD, password: "another-long-password", confirm: "another-long-password" }))).ok).toBe(false);
  });

  it("signs a staff member out of everything when an administrator resets their password", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    await createSession(sup);
    await resetStaffPassword(sup.id, "a-freshly-set-password", admin.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, sup.id))).toHaveLength(0);
    const events = JSON.stringify(await activity());
    expect(events).toContain("staff.password_reset");
    expect(events).not.toContain("a-freshly-set-password");
  });
});

describe("staff management", () => {
  it("creates staff through the admin action, with the rules of the existing password policy", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    await signInAs(admin);
    const base = { name: "Sue Pervisor", email: "Sue@Staff.Test", password: PASSWORD, role: "SUPERVISOR" };

    expect((await staffActions.createStaffAction(null, form({ ...base, password: "short" }))).ok).toBe(false);
    expect((await staffActions.createStaffAction(null, form({ ...base, role: "MANAGER" }))).ok).toBe(false);
    expect((await staffActions.createStaffAction(null, form(base))).ok).toBe(true);

    const [created] = await db.select().from(users).where(eq(users.email, "sue@staff.test"));
    expect(created).toMatchObject({ role: "SUPERVISOR", isActive: true });
    expect(created!.passwordHash).toMatch(/^scrypt\$/);
    // no duplicates, whatever the letter case
    expect(await staffActions.createStaffAction(null, form({ ...base, email: "SUE@staff.test" }))).toMatchObject({ ok: false, error: expect.stringContaining("already exists") });
    expect((await activity("staff.created"))[0]).toMatchObject({ actorId: admin.id, actorRole: "ADMIN" });
  });

  it("never exposes password hashes in the staff listing", async () => {
    await makeUser("ADMIN", "Ada Admin");
    await makeUser("SUPERVISOR", "Sam Super");
    await makeUser("MANAGER", "Lee Gacy");
    const list = await listStaff();
    expect(list.map((s) => s.role).sort()).toEqual(["ADMIN", "SUPERVISOR"]);
    expect(JSON.stringify(list)).not.toMatch(/scrypt|passwordHash/);
  });

  it("protects the last active administrator and the acting administrator", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const other = await makeUser("ADMIN", "Olly Other");
    const sup = await makeUser("SUPERVISOR", "Sam Super");

    await expect(setStaffActive(admin.id, false, admin.id)).rejects.toThrow(/own account/);
    await expect(changeStaffRole(admin.id, "SUPERVISOR", admin.id)).rejects.toThrow(/own role/);

    await setStaffActive(other.id, false, admin.id); // fine: Ada stays
    await expect(changeStaffRole(admin.id, "SUPERVISOR", other.id)).rejects.toThrow(); // other is inactive and not the actor… admin would be the last one
    await expect(setStaffActive(admin.id, false, sup.id)).rejects.toThrow(/last active administrator/);
    expect((await db.select().from(users).where(eq(users.id, admin.id)))[0]).toMatchObject({ role: "ADMIN", isActive: true });
  });

  it("can't strand the system when two administrators remove each other at once", async () => {
    const a = await makeUser("ADMIN", "Ada Admin");
    const b = await makeUser("ADMIN", "Bo Bee");
    const results = await Promise.allSettled([setStaffActive(b.id, false, a.id), setStaffActive(a.id, false, b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await db.select().from(users).where(sql`${users.role} = 'ADMIN' AND ${users.isActive} AND ${users.email} LIKE '%@staff.test'`);
    expect(active).toHaveLength(1);
  });
});

describe("activity log", () => {
  it("captures the customer booking and payment journey as system events", async () => {
    const court = await courtRow();
    const booking = await createBookingHold({ courtId: court.id, date: addDays(todayInTz(), 4), startMinute: 10 * 60, duration: 60, customer: { name: "Pat Player", phone: "+919876543210", email: "p@example.com" } });
    const checkout = await startCheckout(booking);
    const paid = await fakePay(FAKE, checkout.orderId, "captured");
    await verifyCheckout({ code: booking.code, orderId: checkout.orderId, paymentId: paid.paymentId, signature: paid.signature });

    const logged = await activity();
    expect(logged.map((e) => e.action)).toEqual(expect.arrayContaining(["booking.created", "payment.initiated", "payment.succeeded", "booking.confirmed", "booking.status_changed"]));
    expect(logged.every((e) => e.actorId === null && e.actorRole === null)).toBe(true);
    const text = JSON.stringify(logged);
    for (const secret of [paid.signature, "+919876543210", "p@example.com"]) expect(text).not.toContain(secret);
    expect((await db.select().from(payments))[0]!.status).toBe("PAID");
  });

  it("records the actor's role at the time and survives a later role change", async () => {
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    await audit(sup.id, "court.block", "court", null, { reason: "x", password: "nope" });
    await db.update(users).set({ role: "ADMIN" }).where(eq(users.id, sup.id));
    const [row] = await activity("court.block");
    expect(row!.actorRole).toBe("SUPERVISOR");
    expect(JSON.stringify(row!.meta)).not.toContain("nope");
  });

  it("never throws when logging fails, even inside a transaction", async () => {
    await expect(audit("not-a-uuid", "court.block", "court")).resolves.toBeUndefined();
    await db.transaction(async (tx) => {
      await audit("not-a-uuid", "court.block", "court", null, undefined, tx); // rolled back to its savepoint only
      await audit(null, "booking.created", "booking", null, { code: "SP-OK" }, tx);
    });
    expect((await activity()).map((e) => e.action)).toEqual(["booking.created"]);
  });

  it("filters by user, role, module, action, text and date, newest first, with pagination", async () => {
    const admin = await makeUser("ADMIN", "Ada Admin");
    const sup = await makeUser("SUPERVISOR", "Sam Super");
    for (let i = 0; i < 30; i++) await audit(sup.id, "court.block", "court", null, { reason: `block ${i}` });
    await audit(admin.id, "court.price_hourly_changed", "court", null, { court: "Badminton Court 1", price1h: { from: 50_000, to: 60_000 } });
    await audit(admin.id, "staff.created", "user", null, { email: "z@staff.test" });
    await audit(null, "booking.created", "booking", null, { code: "SP-ABC123" });
    await audit(null, "payment.succeeded", "payment", null, { receipt: "RCP-1" });
    // an old record from before roles were recorded keeps showing its actor's role
    await db.insert(auditLogs).values({ actorId: admin.id, action: "settings.booking_hours", entity: "settings", createdAt: new Date("2024-01-05T10:00:00Z") });

    const all = await listActivity({});
    expect(all.total).toBe(35);
    expect(all.rows).toHaveLength(25);
    expect(all.rows.map((r) => r.createdAt.getTime())).toEqual([...all.rows.map((r) => r.createdAt.getTime())].sort((a, b) => b - a));
    expect((await listActivity({ page: 2 })).rows).toHaveLength(10);

    expect((await listActivity({ user: sup.id })).total).toBe(30);
    expect((await listActivity({ user: "system" })).total).toBe(2);
    expect((await listActivity({ role: "SYSTEM" })).total).toBe(2);
    expect((await listActivity({ role: "SUPERVISOR" })).total).toBe(30);
    expect((await listActivity({ role: "ADMIN" })).total).toBe(3);
    expect((await listActivity({ module: "court" })).total).toBe(31);
    expect((await listActivity({ module: "payment" })).total).toBe(1);
    expect((await listActivity({ action: "staff.created" })).total).toBe(1);
    expect((await listActivity({ q: "SP-ABC" })).total).toBe(1);
    expect((await listActivity({ q: "Hourly prices" })).total).toBe(1); // matches the label, not just the key
    expect((await listActivity({ q: "ada admin" })).total).toBe(3);
    expect((await listActivity({ from: "2024-01-05", to: "2024-01-05" })).rows[0]).toMatchObject({ action: "settings.booking_hours", role: "ADMIN" });
    expect((await listActivity({ to: "2024-12-31" })).total).toBe(1);
    expect((await listActivity({ from: todayInTz(), to: todayInTz() })).total).toBe(34);
  });
});
