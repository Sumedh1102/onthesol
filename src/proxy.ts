import { NextResponse, type NextRequest } from "next/server";
import { isAdminOnlyPath, isStaffRole } from "@/lib/permissions";
import { SESSION_COOKIE, verifySessionToken } from "@/server/auth/jwt";

/**
 * Optimistic protection for /admin: verifies the signed session token only (no database) so it
 * stays fast. Staff (ADMIN or SUPERVISOR) may enter; supervisors are turned away from the
 * admin-only sections early. Every admin page and server action re-checks the session and the
 * role against the database (server/auth/guards.ts) before touching data.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();
  const claims = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!claims || !isStaffRole(claims.role)) return NextResponse.redirect(new URL("/admin/login", request.url));
  if (claims.role !== "ADMIN" && isAdminOnlyPath(pathname)) return NextResponse.redirect(new URL("/admin", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
