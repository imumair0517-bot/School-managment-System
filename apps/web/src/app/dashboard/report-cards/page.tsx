"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useMe } from "@/lib/me-context";

type Exam = { id: string; name: string; term: string | null };
type Section = { id: string; name: string; className: string | null };
type ReportCardSummary = { id: string; studentId: string; studentName: string | null; percentage: number; division: string; status: string };

// The generation → remark review/approve → publish steps of Flow 4 (Phase
// 4), built on top of the marks entered on /dashboard/exams. Publish is
// restricted to non-teacher roles here as a UX courtesy — the API enforces
// the real boundary regardless (apps/api/src/modules/report-cards).
export default function ReportCardsPage() {
  const me = useMe();
  const [exams, setExams] = useState<Exam[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [examId, setExamId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [reportCards, setReportCards] = useState<ReportCardSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listExams().then((res) => setExams(res.exams));
    api.listSections().then((res) => setSections(res.sections));
  }, []);

  function refreshReportCards() {
    if (examId && sectionId) {
      api.listReportCards(examId, sectionId).then((res) => setReportCards(res.reportCards));
    } else {
      setReportCards([]);
    }
  }
  useEffect(refreshReportCards, [examId, sectionId]);

  async function handleGenerate() {
    setError(null);
    setMessage(null);
    setGenerating(true);
    try {
      await api.generateReportCards(examId, sectionId);
      refreshReportCards();
      setMessage("Report cards generated from submitted marks.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate report cards");
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublish() {
    setError(null);
    setMessage(null);
    setPublishing(true);
    try {
      const res = await api.publishReportCards(examId, sectionId);
      setMessage(`Published ${res.published} report card(s).`);
      refreshReportCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish report cards");
    } finally {
      setPublishing(false);
    }
  }

  const allApprovable = reportCards.length > 0;
  const anyUnpublished = reportCards.some((rc) => rc.status !== "published");

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Report Cards</h2>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Exam
          <select
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose an exam…</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.term ? ` — ${e.term}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Section
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose a section…</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.className} — {s.name}
              </option>
            ))}
          </select>
        </label>
        {examId && sectionId && (
          <button onClick={handleGenerate} disabled={generating} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {generating ? "Generating…" : "Generate report cards"}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      {message && <p className="mt-3 text-sm text-success">{message}</p>}

      {reportCards.length > 0 && (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {reportCards.map((rc) => (
              <ReportCardRow key={rc.id} summary={rc} onChanged={refreshReportCards} />
            ))}
          </ul>

          {me.user.role !== "teacher" && (
            <button
              onClick={handlePublish}
              disabled={publishing || !allApprovable || !anyUnpublished}
              className="mt-6 rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {publishing ? "Publishing…" : anyUnpublished ? "Publish section's report cards" : "Section already published"}
            </button>
          )}
          {me.user.role === "teacher" && (
            <p className="mt-6 text-sm text-ink-muted">Publishing is done by a Principal or Admin once every remark is approved.</p>
          )}
        </>
      )}
      {examId && sectionId && reportCards.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">No report cards generated yet — marks must be submitted for every subject first.</p>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-warning-soft text-warning",
  published: "bg-success-soft text-success",
  reopened: "bg-info-soft text-info",
};

type ReportCardDetail = {
  id: string;
  studentName: string | null;
  totalMarksObtained: number;
  totalMaxMarks: number;
  percentage: number;
  division: string;
  status: string;
  subjectResults: { subjectName: string | null; marksObtained: number | null; totalMarks: number; percentage: number | null; grade: string | null }[];
  remark: { finalText: string | null; approvedAt: string | null } | null;
};

function ReportCardRow({ summary, onChanged }: { summary: ReportCardSummary; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ReportCardDetail | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [mode, setMode] = useState<"none" | "manual" | "ai">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getReportCard(summary.id).then((res) => setDetail(res.reportCard));
  }
  useEffect(() => {
    if (open) load();
  }, [open]);

  async function handleGenerateDraft() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.generateRemark(summary.id);
      setDraft(res.draft);
      setMode("ai");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a draft");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(text: string, aiGenerated: boolean) {
    setError(null);
    setBusy(true);
    try {
      await api.approveRemark(summary.id, text, aiGenerated);
      setMode("none");
      setDraft(null);
      setManualText("");
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save remark");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded border border-border bg-surface">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium text-ink">{summary.studentName}</span>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          {summary.percentage}% — {summary.division}
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[summary.status] ?? ""}`}>{summary.status}</span>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && detail && (
        <div className="border-t border-border p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pb-1 font-normal">Subject</th>
                <th className="pb-1 font-normal">Marks</th>
                <th className="pb-1 font-normal">Grade</th>
              </tr>
            </thead>
            <tbody>
              {detail.subjectResults.map((sr, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 text-ink">{sr.subjectName}</td>
                  <td className="py-1 text-ink">
                    {sr.marksObtained ?? "—"} / {sr.totalMarks}
                  </td>
                  <td className="py-1 text-ink">{sr.grade ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4">
            <h5 className="text-sm font-semibold text-ink">Remark</h5>
            {detail.remark?.finalText && mode === "none" ? (
              <>
                <p className="mt-1 whitespace-pre-wrap rounded border border-border bg-bg p-3 text-sm text-ink-muted">{detail.remark.finalText}</p>
                {detail.status !== "published" && (
                  <button onClick={() => { setManualText(detail.remark!.finalText ?? ""); setMode("manual"); }} className="mt-2 text-sm text-accent underline">
                    Edit remark
                  </button>
                )}
              </>
            ) : mode === "none" ? (
              <div className="mt-2 flex gap-2">
                <button onClick={() => setMode("manual")} className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-bg">
                  Write it myself
                </button>
                <button onClick={handleGenerateDraft} disabled={busy} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                  {busy ? "Generating…" : "Draft with AI"}
                </button>
              </div>
            ) : mode === "manual" ? (
              <div className="mt-2">
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  rows={4}
                  className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => handleApprove(manualText, false)}
                    disabled={busy || !manualText.trim()}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Approve remark
                  </button>
                  <button onClick={() => setMode("none")} className="text-sm text-ink-muted underline">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">AI draft — review before approving</span>
                <textarea
                  value={draft ?? ""}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded border border-dashed border-info bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => draft && handleApprove(draft, true)}
                    disabled={busy}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Approve remark
                  </button>
                  <button onClick={handleGenerateDraft} className="text-sm text-ink-muted underline">
                    Regenerate
                  </button>
                  <button onClick={() => setMode("none")} className="text-sm text-ink-muted underline">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {error && <p className="mt-2 text-sm text-critical">{error}</p>}
          </div>
        </div>
      )}
    </li>
  );
}
