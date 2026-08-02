"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setDevTenant } from "@/lib/api-client";

type Phase = "form" | "provisioning" | "ready" | "failed";

// Implements Flow 1 (Phase 4): submit → provisioning (polled, not blocked
// on) → trial. Stands in for the (marketing) route group from Phase 10 §5
// until there's more to a public site than this one form.
export default function SignupPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState({
    schoolName: "",
    subdomain: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    ownerPassword: "",
  });

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function pollStatus(tenantId: string) {
    try {
      const status = await api.signupStatus(tenantId);
      if (status.failed) {
        setPhase("failed");
        setError("Something went wrong while setting up your school. Please try again.");
        return;
      }
      if (status.status === "trial") {
        setDevTenant(status.subdomain);
        setSubdomain(status.subdomain);
        setPhase("ready");
        return;
      }
      pollRef.current = setTimeout(() => pollStatus(tenantId), 1500);
    } catch {
      pollRef.current = setTimeout(() => pollStatus(tenantId), 1500);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.signup(form);
      setPhase("provisioning");
      pollStatus(res.tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    }
  }

  if (phase === "provisioning") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-ink">Setting up {form.schoolName}…</p>
          <p className="mt-1 text-sm text-ink-muted">This usually takes a few seconds.</p>
        </div>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-critical">{error}</p>
          <button onClick={() => setPhase("form")} className="mt-4 text-sm text-accent underline">
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (phase === "ready") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded border border-border bg-surface p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-ink">You&apos;re all set!</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {form.schoolName} is ready, on a 7-day free trial. Sign in with the owner account you just created.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="mt-6 w-full rounded bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Go to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Create your school&apos;s account</h1>
        <p className="mt-1 text-sm text-ink-muted">Free for 7 days, no card required.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field label="School name">
            <input
              value={form.schoolName}
              onChange={update("schoolName")}
              required
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </Field>

          <Field label="Web address">
            <div className="flex items-center overflow-hidden rounded border border-border bg-bg focus-within:border-accent">
              <input
                value={form.subdomain}
                onChange={update("subdomain")}
                required
                pattern="[a-z0-9-]+"
                placeholder="yourschool"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-ink outline-none"
              />
              <span className="whitespace-nowrap px-3 text-sm text-ink-muted">.ourdomain.com</span>
            </div>
          </Field>

          <Field label="Your name">
            <input
              value={form.ownerName}
              onChange={update("ownerName")}
              required
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </Field>

          <Field label="Your email">
            <input
              type="email"
              value={form.ownerEmail}
              onChange={update("ownerEmail")}
              required
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </Field>

          <Field label="Your phone">
            <input
              value={form.ownerPhone}
              onChange={update("ownerPhone")}
              required
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              value={form.ownerPassword}
              onChange={update("ownerPassword")}
              required
              minLength={8}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </Field>

          {error && <p className="text-sm text-critical">{error}</p>}

          <button
            type="submit"
            className="mt-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            Create account
          </button>

          <p className="text-center text-sm text-ink-muted">
            Already have an account?{" "}
            <a href="/login" className="text-accent underline">
              Sign in
            </a>
          </p>
        </form>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink">
      {label}
      {children}
    </label>
  );
}
