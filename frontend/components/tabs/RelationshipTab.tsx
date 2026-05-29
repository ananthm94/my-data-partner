"use client";

import { useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  LineChart,
} from "recharts";
import { getRelationship, type RelationshipResult } from "@/lib/api";

export default function RelationshipTab({
  sessionId,
  columns,
  types,
}: {
  sessionId: string;
  columns: string[];
  types: Record<string, string>;
}) {
  const numericCols = columns.filter(
    (c) => types[c] === "numeric" || types[c] === "numeric_category"
  );

  const [xCol, setXCol] = useState<string>(numericCols[0] ?? "");
  const [yCol, setYCol] = useState<string>(numericCols[1] ?? "");
  const [result, setResult] = useState<RelationshipResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!xCol || !yCol || xCol === yCol) {
      setError("Select two different columns.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await getRelationship(sessionId, xCol, yCol);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  // Build regression line overlay points
  const regressionLine = result
    ? (() => {
        const xs = result.scatter_data.map((d) => d.x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const { slope, intercept } = result.regression;
        return [
          { x: minX, y: slope * minX + intercept },
          { x: maxX, y: slope * maxX + intercept },
        ];
      })()
    : [];

  return (
    <div className="space-y-6">
      {/* Column selectors */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-40">
          <label className="block text-xs font-semibold text-slate-500 mb-1">X Variable</label>
          <select
            value={xCol}
            onChange={(e) => setXCol(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {numericCols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Y Variable</label>
          <select
            value={yCol}
            onChange={(e) => setYCol(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {numericCols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={analyze}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          {loading ? "Computing…" : "Analyze"}
        </button>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {numericCols.length < 2 && (
        <div className="text-slate-400 text-sm">
          You need at least two numeric columns to analyze relationships.
        </div>
      )}

      {result && (
        <>
          {/* Stats table */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">Correlation</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-1 text-slate-500">Pearson r</td>
                    <td className="py-1 font-medium text-slate-800 text-right">
                      {result.correlation.pearson.toFixed(4)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-500">Spearman ρ</td>
                    <td className="py-1 font-medium text-slate-800 text-right">
                      {result.correlation.spearman.toFixed(4)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">Linear Regression</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {[
                    ["Slope", result.regression.slope],
                    ["Intercept", result.regression.intercept],
                    ["R²", result.regression.r_squared],
                    ["p-value", result.regression.p_value],
                  ].map(([k, v]) => (
                    <tr key={String(k)}>
                      <td className="py-1 text-slate-500">{k}</td>
                      <td className="py-1 font-medium text-slate-800 text-right">
                        {Number(v).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scatter plot */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="text-sm font-semibold text-slate-700 mb-3">
              {xCol} vs {yCol}
              <span className="text-xs text-slate-400 ml-2">
                (sample of {result.scatter_data.length} points)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={xCol}
                  tick={{ fontSize: 11 }}
                  label={{ value: xCol, position: "insideBottom", offset: -4, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={yCol}
                  tick={{ fontSize: 11 }}
                  label={{ value: yCol, angle: -90, position: "insideLeft", fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v, name) => [Number(v).toFixed(2), name === "x" ? xCol : yCol]}
                />
                <Scatter data={result.scatter_data} fill="#3b82f6" fillOpacity={0.5} r={3} />
              </ScatterChart>
            </ResponsiveContainer>
            {/* Regression line overlay as a separate simple chart */}
            <div className="mt-2">
              <div className="text-xs text-slate-400 mb-1">Best-fit line</div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={regressionLine} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Line type="linear" dataKey="y" stroke="#ef4444" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
