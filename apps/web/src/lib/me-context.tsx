"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api-client";

type PermissionLevel = "none" | "read" | "write";

export type Me = {
  user: { id: string; fullName: string; email: string; role: string };
  tenant: { id: string; name: string; subdomain: string };
  permissions: Record<string, PermissionLevel>;
};

const MeContext = createContext<Me | null>(null);

// Shared across every page under dashboard/ so each one doesn't
// re-implement "am I logged in, what can I see" — one fetch, one redirect
// rule, consumed via useMe() (Phase 8's server-component-by-default
// approach applies once these pages have real server-fetched data; this
// stays client-fetched for now, same tradeoff as Milestone 0's dashboard).
export function MeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return null;
  if (!me) return null;

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() used outside <MeProvider>");
  return me;
}
