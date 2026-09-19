"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      router.push(params.get("next") || "/calendar");
      router.refresh();
    } else {
      const body = await response.json().catch(() => ({ error: "Login failed" }));
      setError(body.error ?? "Login failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Cadence</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Content calendar and publisher.
      </p>

      <label className="label mt-6" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        className="field"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button type="submit" className="btn-primary mt-4 w-full" disabled={busy || !password}>
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
