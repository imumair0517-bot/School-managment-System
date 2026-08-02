// Phase 8's typed API client, minimal version for M0. Talks to apps/api.
// In dev, tenant resolution (Phase 8 §2 / Phase 9 §2.1) is stood in for by
// a header rather than a real subdomain, since `{subdomain}.localhost`
// needs DNS/hosts-file setup this repo doesn't assume — see
// apps/api/src/middleware/tenant-resolution.ts for the matching dev note.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const DEV_TENANT_SUBDOMAIN = process.env.NEXT_PUBLIC_DEV_TENANT ?? "greenvalley";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // Fastify's default JSON parser rejects an application/json request
      // with an empty body (e.g. logout, which has no payload) — only set
      // this header when there's actually a body to parse.
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-dev-tenant": DEV_TENANT_SUBDOMAIN,
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message ?? "Something went wrong";
    throw new Error(message);
  }
  return body;
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => apiFetch("/v1/me"),
  logout: () => apiFetch("/v1/auth/logout", { method: "POST" }),
};
