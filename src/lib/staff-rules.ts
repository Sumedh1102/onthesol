/**
 * Safety rules for changing staff accounts, kept pure so they can be unit-tested and so the
 * database service applies exactly what the tests describe.
 */
import type { StaffRole } from "./permissions";

export type StaffTarget = { id: string; role: StaffRole; isActive: boolean };

export type StaffChange = { type: "role"; role: StaffRole } | { type: "active"; active: boolean };

/**
 * Returns why a change is not allowed, or null when it is.
 * `otherActiveAdmins` is the number of active administrators who can sign in, not counting the target.
 */
export function staffChangeError(actorId: string, target: StaffTarget, change: StaffChange, otherActiveAdmins: number): string | null {
  const self = actorId === target.id;
  if (change.type === "role") {
    if (change.role === target.role) return "That account already has this role.";
    if (self) return "You can't change your own role. Ask another administrator.";
    const losesAdmin = target.role === "ADMIN" && target.isActive;
    if (losesAdmin && otherActiveAdmins < 1) return "This is the last active administrator. Make another account an administrator first.";
    return null;
  }
  if (change.active === target.isActive) return change.active ? "That account is already active." : "That account is already deactivated.";
  if (!change.active) {
    if (self) return "You can't deactivate your own account. Ask another administrator.";
    if (target.role === "ADMIN" && otherActiveAdmins < 1) return "This is the last active administrator. Make another account an administrator first.";
  }
  return null;
}
