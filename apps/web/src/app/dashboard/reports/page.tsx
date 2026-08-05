"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type FieldDef = { key: string; label: string; type: string };
type FilterOption = { value: string; label: string };
type FilterDef = { key: string; label: string; type: string; options?: FilterOption[] };
type ReportEntity = { key: string; label: string; fields: FieldDef[]; filters: FilterDef[] };

// Filters the registry marks as "select" but doesn't ship static options
// for (they're foreign keys — section/class/exam/subject/session ids) —
// this maps each to the existing list endpoint that already returns
// {id, name} pairs, rather than the API returning raw UUIDs for a picker
// with nothing to label them.
const DYNAMIC_FILTER_SOURCES: Record<string, () => Promise<{ id: string; name: string }[]>> = {
  sectionId: () => api.listSections().then((res) => res.sections.map((s: { id: string; name: string; className: string | null }) => ({ id: s.id, name: `${s.className ?? ""} — ${s.name}` }))),
  classId: () => api.listClasses().then((res) => res.classes),
  academicSessionId: () => api.listAcademicSessions().then((res) => res.sessions),
  examId: () => api.listExams().then((res) => res.exams),
  subjectId: () => api.listSubjects().then((res) => res.subjects),
};

// Milestone 16 (Phase 2 §F): "report builder (choose fields/filters)
// beyond the fixed reports shipped in V1." Pick an entity, tick the
// fields you want, set any filters, run it, export to CSV — all against
// the fixed, allow-listed entity registry the API exposes (apps/api's
// reports/registry.ts), not a free-form query.
export default function ReportsPage() {
  const [entities, setEntities] = useState<ReportEntity[]>([]);
  const [entityKey, setEntityKey] = useState("");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { id: string; name: string }[]>>({});
  const [rows, setRows] = useState<Record<string, string | number | boolean | null>[] | null>(null);
  const [runFields, setRunFields] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listReportEntities()
      .then((res) => setEntities(res.entities))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load report types"));
  }, []);

  const entity = entities.find((e) => e.key === entityKey);

  function chooseEntity(key: string) {
    setEntityKey(key);
    const e = entities.find((en) => en.key === key);
    setSelectedFields(new Set(e?.fields.map((f) => f.key) ?? []));
    setFilterValues({});
    setRows(null);
    setError(null);

    for (const f of e?.filters ?? []) {
      if (!f.options && DYNAMIC_FILTER_SOURCES[f.key] && !dynamicOptions[f.key]) {
        DYNAMIC_FILTER_SOURCES[f.key]()
          .then((opts) => setDynamicOptions((prev) => ({ ...prev, [f.key]: opts })))
          .catch(() => setDynamicOptions((prev) => ({ ...prev, [f.key]: [] })));
      }
    }
  }

  function toggleField(key: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function runReport() {
    if (!entity || selectedFields.size === 0) return;
    setError(null);
    setRunning(true);
    try {
      const filters = Object.fromEntries(Object.entries(filterValues).filter(([, v]) => v));
      const res = await api.runReport({ entity: entity.key, fields: [...selectedFields], filters });
      setRows(res.rows);
      setRunFields(res.fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run this report");
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const header = runFields.join(",");
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((r) => runFields.map((f) => escape(r[f])).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity?.key ?? "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Custom Reports</h2>
      {error && <p className="mt-3 text-sm text-critical">{error}</p>}

      <label className="mt-4 flex w-fit flex-col gap-1 text-sm text-ink">
        Report type
        <select
          value={entityKey}
          onChange={(e) => chooseEntity(e.target.value)}
          className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
        >
          <option value="">Choose a report type…</option>
          {entities.map((e) => (
            <option key={e.key} value={e.key}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      {entity && (
        <>
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Fields</h3>
            <div className="mt-2 flex flex-wrap gap-3">
              {entity.fields.map((f) => (
                <label key={f.key} className="flex items-center gap-1.5 text-sm text-ink">
                  <input type="checkbox" checked={selectedFields.has(f.key)} onChange={() => toggleField(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          {entity.filters.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-ink">Filters</h3>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                {entity.filters.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1 text-sm text-ink">
                    {f.label}
                    {f.type === "date" ? (
                      <input
                        type="date"
                        value={filterValues[f.key] ?? ""}
                        onChange={(e) => setFilterValues({ ...filterValues, [f.key]: e.target.value })}
                        className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <select
                        value={filterValues[f.key] ?? ""}
                        onChange={(e) => setFilterValues({ ...filterValues, [f.key]: e.target.value })}
                        className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                      >
                        <option value="">Any</option>
                        {(f.options ?? dynamicOptions[f.key] ?? []).map((o) =>
                          "value" in o ? (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ) : (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ),
                        )}
                      </select>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={runReport}
            disabled={running || selectedFields.size === 0}
            className="mt-6 rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {running ? "Running…" : "Run report"}
          </button>

          {rows && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink-muted">{rows.length} row(s)</p>
                {rows.length > 0 && (
                  <button onClick={exportCsv} className="text-sm text-accent underline">
                    Export CSV
                  </button>
                )}
              </div>
              {rows.length > 0 ? (
                <div className="mt-2 overflow-x-auto rounded border border-border">
                  <table className="w-full min-w-[480px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface text-left text-ink-muted">
                        {runFields.map((f) => (
                          <th key={f} className="px-3 py-2 font-medium">
                            {entity.fields.find((ef) => ef.key === f)?.label ?? f}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          {runFields.map((f) => (
                            <td key={f} className="px-3 py-2 text-ink">
                              {String(r[f] ?? "—")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">No rows match this filter.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
