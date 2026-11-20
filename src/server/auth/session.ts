import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/server/db";
import { sessions, users, type User } from "@/server/db/schema";
import { isStaffRole, type StaffRole } from "@/lib/permissions";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from "./jwt";

export type SessionUser = Pick<User, "id" | "name" | "email"> & { role: StaffRole };

/** The staff cookie is only sent to /admin pages (and their server actions). */
const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/admin",
};

export async function createSession(user: Pick<User, "id" | "role">) {
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      ip: (h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null)?.slice(0, 64) ?? null,
    })
    .returning({ id: sessions.id });

  const token = await signSessionToken({ sid: row!.id, sub: user.id, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieBase, expires: expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
}

export async function destroySession() {
  const jar = await cookies();
  const claims = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (claims) await db.delete(sessions).where(eq(sessions.id, claims.sid));
  jar.delete({ name: SESSION_COOKIE, path: cookieBase.path });
}

/** Signs a user out everywhere (deactivation, role change, password reset). Returns how many sessions ended. */
export async function revokeUserSessions(userId: string, conn: Pick<typeof db, "delete"> = db): Promise<number> {
  const removed = await conn.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  return removed.length;
}

/**
 * Authoritative session lookup: verifies the signed token AND that the session row still
 * exists, hasn't expired and belongs to an active ADMIN or SUPERVISOR. The role always comes
 * from the database row, never from the token, so a role change applies immediately. Memoised
 * per request.
 */
export const getSession = cache(async (): Promise<{ sessionId: string; user: SessionUser } | null> => {
  const claims = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;

  const [row] = await db
    .select({ sessionId: sessions.id, id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, claims.sid), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.isActive || !isStaffRole(row.role)) return null;
  return { sessionId: row.sessionId, user: { id: row.id, name: row.name, email: row.email, role: row.role } };
});
