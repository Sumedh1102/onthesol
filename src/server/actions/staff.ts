"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { STAFF_ROLES } from "@/lib/permissions";
import { emailSchema, nameSchema, newPasswordSchema, uuid } from "@/lib/validation";
import { assertAdmin } from "@/server/auth/guards";
import { changeStaffRole, createStaff, resetStaffPassword, setStaffActive } from "@/server/services/staff";
import { formObject, toActionError, type ActionResult } from "./result";

/** Staff management. Every action here is ADMIN-only and checks the role on the server. */

const roleSchema = z.enum(STAFF_ROLES, { error: "Choose a role" });

const createSchema = z.object({ name: nameSchema, email: emailSchema, password: newPasswordSchema, role: roleSchema });

export async function createStaffAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const input = createSchema.parse(formObject(formData));
    await createStaff(input, admin.id);
    revalidatePath("/admin/staff");
    return { ok: true, message: `${input.name} can now sign in at /admin/login as ${input.role === "ADMIN" ? "an administrator" : "a supervisor"}.` };
  } catch (err) {
    return toActionError(err);
  }
}

const roleChangeSchema = z.object({ userId: uuid, role: roleSchema });

export async function changeStaffRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const input = roleChangeSchema.parse(formObject(formData));
    await changeStaffRole(input.userId, input.role, admin.id);
    revalidatePath("/admin/staff");
    return { ok: true, message: "Role updated. Their sessions were signed out." };
  } catch (err) {
    return toActionError(err);
  }
}

const activeSchema = z.object({ userId: uuid, active: z.enum(["yes", "no"]) });

export async function setStaffActiveAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const input = activeSchema.parse(formObject(formData));
    await setStaffActive(input.userId, input.active === "yes", admin.id);
    revalidatePath("/admin/staff");
    return { ok: true, message: input.active === "yes" ? "Account activated." : "Account deactivated and signed out." };
  } catch (err) {
    return toActionError(err);
  }
}

const resetSchema = z.object({ userId: uuid, password: newPasswordSchema });

export async function resetStaffPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const input = resetSchema.parse(formObject(formData));
    await resetStaffPassword(input.userId, input.password, admin.id);
    revalidatePath("/admin/staff");
    return { ok: true, message: "Password reset. They were signed out everywhere." };
  } catch (err) {
    return toActionError(err);
  }
}
