/**
 * Staff roles and what each may do. Pure (no database, no server-only), so the proxy, server
 * guards and client navigation all share one definition. The server enforces these in
 * src/server/auth/guards.ts; hiding a button is never the protection.
 */
export const STAFF_ROLES = ["ADMIN", "SUPERVISOR"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = { ADMIN: "Administrator", SUPERVISOR: "Supervisor" };

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

const SUPERVISOR_PERMISSIONS = [
  "dashboard.view",
  "bookings.view",
  "bookings.cancel", // without a refund
  "courts.view",
  "courts.block",
  "payments.view", // read-only
  "account.password",
] as const;

const ADMIN_ONLY_PERMISSIONS = [
  "bookings.refund",
  "courts.edit", // court status, copy and hourly/monthly prices
  "hours.edit",
  "staff.manage",
  "activity.view",
] as const;

export type Permission = (typeof SUPERVISOR_PERMISSIONS)[number] | (typeof ADMIN_ONLY_PERMISSIONS)[number];

const GRANTS: Record<StaffRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([...SUPERVISOR_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS]),
  SUPERVISOR: new Set<Permission>(SUPERVISOR_PERMISSIONS),
};

/** True when `role` (a staff role, or anything else, which has no access) holds `permission`. */
export function can(role: unknown, permission: Permission): boolean {
  return isStaffRole(role) && GRANTS[role].has(permission);
}

export type NavItem = { href: string; label: string; icon: "overview" | "bookings" | "courts" | "payments" | "staff" | "activity" | "account"; permission: Permission };

/** Sidebar entries in display order; an entry shows only for roles holding its permission. */
export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin", label: "Overview", icon: "overview", permission: "dashboard.view" },
  { href: "/admin/bookings", label: "Bookings", icon: "bookings", permission: "bookings.view" },
  { href: "/admin/courts", label: "Courts", icon: "courts", permission: "courts.view" },
  { href: "/admin/payments", label: "Payments", icon: "payments", permission: "payments.view" },
  { href: "/admin/staff", label: "Staff Management", icon: "staff", permission: "staff.manage" },
  { href: "/admin/activity", label: "Activity Log", icon: "activity", permission: "activity.view" },
  { href: "/admin/account", label: "Account", icon: "account", permission: "account.password" },
];

export function navFor(role: unknown): NavItem[] {
  return ADMIN_NAV.filter((item) => can(role, item.permission));
}

/** Route prefixes only some roles may open (checked optimistically by the proxy, authoritatively by the pages). */
export const ADMIN_ONLY_PATHS = ["/admin/staff", "/admin/activity"] as const;

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
