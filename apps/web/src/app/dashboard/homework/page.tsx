"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Section = { id: string; name: string; className: string | null };
type Subject = { id: string; name: string };
type HomeworkItem = { id: string; subjectName: string | null; description: string; dueDate: string; aiGenerated: boolean };

function today() {
  return new Date().toISOString().slice(0, 10);
}

// The AIContentReviewCard from Phase 12 §2.3, and the first AI feature
// built end to end (Phase 13 M5) — deliberately homework, not report
// cards, to prove out the generate → review → approve pattern (Phase 3
// E1) somewhere lower-stakes first. The draft is never the thing that
// gets published; approving it is what does, and that's a distinct,
// visible action here — not implicit in "generate."
export default function HomeworkPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [items, setItems] = useState<HomeworkItem[]>([]);

  const [mode, setMode] = useState<"none" | "manual" | "ai">("none");
  const [manualText, setManualText] = useState("");
  const [topic, setTopic] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSections().then((res) => setSections(res.sections));
    api.listSubjects().then((res) => setSubjects(res.subjects));
  }, []);

  function refreshHomework() {
    if (sectionId) api.getSectionHomework(sectionId).then((res) => setItems(res.homework));
  }
  useEffect(refreshHomework, [sectionId]);

  function resetForm() {
    setMode("none");
    setManualText("");
    setTopic("");
    setDraft(null);
    setError(null);
  }

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await api.generateHomework({ sectionId, subjectId, topic });
      setDraft(res.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a draft");
    } finally {
      setGenerating(false);
    }
  }

  async function handlePostManual() {
    setError(null);
    setSaving(true);
    try {
      await api.createHomework({ sectionId, subjectId, description: manualText, dueDate, aiGenerated: false });
      resetForm();
      refreshHomework();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post homework");
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveDraft() {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      await api.createHomework({ sectionId, subjectId, description: draft, dueDate, aiGenerated: true });
      resetForm();
      refreshHomework();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish homework");
    } finally {
      setSaving(false);
    }
  }

  const canStartForm = Boolean(sectionId && subjectId);

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Homework</h2>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Section
          <select
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              resetForm();
            }}
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
        <label className="flex flex-col gap-1 text-sm text-ink">
          Subject
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Choose a subject…</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      {canStartForm && mode === "none" && (
        <div className="mt-4 flex gap-2">
          <button onClick={() => setMode("manual")} className="rounded border border-border px-3 py-1.5 text-sm text-ink hover:bg-surface">
            Write it myself
          </button>
          <button onClick={() => setMode("ai")} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white">
            Draft with AI
          </button>
        </div>
      )}

      {mode === "manual" && (
        <div className="mt-4 rounded border border-border bg-surface p-4">
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={5}
            placeholder="What should students do?"
            className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          {error && <p className="mt-2 text-sm text-critical">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handlePostManual}
              disabled={saving || !manualText.trim()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Posting…" : "Post homework"}
            </button>
            <button onClick={resetForm} className="rounded px-3 py-2 text-sm text-ink-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "ai" && (
        <div className="mt-4 rounded border border-border bg-surface p-4">
          {!draft ? (
            <>
              <label className="flex flex-col gap-1 text-sm text-ink">
                Topic
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Fractions, The Water Cycle, Verb Tenses"
                  className="rounded border border-border bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              {error && <p className="mt-2 text-sm text-critical">{error}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating || !topic.trim()}
                  className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {generating ? "Generating…" : "Generate draft"}
                </button>
                <button onClick={resetForm} className="rounded px-3 py-2 text-sm text-ink-muted">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">AI draft — review before posting</span>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={7}
                className="mt-2 w-full rounded border border-dashed border-info bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
              {error && <p className="mt-2 text-sm text-critical">{error}</p>}
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleApproveDraft}
                  disabled={saving}
                  className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Publishing…" : "Approve & post"}
                </button>
                {/* Regenerate is visually secondary to Approve, per Phase
                    12 §2.3 — the default path should nudge toward reading
                    and deciding, not reflexively re-rolling. */}
                <button onClick={() => setDraft(null)} className="text-sm text-ink-muted underline">
                  Regenerate
                </button>
                <button onClick={resetForm} className="text-sm text-ink-muted underline">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ul className="mt-6 flex flex-col gap-2">
        {items.map((h) => (
          <li key={h.id} className="rounded border border-border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">{h.subjectName}</span>
              <span className="text-ink-muted">Due {h.dueDate}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-ink-muted">{h.description}</p>
            {h.aiGenerated && <span className="mt-1 inline-block rounded-full bg-info-soft px-2 py-0.5 text-xs text-info">AI-assisted</span>}
          </li>
        ))}
      </ul>
      {sectionId && items.length === 0 && <p className="mt-4 text-sm text-ink-muted">No homework posted for this section yet.</p>}
    </div>
  );
}
