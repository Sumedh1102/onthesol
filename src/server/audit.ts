import "server-only";
import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { sanitizeAuditMeta } from "@/lib/audit";

/**
 * Records one activity in `audit_logs` (shown to administrators at /admin/activity).
 *
 * Best-effort: a failure is logged and swallowed, never thrown, so an audit problem can't break a
 * booking or payment. Pass `conn` when called inside a transaction: the insert then runs in a
 * savepoint, so a failed insert can't abort the surrounding transaction, and the event disappears
 * if that transaction rolls back (it never happened).
 *
 * `actorId` is null for customer-originated and system events. The actor's role is captured at
 * insert time, so later role changes don't rewrite history. Metadata is stripped of passwords,
 * tokens, signatures and other secrets before it is stored.
 */
export async function audit(
  actorId: string | null | undefined,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: Record<string, unknown>,
  conn?: DbOrTx,
) {
  try {
    const values = {
      actorId: actorId ?? null,
      actorRole: actorId ? sql<string>`(select "role"::text from "users" where "id" = ${actorId}::uuid)` : null,
      action: action.slice(0, 80),
      entity: entity.slice(0, 60),
      entityId: entityId?.slice(0, 60) ?? null,
      meta: sanitizeAuditMeta(meta),
    };
    if (conn) await conn.transaction((sp) => sp.insert(auditLogs).values(values));
    else await db.insert(auditLogs).values(values);
  } catch (err) {
    console.error("[audit] failed", err);
  }
}
