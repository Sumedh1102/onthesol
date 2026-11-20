import "server-only";
import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/permissions";
import { getSession, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor(message = "You are not allowed to do that.") {
    super(message);
    this.name = "AuthError";
  }
}

/** The signed-in staff member (ADMIN or SUPERVISOR) or null. Authoritative: checks the database. */
export async function getStaff(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}

/** For admin pages and layouts: any signed-in staff member; redirects to the login when signed out. */
export async function requireStaff(): Promise<SessionUser> {
  const staff = await getStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}

/** For ADMIN-only pages: signed-out users go to the login, supervisors back to the dashboard. */
export async function requireAdmin(): Promise<SessionUser> {
  const staff = await requireStaff();
  if (staff.role !== "ADMIN") redirect("/admin");
  return staff;
}

/** For server actions and route handlers: any staff member; throws instead of redirecting. */
export async function assertStaff(): Promise<SessionUser> {
  const staff = await getStaff();
  if (!staff) throw new AuthError("Your session has ended. Please sign in again.");
  return staff;
}

/** For server actions that only an ADMIN may run. */
export async function assertAdmin(): Promise<SessionUser> {
  const staff = await assertStaff();
  if (staff.role !== "ADMIN") throw new AuthError("Only an administrator can do that.");
  return staff;
}

/** Fine-grained check for actions whose requirement depends on the input (e.g. cancelling *with* a refund). */
export async function assertPermission(permission: Permission, message?: string): Promise<SessionUser> {
  const staff = await assertStaff();
  if (!can(staff.role, permission)) throw new AuthError(message ?? "Your role isn't allowed to do that.");
  return staff;
}
