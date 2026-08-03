"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";

type ReportCardDetail = {
  studentName: string | null;
  examName: string | null;
  totalMarksObtained: number;
  totalMaxMarks: number;
  percentage: number;
  division: string;
  status: string;
  publishedAt: string | null;
  subjectResults: { subjectName: string | null; marksObtained: number | null; totalMarks: number; percentage: number | null; grade: string | null }[];
  remark: { finalText: string | null; approvedAt: string | null } | null;
};

// The parent/student's own view of a single report card, linked from
// Home's ReportCardsList — reuses the same self-scoped detail endpoint
// staff use, since canViewStudentReportCard already draws that boundary.
export default function ReportCardDetailPage() {
  const params = useParams<{ reportCardId: string }>();
  const [detail, setDetail] = useState<ReportCardDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getReportCard(params.reportCardId)
      .then((res) => setDetail(res.reportCard))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this report card"));
  }, [params.reportCardId]);

  if (error) return <p className="text-sm text-critical">{error}</p>;
  if (!detail) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">
        {detail.studentName} — {detail.examName}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {detail.totalMarksObtained} / {detail.totalMaxMarks} ({detail.percentage}%) — {detail.division}
      </p>

      <table className="mt-6 w-full text-sm">
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
              <td className="py-2 text-ink">{sr.subjectName}</td>
              <td className="py-2 text-ink">
                {sr.marksObtained ?? "—"} / {sr.totalMarks}
              </td>
              <td className="py-2 text-ink">{sr.grade ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail.remark?.finalText && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-ink">Teacher's remark</h3>
          <p className="mt-2 whitespace-pre-wrap rounded border border-border bg-surface p-3 text-sm text-ink-muted">{detail.remark.finalText}</p>
        </div>
      )}
    </div>
  );
}
