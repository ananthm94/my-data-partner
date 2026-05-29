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
import { getColumnProfile, type ColumnProfile } from "@/lib/api";

function StatCard({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm text-center">
      <div className="text-xl font-bold text-slate-800">{value ?? "—"}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function NumericProfile({ profile }: { profile: ColumnProfile }) {
  const [bins, setBins] = useState<number>(20);
  const distData = profile.distribution_data ?? [];

  const rebinned = (() => {
    if (distData.length === 0) return [];
    const step = Math.max(1, Math.floor(distData.length / bins));
    const result: { label: string; count: number }[] = [];
    for (let i = 0; i < distData.length; i += step) {
      const slice = distData.slice(i, i + step);
      const count = slice.reduce((s, d) => s + Number(d.count ?? 0), 0);
      result.push({ label: `${Number(slice[0].bin_start).toFixed(1)}`, count });
    }
    return result;
  })();

  const stats = profile.stats ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Min", stats.min],
          ["Max", stats.max],
          ["Mean", stats.mean],
          ["Std Dev", stats.std],
          ["Skew", stats.skew],
          ["Kurtosis", stats.kurtosis],
          ["Median", stats.median],
          ["Missing %", `${profile.missing_pct}%`],
        ].map(([l, v]) => (
          <StatCard key={String(l)} label={String(l)} value={v as string | number | null} />
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700">Distribution</span>
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
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rebinned} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DatetimeProfile({ profile }: { profile: ColumnProfile }) {
  const [grain, setGrain] = useState<"daily" | "weekly" | "monthly">("daily");
  const freqData = profile.frequency_data ?? [];
  const stats = profile.stats ?? {};

  const filtered = (() => {
    if (grain === "monthly") return freqData.filter((_, i) => i % 30 === 0);
    if (grain === "weekly") return freqData.filter((_, i) => i % 7 === 0);
    return freqData;
  })();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Min Date" value={String(stats.min ?? "—")} />
        <StatCard label="Max Date" value={String(stats.max ?? "—")} />
        <StatCard label="Span (days)" value={stats.span_days as number | null} />
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
          <LineChart data={filtered} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="count" stroke="#3b82f6" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
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
          <XAxis type="number" tick={{ fontSize: 10 }} />
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
        <StatCard label="Avg Length" value={stats.avg_length as number | null} />
        <StatCard label="Max Length" value={stats.max_length as number | null} />
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

export default function ColumnProfilerTab({
  sessionId,
  column,
}: {
  sessionId: string;
  column: string | null;
}) {
  const [profile, setProfile] = useState<ColumnProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!column) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    getColumnProfile(sessionId, column)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId, column]);

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
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-slate-800 font-mono">{profile.column_name}</h2>
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">
          {profile.data_type}
        </span>
        <span className="text-xs text-slate-400">
          {profile.unique.toLocaleString()} unique · {profile.missing_pct}% missing
        </span>
      </div>

      {profile.data_type === "numeric" || profile.data_type === "numeric_category" ? (
        <NumericProfile profile={profile} />
      ) : profile.data_type === "datetime" ? (
        <DatetimeProfile profile={profile} />
      ) : profile.data_type === "categorical" || profile.data_type === "boolean" ? (
        <CategoricalProfile profile={profile} />
      ) : profile.data_type === "text" ? (
        <TextProfile profile={profile} />
      ) : (
        <div className="text-slate-400 text-sm">No profile visualization for type: {profile.data_type}</div>
      )}
    </div>
  );
}
