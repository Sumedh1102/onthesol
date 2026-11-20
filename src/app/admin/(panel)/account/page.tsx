import { PageHeader, Panel } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/permissions";
import { PasswordForm } from "@/components/admin/password-form";
import { requireStaff } from "@/server/auth/guards";

export const metadata = { title: "Account" };

export default async function AdminAccountPage() {
  const admin = await requireStaff();
  return (
    <>
      <PageHeader title="Account" description={
          <>
            Signed in as {admin.name} ({admin.email}){" "}
            <Badge tone={admin.role === "ADMIN" ? "dark" : "info"} className="ml-1 align-middle">
              {ROLE_LABELS[admin.role]}
            </Badge>
          </>
        }
      />
      <Panel title="Change password">
        <div className="p-5">
          <PasswordForm />
        </div>
      </Panel>
      {admin.role === "ADMIN" ? (
      <p className="mt-6 max-w-2xl text-sm text-muted">
        Create, deactivate and re-role staff accounts under <a href="/admin/staff" className="font-semibold text-neon-ink hover:underline">Staff Management</a>. The first administrator can also be managed from the server: <code className="rounded bg-paper-2 px-1.5 py-0.5 text-xs">npm run admin -- create &lt;email&gt; &quot;Name&quot;</code>,{" "}
        <code className="rounded bg-paper-2 px-1.5 py-0.5 text-xs">password &lt;email&gt;</code> or <code className="rounded bg-paper-2 px-1.5 py-0.5 text-xs">deactivate &lt;email&gt;</code>. There is no public sign-up.
      </p>
      ) : (
        <p className="mt-6 max-w-2xl text-sm text-muted">Your account is managed by an administrator. Ask them if your role or access needs to change.</p>
      )}
    </>
  );
}
