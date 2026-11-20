"use client";

import { useActionState, useEffect, useState } from "react";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { changeStaffRoleAction, createStaffAction, resetStaffPasswordAction, setStaffActiveAction } from "@/server/actions/staff";
import { FormMessage, fieldError } from "./form-message";

export type StaffRow = { id: string; name: string; email: string; role: StaffRole; isActive: boolean };

export function CreateStaffForm() {
  const [state, dispatch, pending] = useActionState(createStaffAction, null);
  return (
    <form key={state?.ok ? "created" : "form"} onSubmit={submitWithoutReset(dispatch)} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <Field id="staff-name" label="Full name" error={fieldError(state, "name")}>
        <Input id="staff-name" name="name" autoComplete="off" required />
      </Field>
      <Field id="staff-email" label="Email" hint="They sign in with this address." error={fieldError(state, "email")}>
        <Input id="staff-email" name="email" type="email" autoComplete="off" required />
      </Field>
      <Field id="staff-password" label="Initial password" hint="At least 12 characters. Share it securely; they can change it under Account." error={fieldError(state, "password")}>
        <Input id="staff-password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <Field id="staff-role" label="Role" error={fieldError(state, "role")}>
        <Select id="staff-role" name="role" defaultValue="SUPERVISOR">
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="dark" disabled={pending}>
          {pending ? <Spinner /> : null} Create account
        </Button>
      </div>
    </form>
  );
}

type Pending = { kind: "role"; role: StaffRole } | { kind: "active"; active: boolean } | { kind: "password" } | null;

/** One table row's actions. Every sensitive change asks for confirmation first. */
export function StaffActions({ member, isSelf }: { member: StaffRow; isSelf: boolean }) {
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const otherRole: StaffRole = member.role === "ADMIN" ? "SUPERVISOR" : "ADMIN";

  return (
    <div className="flex flex-wrap gap-2">
      {!isSelf ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setPending({ kind: "role", role: otherRole })}>
            Make {ROLE_LABELS[otherRole]}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPending({ kind: "active", active: !member.isActive })}>
            {member.isActive ? "Deactivate" : "Activate"}
          </Button>
        </>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => setPending({ kind: "password" })}>
        Reset password
      </Button>
      {isSelf ? <span className="self-center text-xs text-subtle">This is you</span> : null}

      {pending?.kind === "role" ? <RoleDialog member={member} role={pending.role} onClose={close} /> : null}
      {pending?.kind === "active" ? <ActiveDialog member={member} active={pending.active} onClose={close} /> : null}
      {pending?.kind === "password" ? <PasswordDialog member={member} onClose={close} /> : null}
    </div>
  );
}

/** Runs a server action from a confirm dialog; shows its error, or closes on success. */
function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  action,
  fields,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  action: (prev: null | { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }, fd: FormData) => Promise<{ ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }>;
  fields: Record<string, string>;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(onClose, 900);
      return () => clearTimeout(t);
    }
  }, [state, onClose]);
  return (
    <Dialog open onClose={onClose} title={title} description={description} dismissible={!pending} className="sm:w-[min(30rem,calc(100vw-2rem))]">
      <form onSubmit={submitWithoutReset(dispatch)} className="space-y-4" noValidate>
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {state ? (
          <p role="status" className={state.ok ? "text-sm text-success" : "text-sm text-danger"}>
            {state.ok ? (state.message ?? "Done.") : state.error}
          </p>
        ) : null}
        {children ? <div className="surface-light rounded-xl bg-paper p-4 text-ink">{children}</div> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghostLight" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending || !!state?.ok}>
            {pending ? <Spinner /> : null} {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RoleDialog({ member, role, onClose }: { member: StaffRow; role: StaffRole; onClose: () => void }) {
  return (
    <ConfirmDialog
      title="Change role?"
      description={`${member.name} will become ${role === "ADMIN" ? "an administrator with full access, including refunds, pricing, staff and the activity log" : "a supervisor without access to refunds, pricing, booking hours, staff or the activity log"}. They are signed out of every session and must sign in again.`}
      confirmLabel={`Make ${ROLE_LABELS[role]}`}
      danger={role === "SUPERVISOR"}
      action={changeStaffRoleAction}
      fields={{ userId: member.id, role }}
      onClose={onClose}
    />
  );
}

function ActiveDialog({ member, active, onClose }: { member: StaffRow; active: boolean; onClose: () => void }) {
  return (
    <ConfirmDialog
      title={active ? "Activate account?" : "Deactivate account?"}
      description={active ? `${member.name} will be able to sign in again.` : `${member.name} will be signed out everywhere and can't sign in until you activate the account again.`}
      confirmLabel={active ? "Activate" : "Deactivate"}
      danger={!active}
      action={setStaffActiveAction}
      fields={{ userId: member.id, active: active ? "yes" : "no" }}
      onClose={onClose}
    />
  );
}

function PasswordDialog({ member, onClose }: { member: StaffRow; onClose: () => void }) {
  const [password, setPassword] = useState("");
  return (
    <ConfirmDialog
      title="Reset password?"
      description={`Set a new password for ${member.name}. They are signed out everywhere and must use it to sign in.`}
      confirmLabel="Reset password"
      action={resetStaffPasswordAction}
      fields={{ userId: member.id, password }}
      onClose={onClose}
    >
      <Field id={`reset-${member.id}`} label="New password" hint="At least 12 characters.">
        <Input id={`reset-${member.id}`} type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
    </ConfirmDialog>
  );
}
