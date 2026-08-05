"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Inquiry = {
  id: string;
  applicantName: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  classApplyingForId: string;
  stage: string;
  source: string | null;
};
type Class = { id: string; name: string };
type Section = { id: string; name: string; capacity: number; enrolled: number; classId: string };

const STAGES = ["inquiry", "applicant", "interview", "admitted", "rejected", "waitlisted"] as const;

const STAGE_STYLE: Record<string, string> = {
  inquiry: "bg-info-soft text-info",
  applicant: "bg-info-soft text-info",
  interview: "bg-warning-soft text-warning",
  admitted: "bg-accent-soft text-accent",
  enrolled: "bg-success-soft text-success",
  rejected: "bg-critical-soft text-critical",
  waitlisted: "bg-warning-soft text-warning",
};

// Implements Flow 2 (Phase 4): inquiry → (applicant → interview →
// admitted) → the one-action admit → enrolled. Milestone 3's exit
// criteria (Phase 13) is this flow working end to end for a real
// applicant, including the guardian portal invite (shown as a one-time
// temp password here, same pattern as staff invites in Milestone 2).
export default function AdmissionsPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [stageFilter, setStageFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [admittingId, setAdmittingId] = useState<string | null>(null);
  const [chosenSectionId, setChosenSectionId] = useState("");
  const [credentials, setCredentials] = useState<{ role: string; email: string; tempPassword: string }[] | null>(null);

  const [form, setForm] = useState({
    applicantName: "",
    guardianName: "",
    guardianEmail: "",
    guardianPhone: "",
    classApplyingForId: "",
    source: "",
  });

  function refresh() {
    const onLoadError = (err: unknown) => setError(err instanceof Error ? err.message : "Could not load admissions data");
    api.listInquiries(stageFilter || undefined).then((res) => setInquiries(res.inquiries)).catch(onLoadError);
    api.listClasses().then((res) => setClasses(res.classes)).catch(onLoadError);
    api.listSections().then((res) => setSections(res.sections)).catch(onLoadError);
  }
  useEffect(refresh, [stageFilter]);

  const classById = new Map(classes.map((c) => [c.id, c]));

  async function submitInquiry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createInquiry(form);
      setForm({ applicantName: "", guardianName: "", guardianEmail: "", guardianPhone: "", classApplyingForId: "", source: "" });
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create inquiry");
    }
  }

  async function changeStage(inquiryId: string, stage: string) {
    setError(null);
    try {
      await api.updateInquiryStage(inquiryId, stage);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update stage");
    }
  }

  async function confirmAdmit(inquiryId: string) {
    if (!chosenSectionId) return;
    setError(null);
    try {
      const res = await api.admitInquiry(inquiryId, chosenSectionId);
      setCredentials(res.credentials);
      setAdmittingId(null);
      setChosenSectionId("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not admit applicant");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Admissions</h2>
        <button onClick={() => setShowForm((s) => !s)} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white">
          {showForm ? "Cancel" : "New Inquiry"}
        </button>
      </div>

      {credentials && (
        <div className="mt-4 rounded border border-accent bg-accent-soft p-4 text-sm text-ink">
          <p className="font-medium">Enrolled — accounts created:</p>
          <ul className="mt-1 flex flex-col gap-1 text-ink-muted">
            {credentials.map((c) => (
              <li key={c.role}>
                {c.role === "guardian" ? "Guardian" : "Student"} login: <code className="font-mono">{c.email}</code> / temp
                password <code className="font-mono">{c.tempPassword}</code>
              </li>
            ))}
          </ul>
          <button onClick={() => setCredentials(null)} className="mt-2 text-accent underline">
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={submitInquiry} className="mt-4 flex flex-col gap-3 rounded border border-border bg-surface p-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Applicant name" value={form.applicantName} onChange={(v) => setForm((f) => ({ ...f, applicantName: v }))} />
            <label className="flex flex-col gap-1 text-sm text-ink">
              Class applying for
              <select
                required
                value={form.classApplyingForId}
                onChange={(e) => setForm((f) => ({ ...f, classApplyingForId: e.target.value }))}
                className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              >
                <option value="" disabled>
                  Choose…
                </option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Guardian name" value={form.guardianName} onChange={(v) => setForm((f) => ({ ...f, guardianName: v }))} />
            <TextField label="Guardian phone" value={form.guardianPhone} onChange={(v) => setForm((f) => ({ ...f, guardianPhone: v }))} />
            <TextField
              label="Guardian email"
              type="email"
              value={form.guardianEmail}
              onChange={(v) => setForm((f) => ({ ...f, guardianEmail: v }))}
            />
            <TextField label="Source (optional)" required={false} value={form.source} onChange={(v) => setForm((f) => ({ ...f, source: v }))} />
          </div>
          {error && <p className="text-sm text-critical">{error}</p>}
          <button type="submit" className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white">
            Create inquiry
          </button>
        </form>
      )}

      <div className="mt-6 flex gap-1">
        <button
          onClick={() => setStageFilter("")}
          className={`rounded px-2.5 py-1 text-xs font-medium ${stageFilter === "" ? "bg-accent-soft text-accent" : "text-ink-muted"}`}
        >
          All
        </button>
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStageFilter(s)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${stageFilter === s ? "bg-accent-soft text-accent" : "text-ink-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && !showForm && <p className="mt-3 text-sm text-critical">{error}</p>}

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-ink-muted">
            <th className="py-2 font-medium">Applicant</th>
            <th className="py-2 font-medium">Class</th>
            <th className="py-2 font-medium">Stage</th>
            <th className="py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {inquiries.map((inq) => (
            <tr key={inq.id} className="border-b border-border align-top">
              <td className="py-3">
                <div className="text-ink">{inq.applicantName}</div>
                <div className="text-ink-muted">{inq.guardianName}</div>
              </td>
              <td className="py-3 text-ink-muted">{classById.get(inq.classApplyingForId)?.name ?? "—"}</td>
              <td className="py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[inq.stage] ?? ""}`}>{inq.stage}</span>
              </td>
              <td className="py-3">
                {inq.stage !== "enrolled" && inq.stage !== "rejected" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => e.target.value && changeStage(inq.id, e.target.value)}
                      className="rounded border border-border bg-bg px-2 py-1 text-xs text-ink outline-none"
                    >
                      <option value="">Move to…</option>
                      {STAGES.filter((s) => s !== inq.stage).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    {admittingId === inq.id ? (
                      <span className="flex items-center gap-1">
                        <select
                          value={chosenSectionId}
                          onChange={(e) => setChosenSectionId(e.target.value)}
                          className="rounded border border-border bg-bg px-2 py-1 text-xs text-ink outline-none"
                        >
                          <option value="">Section…</option>
                          {sections
                            .filter((s) => s.classId === inq.classApplyingForId)
                            .map((s) => (
                              <option key={s.id} value={s.id} disabled={s.enrolled >= s.capacity}>
                                {s.name} ({s.enrolled}/{s.capacity})
                              </option>
                            ))}
                        </select>
                        <button onClick={() => confirmAdmit(inq.id)} className="text-accent underline">
                          Confirm
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setAdmittingId(inq.id);
                          setChosenSectionId("");
                        }}
                        className="text-accent underline"
                      >
                        Admit
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {inquiries.length === 0 && <p className="mt-4 text-sm text-ink-muted">No inquiries yet.</p>}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink">
      {label}
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
      />
    </label>
  );
}
