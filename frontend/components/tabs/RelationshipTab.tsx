"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { ArrowLeftRight } from "lucide-react";
import {
  getRelationship,
  getGlobalProfile,
  type RelationshipResult,
  type BoxDataItem,
  type GlobalProfile,
} from "@/lib/api";

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316",
];

// ─── Overview / Global Stats ────────────────────────────────────────────────

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

function GlobalStatsSection({ sessionId }: { sessionId: string }) {
  const [profile, setProfile] = useState<GlobalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getGlobalProfile(sessionId)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  const cols = profile ? Object.keys(profile.correlation_matrix) : [];

  return (
    <div className="space-y-4">
      {/* Duplicate rows banner */}
      {profile && (
        <div className="flex gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
            <div className="text-2xl font-bold text-slate-800">{profile.duplicate_rows.toLocaleString()}</div>
            <div className="text-xs text-slate-500 mt-1">Duplicate Rows</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
            <div className="text-2xl font-bold text-slate-800">{cols.length}</div>
            <div className="text-xs text-slate-500 mt-1">Numeric Columns</div>
          </div>
        </div>
      )}
      {loading && (
        <div className="h-16 bg-slate-200 rounded-xl animate-pulse" />
      )}

      {/* Correlation matrix (collapsible) */}
      {cols.length >= 2 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setOpen((v) => !v)}
            className="w-full px-4 py-3 text-sm font-semibold text-slate-700 text-left hover:bg-slate-50 transition-colors flex items-center justify-between"
          >
            <span>Correlation Matrix</span>
            <span className="text-xs text-slate-400 font-normal">{open ? "▲ collapse" : "▼ expand"}</span>
          </button>
          {open && (
            <div className="p-4 overflow-x-auto border-t border-slate-100">
              <table className="text-xs border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th />
                    {cols.map((c) => (
                      <th key={c} className="text-slate-500 font-medium max-w-[80px] truncate px-1">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cols.map((row) => (
                    <tr key={row}>
                      <th className="text-slate-500 font-medium text-right pr-2 max-w-[80px] truncate">{row}</th>
                      {cols.map((col) => (
                        <HeatmapCell
                          key={col}
                          value={profile!.correlation_matrix[row]?.[col] ?? null}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chart components ────────────────────────────────────────────────────────

function ContContChart({
  result, xCol, yCol,
}: { result: RelationshipResult; xCol: string; yCol: string }) {
  const scatterData = result.scatter_data ?? [];
  const regression = result.regression;
  const correlation = result.correlation;

  const regressionLine = (() => {
    if (!regression || scatterData.length < 2) return [];
    const xs = scatterData.map((d) => d.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const { slope, intercept } = regression;
    return [
      { x: minX, y: slope * minX + intercept },
      { x: maxX, y: slope * maxX + intercept },
    ];
  })();

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">Correlation</div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-1 text-slate-500">Pearson r</td>
                <td className="py-1 font-medium text-slate-800 text-right">{correlation?.pearson.toFixed(4)}</td>
              </tr>
              <tr>
                <td className="py-1 text-slate-500">Spearman ρ</td>
                <td className="py-1 font-medium text-slate-800 text-right">{correlation?.spearman.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-3">Linear Regression</div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {regression && [
                ["Slope", regression.slope],
                ["Intercept", regression.intercept],
                ["R²", regression.r_squared],
                ["p-value", regression.p_value],
              ].map(([k, v]) => (
                <tr key={String(k)}>
                  <td className="py-1 text-slate-500">{k}</td>
                  <td className="py-1 font-medium text-slate-800 text-right">{Number(v).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-sm font-semibold text-slate-700 mb-3">
          {xCol} vs {yCol}
          <span className="text-xs text-slate-400 ml-2">(sample of {scatterData.length} points)</span>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              type="number"
              dataKey="x"
              name={xCol}
              tick={{ fontSize: 11 }}
              label={{ value: xCol, position: "insideBottom", offset: -12, fontSize: 11 }}
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
            <Scatter data={scatterData} fill="#3b82f6" fillOpacity={0.5} r={3} />
            {regressionLine.length === 2 && (
              <Line
                data={regressionLine}
                type="linear"
                dataKey="y"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                legendType="none"
                activeDot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function CatContChart({
  boxData, catCol, numCol,
}: { boxData: BoxDataItem[]; catCol: string; numCol: string }) {
  if (boxData.length === 0) {
    return <div className="text-slate-400 text-sm">Not enough data per category for box plots.</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-700">{numCol} by {catCol}</div>
      <div className="overflow-x-auto">
        <svg
          width={Math.max(500, boxData.length * 90)}
          height={280}
          viewBox={`0 0 ${Math.max(500, boxData.length * 90)} 280`}
        >
          {(() => {
            const allVals = boxData.flatMap((d) => [d.whisker_low, d.whisker_high]);
            const minV = Math.min(...allVals);
            const maxV = Math.max(...allVals);
            const range = maxV - minV || 1;
            const toY = (v: number) => 20 + ((maxV - v) / range) * 200;
            const boxW = 50;

            return boxData.map((d, i) => {
              const cx = 45 + i * 90;
              const y1 = toY(d.whisker_low);
              const yQ1 = toY(d.q1);
              const yMed = toY(d.median);
              const yQ3 = toY(d.q3);
              const y4 = toY(d.whisker_high);

              return (
                <g key={d.category}>
                  <line x1={cx} y1={y4} x2={cx} y2={yQ3} stroke="#94a3b8" strokeWidth={1.5} />
                  <line x1={cx} y1={yQ1} x2={cx} y2={y1} stroke="#94a3b8" strokeWidth={1.5} />
                  <line x1={cx - 8} y1={y4} x2={cx + 8} y2={y4} stroke="#94a3b8" strokeWidth={1.5} />
                  <line x1={cx - 8} y1={y1} x2={cx + 8} y2={y1} stroke="#94a3b8" strokeWidth={1.5} />
                  <rect
                    x={cx - boxW / 2} y={yQ3}
                    width={boxW} height={Math.max(1, yQ1 - yQ3)}
                    fill={`${COLORS[i % COLORS.length]}33`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={1.5} rx={2}
                  />
                  <line
                    x1={cx - boxW / 2} y1={yMed}
                    x2={cx + boxW / 2} y2={yMed}
                    stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                  />
                  {d.outliers.map((ov, oi) =>
                    ov != null ? (
                      <circle key={oi} cx={cx} cy={toY(ov)} r={3} fill="none" stroke="#ef4444" strokeWidth={1} />
                    ) : null
                  )}
                  <text x={cx} y={240} fontSize={10} textAnchor="middle" fill="#64748b">
                    {d.category.length > 10 ? d.category.slice(0, 10) + "…" : d.category}
                  </text>
                </g>
              );
            });
          })()}
          <text x={10} y={120} fontSize={10} fill="#64748b" transform="rotate(-90 10 120)">{numCol}</text>
        </svg>
      </div>
    </div>
  );
}

function CatCatChart({
  crosstabData, crosstabColumns, xCol, yCol,
}: {
  crosstabData: Record<string, Record<string, number>>;
  crosstabColumns: string[];
  xCol: string;
  yCol: string;
}) {
  const rows = Object.entries(crosstabData);
  if (rows.length === 0) {
    return <div className="text-slate-400 text-sm">No data for cross-tab analysis.</div>;
  }

  const chartData = rows.map(([rowKey, colCounts]) => ({
    name: rowKey.length > 12 ? rowKey.slice(0, 12) + "…" : rowKey,
    ...colCounts,
  }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-700">{xCol} vs {yCol} (Cross-tab)</div>
      <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 30)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 80 }}
        >
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          {crosstabColumns.map((col, i) => (
            <Bar
              key={col}
              dataKey={col}
              stackId="a"
              fill={COLORS[i % COLORS.length]}
              radius={i === crosstabColumns.length - 1 ? [0, 4, 4, 0] : undefined}
            >
              {chartData.map((_, di) => (
                <Cell key={di} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const DATE_TYPES = new Set(["datetime", "identifier"]);

export default function RelationshipTab({
  sessionId,
  columns,
  types,
}: {
  sessionId: string;
  columns: string[];
  types: Record<string, string>;
}) {
  const eligibleCols = columns.filter((c) => !DATE_TYPES.has(types[c] ?? ""));

  const [xCol, setXCol] = useState<string>(eligibleCols[0] ?? "");
  const [yCol, setYCol] = useState<string>(eligibleCols[1] ?? "");
  const [result, setResult] = useState<RelationshipResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const swap = () => {
    setXCol(yCol);
    setYCol(xCol);
    setResult(null);
  };

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

  return (
    <div className="space-y-6">
      {/* Global stats + correlation matrix */}
      <GlobalStatsSection sessionId={sessionId} />

      <hr className="border-slate-200" />

      <div>
        <h3 className="text-base font-semibold text-slate-700 mb-4">Relationship Explorer</h3>

        {eligibleCols.length < 2 ? (
          <div className="text-slate-400 text-sm">
            You need at least two non-date columns to analyze relationships.
          </div>
        ) : (
          <>
            {/* Column selectors */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-36">
                <label className="block text-xs font-semibold text-slate-500 mb-1">X Variable</label>
                <select
                  value={xCol}
                  onChange={(e) => setXCol(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {eligibleCols.map((c) => (
                    <option key={c} value={c}>{c} ({types[c] ?? "unknown"})</option>
                  ))}
                </select>
              </div>

              <button
                onClick={swap}
                title="Swap X and Y"
                className="flex items-center gap-1.5 px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeftRight size={14} />
                Swap
              </button>

              <div className="flex-1 min-w-36">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Y Variable</label>
                <select
                  value={yCol}
                  onChange={(e) => setYCol(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {eligibleCols.map((c) => (
                    <option key={c} value={c}>{c} ({types[c] ?? "unknown"})</option>
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

            {error && <div className="text-red-500 text-sm mt-3">{error}</div>}

            {result && (
              <div className="mt-4 space-y-4">
                {result.analysis_type === "cont_cont" && (
                  <ContContChart result={result} xCol={xCol} yCol={yCol} />
                )}
                {result.analysis_type === "cat_cont" && result.box_data && (
                  <CatContChart
                    boxData={result.box_data}
                    catCol={types[xCol] && ["numeric", "numeric_category"].includes(types[xCol]) ? yCol : xCol}
                    numCol={types[xCol] && ["numeric", "numeric_category"].includes(types[xCol]) ? xCol : yCol}
                  />
                )}
                {result.analysis_type === "cat_cat" && result.crosstab_data && result.crosstab_columns && (
                  <CatCatChart
                    crosstabData={result.crosstab_data}
                    crosstabColumns={result.crosstab_columns}
                    xCol={xCol}
                    yCol={yCol}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
