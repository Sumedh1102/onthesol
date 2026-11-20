import { describe, expect, it } from "vitest";
import { staffChangeError, type StaffTarget } from "./staff-rules";

const me = "me";
const admin = (id: string, isActive = true): StaffTarget => ({ id, role: "ADMIN", isActive });
const supervisor = (id: string, isActive = true): StaffTarget => ({ id, role: "SUPERVISOR", isActive });

describe("staffChangeError", () => {
  it("allows promoting, demoting and deactivating someone else", () => {
    expect(staffChangeError(me, supervisor("s"), { type: "role", role: "ADMIN" }, 1)).toBeNull();
    expect(staffChangeError(me, admin("a"), { type: "role", role: "SUPERVISOR" }, 1)).toBeNull();
    expect(staffChangeError(me, supervisor("s"), { type: "active", active: false }, 1)).toBeNull();
    expect(staffChangeError(me, supervisor("s", false), { type: "active", active: true }, 1)).toBeNull();
  });

  it("refuses self-demotion and self-deactivation", () => {
    expect(staffChangeError(me, admin(me), { type: "role", role: "SUPERVISOR" }, 3)).toMatch(/own role/);
    expect(staffChangeError(me, admin(me), { type: "active", active: false }, 3)).toMatch(/own account/);
  });

  it("refuses to remove the last active administrator", () => {
    expect(staffChangeError(me, admin("a"), { type: "role", role: "SUPERVISOR" }, 0)).toMatch(/last active administrator/);
    expect(staffChangeError(me, admin("a"), { type: "active", active: false }, 0)).toMatch(/last active administrator/);
  });

  it("only protects administrators from the last-admin rule", () => {
    expect(staffChangeError(me, supervisor("s"), { type: "active", active: false }, 0)).toBeNull();
    expect(staffChangeError(me, admin("a", false), { type: "role", role: "SUPERVISOR" }, 0)).toBeNull();
  });

  it("rejects no-op changes", () => {
    expect(staffChangeError(me, admin("a"), { type: "role", role: "ADMIN" }, 2)).toMatch(/already/);
    expect(staffChangeError(me, admin("a"), { type: "active", active: true }, 2)).toMatch(/already active/);
    expect(staffChangeError(me, admin("a", false), { type: "active", active: false }, 2)).toMatch(/already deactivated/);
  });
});
