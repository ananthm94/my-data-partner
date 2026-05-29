"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { getColumnProfile, applyClean, imputeColumn, getPreview, type ColumnProfile } from "@/lib/api";

function BoxPlotWithStats({
  stats,
  outlierStats,
}: {
  stats: Record<string, number | string | null>;
  outlierStats?: ColumnProfile["outlier_stats"];
}) {
  const min = Number(stats.min ?? 0);
  const max = Number(stats.max ?? 0);
  const q1 = Number(stats.q1 ?? 0);
  const median = Number(stats.median ?? 0);
  const q3 = Number(stats.q3 ?? 0);
  const iqrLower = outlierStats?.iqr_lower ?? q1;
  const iqrUpper = outlierStats?.iqr_upper ?? q3;
  const outlierVals = outlierStats?.outlier_values ?? [];

  const allVals = [min, ...outlierVals, max];
  const domain = [Math.min(...allVals), Math.max(...allVals)];
  const range = domain[1] - domain[0] || 1;
  const toX = (v: number) => ((v - domain[0]) / range) * 340 + 30;

  const cy = 32;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <span className="text-sm font-semibold text-slate-700 block">Box Plot &amp; Statistics</span>

      {/* SVG box plot */}
      <svg width="100%" height={72} viewBox="0 0 400 72" preserveAspectRatio="xMidYMid meet">
        {/* Left whisker: from iqrLower to Q1 */}
        <line x1={toX(iqrLower)} y1={cy} x2={toX(q1)} y2={cy} stroke="#94a3b8" strokeWidth={1.5} />
        <line x1={toX(iqrLower)} y1={cy - 8} x2={toX(iqrLower)} y2={cy + 8} stroke="#94a3b8" strokeWidth={1.5} />
        {/* Right whisker: from Q3 to iqrUpper */}
        <line x1={toX(q3)} y1={cy} x2={toX(iqrUpper)} y2={cy} stroke="#94a3b8" strokeWidth={1.5} />
        <line x1={toX(iqrUpper)} y1={cy - 8} x2={toX(iqrUpper)} y2={cy + 8} stroke="#94a3b8" strokeWidth={1.5} />
        {/* IQR box */}
        <rect
          x={toX(q1)} y={cy - 14}
          width={Math.max(2, toX(q3) - toX(q1))} height={28}
          fill="#bfdbfe" stroke="#3b82f6" strokeWidth={1.5} rx={2}
        />
        {/* Median line */}
        <line x1={toX(median)} y1={cy - 14} x2={toX(median)} y2={cy + 14} stroke="#1d4ed8" strokeWidth={2.5} />
        {/* Outlier dots */}
        {outlierVals.map((v, i) => (
          <circle key={i} cx={toX(v)} cy={cy} r={3.5} fill="none" stroke="#ef4444" strokeWidth={1.5} />
        ))}
        {/* Labels */}
        <text x={toX(iqrLower)} y={cy + 24} fontSize={9} textAnchor="middle" fill="#64748b">
          {Number(iqrLower).toFixed(2)}
        </text>
        <text x={toX(q1)} y={cy + 24} fontSize={9} textAnchor="middle" fill="#64748b">Q1</text>
        <text x={toX(median)} y={cy + 24} fontSize={9} textAnchor="middle" fill="#1d4ed8">Med</text>
        <text x={toX(q3)} y={cy + 24} fontSize={9} textAnchor="middle" fill="#64748b">Q3</text>
        <text x={toX(iqrUpper)} y={cy + 24} fontSize={9} textAnchor="middle" fill="#64748b">
          {Number(iqrUpper).toFixed(2)}
        </text>
      </svg>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-xs">
        {[
          ["Min", stats.min],
          ["Q1", stats.q1],
          ["Median", stats.median],
          ["Q3", stats.q3],
          ["Max", stats.max],
          ["Mean", stats.mean],
          ["Std Dev", stats.std],
          ["Skew", stats.skew],
          ["Kurtosis", stats.kurtosis],
          ["Missing %", `${stats.missing_pct ?? "—"}%`],
        ].map(([label, val]) => (
          <div key={String(label)} className="flex flex-col">
            <span className="text-slate-400 text-[10px]">{label}</span>
            <span className="font-semibold text-slate-700">
              {val != null ? (typeof val === "number" ? Number(val).toFixed(3) : String(val)) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumericProfile({
  profile,
  sessionId,
  onRefresh,
  compact,
}: {
  profile: ColumnProfile;
  sessionId: string;
  onRefresh: () => void;
  compact?: boolean;
}) {
  const [bins, setBins] = useState<number>(20);
  const [dropping, setDropping] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [dropMethod, setDropMethod] = useState<"iqr" | "zscore" | "negative">("iqr");

  const distData = profile.distribution_data ?? [];
  const stats = profile.stats ?? {};
  const outlierStats = profile.outlier_stats;
  const isDiscrete = profile.is_discrete === true;

  const allIntegers = isDiscrete || (
    distData.length > 0 && distData.every((d) => Number.isInteger(Number(d.bin_start)))
  );

  const rebinned = (() => {
    if (distData.length === 0) return [];
    if (isDiscrete) {
      return distData.map((d) => ({
        label: String(d.bin_start),
        count: Number(d.count ?? 0),
      }));
    }
    const step = Math.max(1, Math.floor(distData.length / bins));
    const result: { label: string; count: number }[] = [];
    for (let i = 0; i < distData.length; i += step) {
      const slice = distData.slice(i, i + step);
      const count = slice.reduce((s, d) => s + Number(d.count ?? 0), 0);
      const rawVal = Number(slice[0].bin_start);
      result.push({
        label: allIntegers ? String(Math.round(rawVal)) : rawVal.toFixed(1),
        count,
      });
    }
    return result;
  })();

  const tickInterval = rebinned.length > 20
    ? Math.ceil(rebinned.length / 10) - 1
    : 0;

  const handleDropOutliers = async () => {
    setDropping(true);
    setDropMsg(null);
    try {
      const actionMap = {
        iqr: "remove_iqr_outliers",
        zscore: "remove_zscore_outliers",
        negative: "remove_negative_outliers",
      };
      const res = await applyClean(sessionId, actionMap[dropMethod], profile.column_name);
      const removed = res.rows_before - res.rows_after;
      setDropMsg(`Removed ${removed} row${removed !== 1 ? "s" : ""}. Refreshing…`);
      onRefresh();
    } catch (e) {
      setDropMsg(e instanceof Error ? e.message : "Failed to drop outliers");
    } finally {
      setDropping(false);
    }
  };

  const missingPct = profile.missing_pct;

  return (
    <div className="space-y-4">
      {/* Distribution histogram */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700">Distribution</span>
          {!isDiscrete && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Bins:</span>
              <input
                type="range"
                min={5}
                max={60}
                value={bins}
                onChange={(e) => setBins(Number(e.target.value))}
                className="w-24 accent-blue-600"
              />
              <span>{bins}</span>
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={compact ? 160 : 220}>
          <BarChart data={rebinned} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              interval={tickInterval}
            />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Consolidated Box Plot + Stats */}
      {stats.min != null && stats.q1 != null && stats.median != null && stats.q3 != null && stats.max != null && (
        <BoxPlotWithStats
          stats={{ ...stats, missing_pct: missingPct }}
          outlierStats={outlierStats}
        />
      )}

      {/* Outlier actions */}
      {outlierStats && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <span className="text-sm font-semibold text-slate-700">Outlier Actions</span>
          {dropMsg && (
            <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2">{dropMsg}</div>
          )}

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${dropMethod === "iqr" ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
              onClick={() => setDropMethod("iqr")}>
              <div className="font-semibold text-slate-700 mb-0.5">IQR</div>
              <div className="text-slate-500">{outlierStats.iqr_outlier_count ?? 0} outliers</div>
              <div className="text-slate-400 mt-0.5 truncate">
                [{Number(outlierStats.iqr_lower ?? 0).toFixed(1)}, {Number(outlierStats.iqr_upper ?? 0).toFixed(1)}]
              </div>
            </div>
            <div className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${dropMethod === "zscore" ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
              onClick={() => setDropMethod("zscore")}>
              <div className="font-semibold text-slate-700 mb-0.5">Z-Score</div>
              <div className="text-slate-500">{outlierStats.zscore_outlier_count ?? 0} outliers</div>
              <div className="text-slate-400 mt-0.5">±{outlierStats.zscore_threshold ?? 3}σ</div>
            </div>
            <div className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${dropMethod === "negative" ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
              onClick={() => setDropMethod("negative")}>
              <div className="font-semibold text-slate-700 mb-0.5">&lt; Zero</div>
              <div className="text-slate-500">{outlierStats.negative_count ?? 0} rows</div>
              <div className="text-slate-400 mt-0.5">Drop negatives</div>
            </div>
          </div>

          <button
            onClick={handleDropOutliers}
            disabled={dropping}
            className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            {dropping ? "Dropping…" : `Drop via ${dropMethod.toUpperCase()} method`}
          </button>
        </div>
      )}
    </div>
  );
}

function DatetimeProfile({
  profile,
  sessionId,
  onRefresh,
}: {
  profile: ColumnProfile;
  sessionId: string;
  onRefresh: () => void;
}) {
  const [grain, setGrain] = useState<"daily" | "weekly" | "monthly">("daily");
  const [dropping, setDropping] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const stats = profile.stats ?? {};
  const outlierStats = profile.outlier_stats;

  const freqData = (() => {
    if (grain === "monthly") return profile.frequency_data_monthly ?? [];
    if (grain === "weekly") return profile.frequency_data_weekly ?? [];
    return profile.frequency_data ?? [];
  })();

  const handleDropDateOutliers = async () => {
    setDropping(true);
    setDropMsg(null);
    try {
      const res = await applyClean(sessionId, "remove_date_outliers", profile.column_name);
      const removed = res.rows_before - res.rows_after;
      setDropMsg(`Removed ${removed} outlier row${removed !== 1 ? "s" : ""}. Refreshing…`);
      onRefresh();
    } catch (e) {
      setDropMsg(e instanceof Error ? e.message : "Failed to drop date outliers");
    } finally {
      setDropping(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Min Date", String(stats.min ?? "—")],
          ["Max Date", String(stats.max ?? "—")],
          ["Span (days)", String(stats.span_days ?? "—")],
        ].map(([l, v]) => (
          <div key={String(l)} className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm text-center">
            <div className="text-sm font-bold text-slate-800 truncate" title={v}>{v}</div>
            <div className="text-xs text-slate-500 mt-1">{l}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700">Frequency over Time</span>
          <div className="flex gap-1">
            {(["daily", "weekly", "monthly"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGrain(g)}
                className={`px-2 py-1 text-xs rounded-md font-medium transition-colors
                  ${grain === g ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={freqData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="count" stroke="#3b82f6" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Date outlier detection */}
      {outlierStats && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <span className="text-sm font-semibold text-slate-700">Date Outlier Detection (IQR)</span>
          {dropMsg && (
            <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2">{dropMsg}</div>
          )}
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Outliers detected</span>
              <span className={`font-semibold ${(outlierStats.iqr_outlier_count ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}>
                {outlierStats.iqr_outlier_count ?? 0}
              </span>
            </div>
            {outlierStats.iqr_lower_date && (
              <div className="flex justify-between">
                <span className="text-slate-500">Expected range</span>
                <span className="text-slate-700 font-mono text-[10px]">
                  {outlierStats.iqr_lower_date?.split("T")[0]} → {outlierStats.iqr_upper_date?.split("T")[0]}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleDropDateOutliers}
            disabled={dropping || (outlierStats.iqr_outlier_count ?? 0) === 0}
            className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            {dropping ? "Dropping…" : "Drop Date Outliers"}
          </button>
        </div>
      )}
    </div>
  );
}

function CategoricalProfile({ profile }: { profile: ColumnProfile }) {
  const data = profile.distribution_data ?? [];
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <span className="text-sm font-semibold text-slate-700">Top Values</span>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 80 }}
        >
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
          <YAxis dataKey="value" type="category" tick={{ fontSize: 11 }} width={80} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(v, _, item) => [`${v} (${item.payload.pct}%)`, "Count"]}
          />
          <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TextProfile({ profile }: { profile: ColumnProfile }) {
  const words = profile.word_frequency ?? [];
  const stats = profile.stats ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Avg Length", stats.avg_length],
          ["Max Length", stats.max_length],
        ].map(([l, v]) => (
          <div key={String(l)} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm text-center">
            <div className="text-xl font-bold text-slate-800">{v ?? "—"}</div>
            <div className="text-xs text-slate-500 mt-1">{l}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-sm font-semibold text-slate-700 mb-3">Word Frequency</div>
        <div className="flex flex-wrap gap-2">
          {words.map(({ word, count }) => (
            <span
              key={word}
              className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100"
              title={`${count} occurrences`}
              style={{ fontSize: Math.max(11, Math.min(20, 11 + count / 5)) }}
            >
              {word}
            </span>
          ))}
          {words.length === 0 && (
            <span className="text-slate-400 text-sm">No word data available.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ImputeSection({
  sessionId,
  workspaceId,
  column,
  allColumns,
  onMutated,
}: {
  sessionId: string;
  workspaceId?: string;
  column: string;
  allColumns: string[];
  onMutated?: (rows: number, columns: number) => void;
}) {
  const [strategy, setStrategy] = useState<string>("mean");
  const [constantValue, setConstantValue] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [imputing, setImputing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleImpute = async () => {
    setImputing(true);
    setMsg(null);
    try {
      const result = await imputeColumn(sessionId, column, strategy, {
        constant_value: strategy === "constant" ? constantValue : undefined,
        group_by: groupBy || undefined,
        sort_by: (strategy === "ffill" || strategy === "bfill") ? (sortBy || undefined) : undefined,
        workspace_id: workspaceId,
      });
      setMsg(`Done. Dataset is now ${result.rows.toLocaleString()} rows × ${result.columns} columns.`);
      onMutated?.(result.rows, result.columns);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Imputation failed");
    } finally {
      setImputing(false);
    }
  };

  const STRATEGIES = [
    { value: "mean", label: "Mean" },
    { value: "median", label: "Median" },
    { value: "mode", label: "Mode" },
    { value: "constant", label: "Constant Value" },
    { value: "ffill", label: "Forward Fill" },
    { value: "bfill", label: "Backward Fill" },
  ];

  const otherCols = allColumns.filter((c) => c !== column);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <span className="text-sm font-semibold text-slate-700 block">Impute Missing Values</span>

      {msg && (
        <div className={`text-xs rounded px-3 py-2 ${msg.startsWith("Done") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {msg}
        </div>
      )}

      {/* Strategy */}
      <div className="space-y-1">
        <label className="text-xs text-slate-500">Strategy</label>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {STRATEGIES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Constant value input */}
      {strategy === "constant" && (
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Fill Value</label>
          <input
            type="text"
            value={constantValue}
            onChange={(e) => setConstantValue(e.target.value)}
            placeholder="Enter constant value…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      )}

      {/* Sort by (ffill/bfill) */}
      {(strategy === "ffill" || strategy === "bfill") && (
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Sort By (optional)</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">— none —</option>
            {otherCols.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* Group by */}
      <div className="space-y-1">
        <label className="text-xs text-slate-500">Group By (optional)</label>
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">— none —</option>
          {otherCols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <button
        onClick={handleImpute}
        disabled={imputing || (strategy === "constant" && !constantValue.trim())}
        className="w-full px-3 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
      >
        {imputing ? "Imputing…" : "Apply Imputation"}
      </button>
    </div>
  );
}

export default function ColumnProfilerTab({
  sessionId,
  workspaceId,
  column,
  allColumns,
  compact,
  onMutated,
}: {
  sessionId: string;
  workspaceId?: string;
  column: string | null;
  allColumns?: string[];
  compact?: boolean;
  onMutated?: (rows: number, columns: number) => void;
}) {
  const [profile, setProfile] = useState<ColumnProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = () => {
    if (!column) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    getColumnProfile(sessionId, column)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProfile();
  }, [sessionId, column]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!column)
    return (
      <div className="text-slate-400 text-sm">
        Select a column from the sidebar to profile it.
      </div>
    );

  if (loading)
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-slate-200 rounded-xl" />)}
        </div>
        <div className="h-64 bg-slate-200 rounded-xl" />
      </div>
    );

  if (error) return <div className="text-red-500 text-sm">{error}</div>;
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-800 font-mono">{profile.column_name}</h2>
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">
          {profile.data_type}
        </span>
        <span className="text-xs text-slate-400">
          {profile.unique.toLocaleString()} unique · {profile.missing_pct}% missing
        </span>
      </div>

      {profile.data_type === "numeric" || profile.data_type === "numeric_category" ? (
        <NumericProfile
          profile={profile}
          sessionId={sessionId}
          onRefresh={fetchProfile}
          compact={compact}
        />
      ) : profile.data_type === "datetime" ? (
        <DatetimeProfile profile={profile} sessionId={sessionId} onRefresh={fetchProfile} />
      ) : profile.data_type === "categorical" || profile.data_type === "boolean" ? (
        <CategoricalProfile profile={profile} />
      ) : profile.data_type === "text" ? (
        <TextProfile profile={profile} />
      ) : (
        <div className="text-slate-400 text-sm">
          No profile visualization for type: {profile.data_type}
        </div>
      )}

      {!compact && profile.missing > 0 && allColumns && (
        <ImputeSection
          sessionId={sessionId}
          workspaceId={workspaceId}
          column={profile.column_name}
          allColumns={allColumns}
          onMutated={onMutated}
        />
      )}
    </div>
  );
}
