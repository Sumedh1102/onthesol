ALTER TYPE "public"."user_role" ADD VALUE 'SUPERVISOR';--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_role" varchar(20);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
UPDATE "audit_logs" SET "actor_role" = "users"."role"::text FROM "users" WHERE "audit_logs"."actor_id" = "users"."id" AND "audit_logs"."actor_role" IS NULL;
