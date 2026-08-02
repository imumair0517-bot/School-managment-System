"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

// The Settings hub "skeleton" from Milestone 2 (Phase 13) — one section
// (branding) for now. Grading scheme, billing cycle, and the rest of
// Phase 5 §3.5's tenant_settings get their own sections as their modules
// are built, not stubbed out here ahead of time.
export default function SettingsPage() {
  const me = useMe();
  const canWrite = me.permissions.settings === "write";

  const [logoUrl, setLogoUrl] = useState("");
  const [color, setColor] = useState("#1F6F5C");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // React (Strict Mode, dev only) invokes this effect twice on mount.
    // Without this guard, a slower first fetch resolving *after* the
    // second one — or after the user has already started typing — can
    // clobber real user input with stale server data. `active` is the
    // standard fix: the first invocation's cleanup flips it false before
    // its response ever lands.
    let active = true;
    api.getSettings().then((res) => {
      if (!active) return;
      setLogoUrl(res.brandingLogoUrl ?? "");
      setColor(res.brandingPrimaryColor ?? "#1F6F5C");
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api.updateSettings({ brandingLogoUrl: logoUrl, brandingPrimaryColor: color });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Settings</h2>

      <section className="mt-6 rounded border border-border bg-surface p-6">
        <h3 className="text-sm font-semibold text-ink">Branding</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Shown across your school&apos;s portal — login page, dashboard header, and (later) report cards and
          messages (Phase 11 §7).
        </p>

        <form onSubmit={handleSave} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Logo URL
            <input
              type="url"
              placeholder="https://…"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              disabled={!canWrite || !loaded}
              className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-ink">
            Primary color
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={!canWrite || !loaded}
                className="h-9 w-14 rounded border border-border bg-bg disabled:opacity-60"
              />
              <span className="rounded-full px-3 py-1 text-sm font-medium text-white" style={{ background: color }}>
                Preview
              </span>
            </div>
          </label>

          {error && <p className="text-sm text-critical">{error}</p>}
          {saved && <p className="text-sm text-success">Saved.</p>}

          {canWrite && (
            <button
              type="submit"
              disabled={!loaded}
              className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Save
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
