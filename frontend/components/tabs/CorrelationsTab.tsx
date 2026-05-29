"use client";

import { useEffect, useState } from "react";
import { getGlobalProfile, type GlobalProfile } from "@/lib/api";

function HeatmapCell({ value }: { value: number | null }) {
  if (value === null) return <td className="p-1 text-center text-xs text-slate-300">—</td>;
  const abs = Math.abs(value);
  const bg = value >= 0
    ? `rgba(59,130,246,${abs.toFixed(2)})`
    : `rgba(239,68,68,${abs.toFixed(2)})`;
  return (
    <td
      className="p-1 text-center text-xs font-medium rounded"
      style={{ backgroundColor: bg, color: abs > 0.5 ? "white" : "#334155" }}
    >
      {value.toFixed(2)}
    </td>
  );
}

export default function CorrelationsTab({ sessionId }: { sessionId: string }) {
  const [profile, setProfile] = useState<GlobalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGlobalProfile(sessionId)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading)
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-64 bg-slate-200 rounded-xl" />
      </div>
    );
  if (error) return <div className="text-red-500 text-sm">{error}</div>;
  if (!profile) return null;

  const cols = Object.keys(profile.correlation_matrix);

  if (cols.length < 2) {
    return (
      <div className="text-slate-400 text-sm">
        Not enough numeric columns to compute a correlation matrix.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
        Correlation Matrix
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="text-xs border-separate border-spacing-1">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c} className="text-slate-500 font-medium max-w-[80px] truncate px-1">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map((row) => (
              <tr key={row}>
                <th className="text-slate-500 font-medium text-right pr-2 max-w-[80px] truncate">
                  {row}
                </th>
                {cols.map((col) => (
                  <HeatmapCell
                    key={col}
                    value={profile.correlation_matrix[row]?.[col] ?? null}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
