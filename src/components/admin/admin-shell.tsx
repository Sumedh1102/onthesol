"use client";

import { CalendarDays, CreditCard, LayoutDashboard, LogOut, Menu, ScrollText, SquareStack, UserRound, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { navFor, ROLE_LABELS, type NavItem, type StaffRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ICONS: Record<NavItem["icon"], typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  bookings: CalendarDays,
  courts: SquareStack,
  payments: CreditCard,
  staff: Users,
  activity: ScrollText,
  account: UserRound,
};

/** The sidebar only lists what the signed-in role may open; the server enforces the same rules. */
export function AdminShell({ adminName, role, logout, children }: { adminName: string; role: StaffRole; logout: () => Promise<void>; children: ReactNode }) {
  const items = navFor(role);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  const nav = (
    <nav aria-label="Admin" className="flex flex-1 flex-col">
      <ul className="space-y-1">
        {items.map(({ href, label, icon }) => {
          const Icon = ICONS[icon];
          return (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                isActive(href) ? "bg-white/10 text-white" : "text-ink-muted hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon aria-hidden className={cn("size-[1.1rem]", isActive(href) && "text-neon")} />
              {label}
            </Link>
          </li>
          );
        })}
      </ul>
      <div className="mt-auto border-t border-white/10 pt-4">
        <p className="px-3.5 text-xs text-ink-muted">Signed in as</p>
        <p className="truncate px-3.5 text-sm font-semibold text-white">{adminName}</p>
        <p className="px-3.5 pt-0.5 text-xs font-semibold text-neon" data-testid="staff-role">
          {ROLE_LABELS[role]}
        </p>
        <form action={logout} className="mt-3">
          <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-white/5 hover:text-white">
            <LogOut aria-hidden className="size-[1.1rem]" /> Sign out
          </button>
        </form>
        <Link href="/" className="mt-1 block rounded-xl px-3.5 py-2 text-xs text-ink-muted hover:text-white">
          View public site ↗
        </Link>
      </div>
    </nav>
  );

  return (
    <div data-admin-shell className="min-h-dvh bg-paper lg:grid lg:grid-cols-[16rem_1fr] lg:bg-ink">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-ink px-4 py-6 lg:flex">
        <Link href="/admin" className="mb-8 px-2">
          <Wordmark />
          <span className="eyebrow mt-3 block text-[0.62rem] text-ink-muted">{role === "ADMIN" ? "Admin dashboard" : "Staff dashboard"}</span>
        </Link>
        {nav}
      </aside>

      <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-ink px-4 lg:hidden">
        <Link href="/admin">
          <Wordmark />
        </Link>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="admin-menu" aria-label={open ? "Close menu" : "Open menu"} className="grid size-11 place-items-center rounded-full text-white hover:bg-white/10">
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </header>
      <div id="admin-menu" hidden={!open} className="fixed inset-x-0 top-16 bottom-0 z-40 flex flex-col overflow-y-auto bg-ink px-4 py-6 lg:hidden">
        {nav}
      </div>

      <main id="main" className="surface-light min-w-0 bg-paper px-4 py-8 text-ink sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
