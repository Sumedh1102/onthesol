import { describe, expect, it } from "vitest";
import { can, isAdminOnlyPath, isStaffRole, navFor, type Permission } from "./permissions";

const ADMIN_ONLY: Permission[] = ["bookings.refund", "courts.edit", "hours.edit", "staff.manage", "activity.view"];
const SHARED: Permission[] = ["dashboard.view", "bookings.view", "bookings.cancel", "courts.view", "courts.block", "payments.view", "account.password"];

describe("roles and permissions", () => {
  it("lets an administrator do everything", () => {
    for (const p of [...ADMIN_ONLY, ...SHARED]) expect(can("ADMIN", p), p).toBe(true);
  });

  it("gives a supervisor the day-to-day operations only", () => {
    for (const p of SHARED) expect(can("SUPERVISOR", p), p).toBe(true);
    for (const p of ADMIN_ONLY) expect(can("SUPERVISOR", p), p).toBe(false);
  });

  it("gives legacy and unknown roles nothing — MANAGER is not SUPERVISOR", () => {
    for (const role of ["MANAGER", "COACH", "RECEPTION", "CUSTOMER", "", null, undefined, "admin"]) {
      expect(isStaffRole(role)).toBe(false);
      for (const p of [...ADMIN_ONLY, ...SHARED]) expect(can(role, p)).toBe(false);
    }
  });

  it("builds the sidebar from the role", () => {
    expect(navFor("ADMIN").map((n) => n.label)).toEqual(["Overview", "Bookings", "Courts", "Payments", "Staff Management", "Activity Log", "Account"]);
    expect(navFor("SUPERVISOR").map((n) => n.label)).toEqual(["Overview", "Bookings", "Courts", "Payments", "Account"]);
    expect(navFor("MANAGER")).toEqual([]);
  });

  it("marks the staff and activity sections as admin-only paths", () => {
    expect(isAdminOnlyPath("/admin/staff")).toBe(true);
    expect(isAdminOnlyPath("/admin/activity")).toBe(true);
    expect(isAdminOnlyPath("/admin/activity/anything")).toBe(true);
    expect(isAdminOnlyPath("/admin/staffing")).toBe(false);
    expect(isAdminOnlyPath("/admin/bookings")).toBe(false);
  });
});
