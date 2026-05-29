"use client";

import { useEffect, useState } from "react";
import { X, GitMerge } from "lucide-react";
import { getPreview, joinDatasets, type WorkspaceDataset, type WorkspaceJoinResponse } from "@/lib/api";

const JOIN_TYPES = [
  { value: "inner", label: "Inner", desc: "Only matching rows from both tables" },
  { value: "left", label: "Left", desc: "All rows from left, matching from right" },
  { value: "outer", label: "Outer", desc: "All rows from both tables" },
] as const;

export default function MergeModal({
  workspaceId,
  datasets,
  onClose,
  onJoined,
}: {
  workspaceId: string;
  datasets: WorkspaceDataset[];
  onClose: () => void;
  onJoined: (result: WorkspaceJoinResponse) => void;
}) {
  const [leftId, setLeftId] = useState(datasets[0]?.dataset_id ?? "");
  const [rightId, setRightId] = useState(datasets[1]?.dataset_id ?? datasets[0]?.dataset_id ?? "");
  const [joinType, setJoinType] = useState<"inner" | "left" | "outer">("inner");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [leftCols, setLeftCols] = useState<string[]>([]);
  const [rightCols, setRightCols] = useState<string[]>([]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (leftId) {
      getPreview(leftId)
        .then((d) => {
          setLeftCols(d.columns);
          setLeftKey(d.columns[0] ?? "");
        })
        .catch(() => {});
    }
  }, [leftId]);

  useEffect(() => {
    if (rightId) {
      getPreview(rightId)
        .then((d) => {
          setRightCols(d.columns);
          setRightKey(d.columns[0] ?? "");
        })
        .catch(() => {});
    }
  }, [rightId]);

  const handleJoin = async () => {
    if (!leftId || !rightId || !leftKey || !rightKey) return;
    if (leftId === rightId) {
      setError("Select two different tables to join.");
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const result = await joinDatasets({ workspace_id: workspaceId, left_dataset_id: leftId, right_dataset_id: rightId, join_type: joinType, left_key: leftKey, right_key: rightKey });
      onJoined(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join failed");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <GitMerge size={18} className="text-blue-600" />
            <span className="font-bold text-slate-800">Merge Tables</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Table selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Left Table</label>
              <select
                value={leftId}
                onChange={(e) => setLeftId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {datasets.map((ds) => (
                  <option key={ds.dataset_id} value={ds.dataset_id}>
                    {ds.name} ({ds.rows.toLocaleString()} rows)
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Right Table</label>
              <select
                value={rightId}
                onChange={(e) => setRightId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {datasets.map((ds) => (
                  <option key={ds.dataset_id} value={ds.dataset_id}>
                    {ds.name} ({ds.rows.toLocaleString()} rows)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Join type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Join Type</label>
            <div className="grid grid-cols-3 gap-2">
              {JOIN_TYPES.map(({ value, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setJoinType(value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    joinType === value ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-700">{label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Join keys */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Left Key</label>
              <select
                value={leftKey}
                onChange={(e) => setLeftKey(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {leftCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Right Key</label>
              <select
                value={rightKey}
                onChange={(e) => setRightKey(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {rightCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleJoin}
              disabled={joining || !leftKey || !rightKey || leftId === rightId}
              className="flex-1 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {joining ? "Merging…" : `Merge (${joinType} join)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
