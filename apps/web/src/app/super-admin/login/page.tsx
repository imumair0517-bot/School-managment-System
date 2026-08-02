"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

// Separate, not-tenant-branded route tree (Phase 8 §2) for the platform
// operator — a different login entirely from the school login, backed by
// a different token space (Phase 9 §11).
export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.adminLogin(email, password);
      router.push("/super-admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-ink">Platform Admin</h1>
        <p className="mt-1 text-sm text-ink-muted">Not a school login — this is the operator console.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          {error && <p className="text-sm text-critical">{error}</p>}
          <button type="submit" className="mt-2 rounded bg-ink px-4 py-2 text-sm font-medium text-white">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
