import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { staffChangeError, type StaffChange } from "@/lib/staff-rules";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { revokeUserSessions } from "@/server/auth/session";
import { DomainError, isUniqueViolation } from "@/server/errors";

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/** Staff accounts for the Staff Management table. Never selects the password hash. */
export async function listStaff(): Promise<StaffMember[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .where(inArray(users.role, [...STAFF_ROLES]))
    .orderBy(asc(users.role), asc(users.name));
  return rows as StaffMember[];
}

export async function createStaff(input: { name: string; email: string; password: string; role: StaffRole }, actorId: string) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  if (existing) throw new DomainError("An account with that email already exists.", "CONFLICT", 409);
  try {
    const [row] = await db
      .insert(users)
      .values({ name: input.name.trim(), email, passwordHash: await hashPassword(input.password), role: input.role, isActive: true })
      .returning({ id: users.id });
    await audit(actorId, "staff.created", "user", row!.id, { email, name: input.name.trim(), role: input.role });
    return row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("An account with that email already exists.", "CONFLICT", 409);
    throw err;
  }
}

/**
 * Applies a role or active-state change under row locks (so two administrators can't each remove
 * the other and leave nobody in charge), then signs the person out everywhere.
 */
async function changeStaff(targetId: string, change: StaffChange, actorId: string) {
  const result = await db.transaction(async (tx) => {
    // Lock every administrator row, then the target, so concurrent changes are serialised.
    const admins = await tx
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.role, "ADMIN"), isNotNull(users.passwordHash)))
      .for("update");
    const [target] = await tx.select().from(users).where(eq(users.id, targetId)).for("update");
    if (!target || (target.role !== "ADMIN" && target.role !== "SUPERVISOR")) throw new DomainError("Staff account not found.", "NOT_FOUND", 404);

    const otherActiveAdmins = admins.filter((a) => a.isActive && a.id !== target.id).length;
    const problem = staffChangeError(actorId, { id: target.id, role: target.role, isActive: target.isActive }, change, otherActiveAdmins);
    if (problem) throw new DomainError(problem, "CONFLICT", 409);

    await tx.update(users).set(change.type === "role" ? { role: change.role } : { isActive: change.active }).where(eq(users.id, target.id));
    const revoked = await revokeUserSessions(target.id, tx);
    return { target, revoked };
  });

  const { target, revoked } = result;
  const who = { email: target.email, name: target.name };
  if (change.type === "role") await audit(actorId, "staff.role_changed", "user", target.id, { ...who, from: target.role, to: change.role });
  else await audit(actorId, change.active ? "staff.activated" : "staff.deactivated", "user", target.id, who);
  await audit(actorId, "staff.sessions_revoked", "user", target.id, { ...who, count: revoked, reason: change.type === "role" ? "role changed" : change.active ? "account activated" : "account deactivated" });
}

export const changeStaffRole = (targetId: string, role: StaffRole, actorId: string) => changeStaff(targetId, { type: "role", role }, actorId);
export const setStaffActive = (targetId: string, active: boolean, actorId: string) => changeStaff(targetId, { type: "active", active }, actorId);

/** An administrator sets a new password for a staff member, who is signed out everywhere. */
export async function resetStaffPassword(targetId: string, password: string, actorId: string) {
  const [target] = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!target || (target.role !== "ADMIN" && target.role !== "SUPERVISOR")) throw new DomainError("Staff account not found.", "NOT_FOUND", 404);
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, target.id));
  const revoked = await revokeUserSessions(target.id);
  await audit(actorId, "staff.password_reset", "user", target.id, { email: target.email, name: target.name });
  await audit(actorId, "staff.sessions_revoked", "user", target.id, { email: target.email, name: target.name, count: revoked, reason: "password reset" });
}
