"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutDashboard, Menu, X, LogOut } from "lucide-react";
import { logout } from "@/app/logout/actions";

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const nav = <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2.5 text-sm font-medium text-sidebar-accent-foreground"><LayoutDashboard data-icon="inline-start" />Overview</Link>;
  return <div className="min-h-screen bg-background md:flex"><aside className="hidden w-64 shrink-0 border-r bg-sidebar p-5 md:block"><Brand /> <nav className="mt-8 flex flex-col gap-2">{nav}</nav></aside><div className="flex min-h-screen min-w-0 flex-1 flex-col"><header className="flex h-16 items-center justify-between border-b px-4 sm:px-6"><button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-md p-2 hover:bg-accent md:hidden"><Menu /></button><div className="hidden text-sm font-semibold md:block">Admin workspace</div><div className="flex items-center gap-3"><span className="max-w-[180px] truncate text-sm text-muted-foreground">{email}</span><form action={logout}><button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"><LogOut data-icon="inline-start" />Sign out</button></form></div></header><main className="flex-1 p-4 sm:p-6">{children}</main></div>{open && <div className="fixed inset-0 z-50 bg-background md:hidden"><div className="flex items-center justify-between border-b p-4"><Brand /><button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-accent"><X /></button></div><nav className="flex flex-col gap-2 p-4">{nav}</nav></div>}</div>;
}
function Brand() { return <Link href="/admin" className="flex items-center gap-3 text-lg font-bold"><span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">P</span>PastQ Bank</Link>; }
