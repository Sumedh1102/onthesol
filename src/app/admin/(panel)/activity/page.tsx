import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/page-header";
import { Pagination } from "@/components/admin/pagination";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { actionLabel, AUDIT_ACTIONS, AUDIT_MODULES, moduleLabel, summarizeAuditMeta } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type StaffRole } from "@/lib/permissions";
import { requireAdmin } from "@/server/auth/guards";
import { listActivity } from "@/server/queries/admin";
import { listStaff } from "@/server/services/staff";

export const metadata = { title: "Activity Log" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function AdminActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = {
    q: one(sp.q)?.slice(0, 100),
    user: one(sp.user),
    role: one(sp.role),
    module: one(sp.module),
    action: one(sp.action),
    from: one(sp.from),
    to: one(sp.to),
  };
  const page = Number(one(sp.page) ?? 1) || 1;
  const [result, staff] = await Promise.all([listActivity({ ...filters, page }), listStaff()]);
  const hrefFor = (p: number) => `/admin/activity?${new URLSearchParams(Object.entries({ ...filters, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  const actions = Object.entries(AUDIT_ACTIONS).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Everything that happens in the application: staff actions, customer bookings and payments, and automatic system events. Newest first. Passwords, tokens and payment secrets are never recorded."
      />

      <form method="get" role="search" className="mb-5 grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2 lg:col-span-4">
          <span className="sr-only">Search activity</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <Input name="q" defaultValue={filters.q} placeholder="Search activity, booking code, receipt, name or email" className="h-11 pl-10" />
        </label>
        <label>
          <span className="mb-1 block text-xs text-subtle">User</span>
          <Select name="user" defaultValue={filters.user ?? ""} className="h-11">
            <option value="">Everyone</option>
            <option value="system">System / customers</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-subtle">Role</span>
          <Select name="role" defaultValue={filters.role ?? ""} className="h-11">
            <option value="">All roles</option>
            <option value="ADMIN">Administrator</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="SYSTEM">System</option>
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-subtle">Module</span>
          <Select name="module" defaultValue={filters.module ?? ""} className="h-11">
            <option value="">All modules</option>
            {AUDIT_MODULES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-subtle">Activity type</span>
          <Select name="action" defaultValue={filters.action ?? ""} className="h-11">
            <option value="">All activity</option>
            {actions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-subtle">From</span>
          <Input type="date" name="from" defaultValue={filters.from} className="h-11" />
        </label>
        <label>
          <span className="mb-1 block text-xs text-subtle">To</span>
          <Input type="date" name="to" defaultValue={filters.to} className="h-11" />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2">
          <button type="submit" className={buttonClass({ variant: "dark" }, "h-11 flex-1")}>
            Filter
          </button>
          <Link href="/admin/activity" className={buttonClass({ variant: "ghost" }, "h-11")}>
            Clear
          </Link>
        </div>
      </form>

      <Panel>
        {result.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-subtle">
                  {["Date & Time", "User", "Role", "Activity", "Module", "Details"].map((h) => (
                    <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-5 py-3 whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</td>
                    <td className="px-5 py-3">
                      {r.actorId ? (
                        <>
                          <span className="font-medium">{r.actorName ?? "Deleted user"}</span>
                          {r.actorEmail ? <span className="block text-xs text-muted">{r.actorEmail}</span> : null}
                        </>
                      ) : (
                        <span className="text-muted">System</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {r.role === "ADMIN" || r.role === "SUPERVISOR" ? (
                        <Badge tone={r.role === "ADMIN" ? "dark" : "info"}>{ROLE_LABELS[r.role as StaffRole]}</Badge>
                      ) : r.actorId ? (
                        <Badge>{r.role ?? "—"}</Badge>
                      ) : (
                        <Badge>System</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 font-medium">{actionLabel(r.action)}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-muted">{moduleLabel(r.action)}</td>
                    <td className="max-w-md px-5 py-3 break-words text-muted">{summarizeAuditMeta(r.meta) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted">No activity matches these filters.</p>
        )}
        <div className="border-t border-line">
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />
        </div>
      </Panel>
    </>
  );
}
