import { PageHeader, Panel } from "@/components/admin/page-header";
import { CreateStaffForm, StaffActions } from "@/components/admin/staff-forms";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { requireAdmin } from "@/server/auth/guards";
import { listStaff } from "@/server/services/staff";

export const metadata = { title: "Staff Management" };

export default async function AdminStaffPage() {
  const admin = await requireAdmin();
  const staff = await listStaff();
  const activeAdmins = staff.filter((s) => s.role === "ADMIN" && s.isActive).length;

  return (
    <>
      <PageHeader
        eyebrow="Administrators only"
        title="Staff Management"
        description={
          <>
            Create accounts for the people who run the academy. <strong>Administrators</strong> have full control. <strong>Supervisors</strong> handle day-to-day bookings and court blocks, but can&apos;t refund, change prices or hours, manage staff or open the activity log. There is no public sign-up.
          </>
        }
      />

      <Panel title={`Staff accounts (${staff.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                {["Name", "Email", "Role", "Account status", "Last login", "Actions"].map((h) => (
                  <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {staff.map((s) => (
                <tr key={s.id} className="align-middle">
                  <td className="px-5 py-3 font-medium">{s.name}</td>
                  <td className="px-5 py-3 break-all text-muted">{s.email}</td>
                  <td className="px-5 py-3">
                    <Badge tone={s.role === "ADMIN" ? "dark" : "info"}>{ROLE_LABELS[s.role]}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? "Active" : "Deactivated"}</Badge>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted">{s.lastLoginAt ? formatDateTime(s.lastLoginAt) : "Never"}</td>
                  <td className="px-5 py-3">
                    <StaffActions member={{ id: s.id, name: s.name, email: s.email, role: s.role, isActive: s.isActive }} isSelf={s.id === admin.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-subtle">
          {activeAdmins} active {activeAdmins === 1 ? "administrator" : "administrators"}. The last active administrator and your own account can&apos;t be deactivated or demoted.
        </p>
      </Panel>

      <Panel title="Add a staff account" className="mt-6">
        <CreateStaffForm />
      </Panel>
    </>
  );
}
