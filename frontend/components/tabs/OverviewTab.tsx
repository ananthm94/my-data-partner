"use client";

import { useEffect, useState } from "react";
import { getGlobalProfile, type GlobalProfile } from "@/lib/api";

export default function OverviewTab({ sessionId }: { sessionId: string }) {
  const [profile, setProfile] = useState<GlobalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGlobalProfile(sessionId)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <Skeleton />;
  if (error) return <Err msg={error} />;
  if (!profile) return null;

  const numericColCount = Object.keys(profile.correlation_matrix).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Duplicate Rows" value={profile.duplicate_rows.toLocaleString()} />
        <StatCard label="Numeric Columns" value={numericColCount.toString()} />
      </div>
      <div className="text-slate-400 text-sm">
        See the <span className="font-medium text-slate-500">Correlations</span> tab for the full correlation matrix.
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 gap-4">
        <div className="h-20 bg-slate-200 rounded-xl" />
        <div className="h-20 bg-slate-200 rounded-xl" />
      </div>
      <div className="h-64 bg-slate-200 rounded-xl" />
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return <div className="text-red-500 text-sm">{msg}</div>;
}
