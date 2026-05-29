"use client";

import { useEffect, useState } from "react";
import { getPreview, type PreviewData } from "@/lib/api";

function DataTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Record<string, unknown>[];
  columns: string[];
}) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const totalPages = Math.ceil(rows.length / pageSize);
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm flex items-center justify-between">
        <span>{title}</span>
        <span className="text-xs text-slate-400">{rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left font-semibold truncate max-w-[120px]">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-2 text-slate-600 truncate max-w-[120px]"
                    title={String(row[col] ?? "")}
                  >
                    {row[col] === null || row[col] === undefined ? (
                      <span className="text-slate-300 italic">null</span>
                    ) : (
                      String(row[col])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="disabled:opacity-40 hover:text-blue-600 transition-colors"
          >
            ← Prev
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-40 hover:text-blue-600 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export default function TableTab({ sessionId }: { sessionId: string }) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPreview(sessionId)
      .then(setPreview)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading)
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-slate-200 rounded-xl" />
        ))}
      </div>
    );
  if (error) return <div className="text-red-500 text-sm">{error}</div>;
  if (!preview) return null;

  return (
    <div className="space-y-6">
      <DataTable title="First 10 Rows (head)" rows={preview.head} columns={preview.columns} />
      <DataTable title="Last 10 Rows (tail)" rows={preview.tail} columns={preview.columns} />
      <DataTable title="Random Sample (10 rows)" rows={preview.sample} columns={preview.columns} />
    </div>
  );
}
