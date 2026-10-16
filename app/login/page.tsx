"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    params.get("error") === "not-admin" ? "This account is not an approved administrator." : "",
  );
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { error: authError } = await createBrowserSupabaseClient().auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message.toLowerCase().includes("confirm") ? "Confirm your email before signing in." : "Invalid email or password.");
      setLoading(false);
      return;
    }
    router.push("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-8">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">P</div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to the PastQ Bank admin workspace.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm font-medium">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-md border bg-background px-3 font-normal outline-none ring-offset-background focus:ring-2 focus:ring-ring" /></label>
          <label className="flex flex-col gap-2 text-sm font-medium">Password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-md border bg-background px-3 font-normal outline-none ring-offset-background focus:ring-2 focus:ring-ring" /></label>
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <button disabled={loading} type="submit" className="h-11 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">{loading ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-muted/30 p-4" aria-busy="true">Loading…</main>}><LoginForm /></Suspense>;
}
