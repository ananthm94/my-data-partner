"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw, ChevronDown, ChevronRight, Check, Plus } from "lucide-react";
import {
  getPreview,
  getPreviewRandom,
  getDataframeInfo,
  applyTransforms,
  mutateColumn,
  previewCustomField,
  type PreviewData,
  type DataframeInfo,
} from "@/lib/api";
import ColumnProfilerTab from "./ColumnProfilerTab";

const TYPE_OPTIONS = [
  { value: "text", label: "String", pandas: "object" },
  { value: "numeric", label: "Integer", pandas: "int64" },
  { value: "float", label: "Float", pandas: "float64" },
  { value: "boolean", label: "Boolean", pandas: "boolean" },
  { value: "datetime", label: "Datetime", pandas: "datetime64[ns]" },
  { value: "categorical", label: "Categorical", pandas: "category" },
];

const UI_TYPE_TO_PANDAS: Record<string, string> = {
  text: "object",
  numeric: "int64",
  float: "float64",
  boolean: "boolean",
  datetime: "datetime64[ns]",
  categorical: "category",
};

function DataTable({
  title,
  defaultOpen,
  rows,
  columns,
  types,
  selectedCol,
  onColClick,
  pendingRenames,
  pendingTypeCasts,
  onRename,
  onTypeChange,
  rightAction,
}: {
  title: string;
  defaultOpen: boolean;
  rows: Record<string, unknown>[];
  columns: string[];
  types: Record<string, string>;
  selectedCol: string | null;
  onColClick: (col: string) => void;
  pendingRenames: Record<string, string>;
  pendingTypeCasts: Record<string, string>;
  onRename: (original: string, newName: string) => void;
  onTypeChange: (original: string, newType: string) => void;
  rightAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(0);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const pageSize = 10;
  const totalPages = Math.ceil(rows.length / pageSize);
  const visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{title}</span>
          <span className="text-xs text-slate-400 font-normal">{rows.length} rows</span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {rightAction}
        </div>
      </button>

      {open && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  {columns.map((col) => {
                    const displayName = pendingRenames[col] ?? col;
                    const currentType = pendingTypeCasts[col] ?? types[col] ?? "text";
                    const isSelected = selectedCol === col;
                    const isEditing = editingCol === col;

                    return (
                      <th
                        key={col}
                        className={`px-3 py-2 text-left font-semibold max-w-[160px] group cursor-pointer transition-colors
                          ${isSelected ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100"}`}
                      >
                        <div className="flex flex-col gap-0.5">
                          {isEditing ? (
                            <input
                              autoFocus
                              defaultValue={displayName}
                              onBlur={(e) => {
                                onRename(col, e.target.value);
                                setEditingCol(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  onRename(col, (e.target as HTMLInputElement).value);
                                  setEditingCol(null);
                                }
                                if (e.key === "Escape") setEditingCol(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-xs font-mono text-slate-700 border border-blue-400 rounded px-1 bg-white focus:outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => onColClick(col)}
                              onDoubleClick={(e) => { e.stopPropagation(); setEditingCol(col); }}
                              className="truncate font-mono leading-tight"
                              title={`${displayName} — click to profile, double-click to rename`}
                            >
                              {displayName}
                            </span>
                          )}
                          <select
                            value={currentType}
                            onChange={(e) => { e.stopPropagation(); onTypeChange(col, e.target.value); }}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] border border-slate-200 rounded px-1 bg-white text-slate-500 focus:outline-none focus:border-blue-400 w-full normal-case font-normal"
                          >
                            {TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={`px-3 py-2 text-slate-600 truncate max-w-[160px] ${selectedCol === col ? "bg-blue-50/40" : ""}`}
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
              <span>{page + 1} / {totalPages}</span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="disabled:opacity-40 hover:text-blue-600 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DataDictionary({ info }: { info: DataframeInfo }) {
  const [open, setOpen] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  const PREVIEW_ROWS = 2;
  const visibleInfo = infoExpanded ? info.info : info.info.slice(0, PREVIEW_ROWS);
  const ALL_STATS = ["count", "mean", "std", "min", "25%", "50%", "75%", "max"];
  const PREVIEW_STATS = ["count", "mean"];
  const visibleStats = descExpanded ? ALL_STATS : PREVIEW_STATS;
  const descCols = Object.keys(info.describe);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span>Data Dictionary</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="border-t border-slate-100">
          {/* df.info() table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Column</th>
                  <th className="px-3 py-2 text-left">Dtype</th>
                  <th className="px-3 py-2 text-right">Non-null</th>
                  <th className="px-3 py-2 text-right">Null</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleInfo.map((row) => (
                  <tr key={row.column} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-mono text-slate-700">{row.column}</td>
                    <td className="px-3 py-1.5 text-slate-500">{row.dtype}</td>
                    <td className="px-3 py-1.5 text-right text-green-600">{row.non_null_count.toLocaleString()}</td>
                    <td className={`px-3 py-1.5 text-right ${row.null_count > 0 ? "text-red-500" : "text-slate-300"}`}>
                      {row.null_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {info.info.length > PREVIEW_ROWS && (
            <button
              onClick={() => setInfoExpanded((v) => !v)}
              className="w-full px-4 py-1.5 text-xs text-blue-600 hover:text-blue-800 text-left border-t border-slate-100 hover:bg-slate-50 transition-colors"
            >
              {infoExpanded ? "See less ↑" : `See ${info.info.length - PREVIEW_ROWS} more rows ↓`}
            </button>
          )}

          {/* df.describe() table */}
          {descCols.length > 0 && (
            <div className="p-3 border-t border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Describe (numeric)</div>
              <div className="overflow-x-auto">
                <table className="text-xs border-separate border-spacing-x-2">
                  <thead>
                    <tr>
                      <th className="text-left text-slate-400 font-medium pb-1">Stat</th>
                      {descCols.map((col) => (
                        <th key={col} className="text-right text-slate-500 font-medium pb-1 max-w-[80px] truncate">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleStats.map((stat) => (
                      <tr key={stat}>
                        <td className="text-slate-500 pr-4 py-0.5">{stat}</td>
                        {Object.values(info.describe).map((colStats, i) => (
                          <td key={i} className="text-right text-slate-700 py-0.5">
                            {colStats[stat] != null ? Number(colStats[stat]).toFixed(2) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => setDescExpanded((v) => !v)}
                className="mt-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
              >
                {descExpanded ? "See less ↑" : `See more stats ↓`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomFieldModal({
  sessionId,
  workspaceId,
  columns,
  onClose,
  onApplied,
}: {
  sessionId: string;
  workspaceId?: string;
  columns: string[];
  onClose: () => void;
  onApplied: (rows: number, cols: number) => void;
}) {
  const [colName, setColName] = useState("");
  const [expr, setExpr] = useState("");
  const [preview, setPreview] = useState<unknown[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handlePreview = async () => {
    if (!colName.trim() || !expr.trim()) return;
    setPreviewing(true);
    setMsg(null);
    setPreview(null);
    try {
      const res = await previewCustomField(sessionId, colName.trim(), expr.trim());
      setPreview(res.preview_values);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!colName.trim() || !expr.trim()) return;
    setApplying(true);
    setMsg(null);
    try {
      const result = await mutateColumn(sessionId, colName.trim(), expr.trim(), workspaceId);
      onApplied(result.rows, result.columns);
      onClose();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Plus size={16} className="text-blue-600" />
            <span className="font-bold text-slate-800">Create Custom Column</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {msg && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{msg}</div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">New Column Name</label>
            <input
              type="text"
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              placeholder="e.g. revenue_per_user"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Formula</label>
            <div className="text-xs text-slate-400 mb-1">
              Use column names directly, e.g. <code className="bg-slate-100 px-1 rounded">revenue / users</code> or <code className="bg-slate-100 px-1 rounded">price * quantity</code>
            </div>
            <input
              type="text"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="e.g. col_a / col_b"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="text-[10px] text-slate-400">Available columns: {columns.slice(0, 8).join(", ")}{columns.length > 8 ? "…" : ""}</div>
          </div>

          {preview && (
            <div className="bg-slate-50 rounded-lg px-4 py-3 text-xs">
              <span className="text-slate-500 font-semibold">Preview (first 5 values):</span>
              <div className="font-mono text-slate-700 mt-1 space-x-2">
                {preview.map((v, i) => (
                  <span key={i} className="bg-white border border-slate-200 rounded px-2 py-0.5">{String(v)}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={handlePreview}
              disabled={previewing || !colName.trim() || !expr.trim()}
              className="px-4 py-2.5 text-sm border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {previewing ? "Previewing…" : "Preview"}
            </button>
            <button
              onClick={handleApply}
              disabled={applying || !colName.trim() || !expr.trim()}
              className="flex-1 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {applying ? "Applying…" : "Create Column"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TableTab({
  sessionId,
  workspaceId,
  columns,
  types,
  onTypesChanged,
  onMutated,
}: {
  sessionId: string;
  workspaceId?: string;
  columns: string[];
  types: Record<string, string>;
  onTypesChanged?: (newTypes: Record<string, string>) => void;
  onMutated?: (rows: number, columns: number) => void;
}) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [dfInfo, setDfInfo] = useState<DataframeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resampling, setResampling] = useState(false);
  const [selectedCol, setSelectedCol] = useState<string | null>(null);

  const [pendingRenames, setPendingRenames] = useState<Record<string, string>>({});
  const [pendingTypeCasts, setPendingTypeCasts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [showCustomField, setShowCustomField] = useState(false);

  const hasPendingEdits = Object.keys(pendingRenames).length > 0 || Object.keys(pendingTypeCasts).length > 0;

  useEffect(() => {
    Promise.all([getPreview(sessionId), getDataframeInfo(sessionId)])
      .then(([p, d]) => { setPreview(p); setDfInfo(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handleResample = async () => {
    setResampling(true);
    try {
      const data = await getPreviewRandom(sessionId);
      setPreview((prev) => prev ? { ...prev, sample: data.sample } : data);
    } catch {
      // silently fail
    } finally {
      setResampling(false);
    }
  };

  const handleColClick = (col: string) => {
    setSelectedCol((prev) => (prev === col ? null : col));
  };

  const handleRename = (original: string, newName: string) => {
    if (newName === original || newName === (pendingRenames[original] ?? original)) return;
    if (newName.trim() === "" || newName === original) {
      setPendingRenames((prev) => { const n = { ...prev }; delete n[original]; return n; });
    } else {
      setPendingRenames((prev) => ({ ...prev, [original]: newName.trim() }));
    }
    setApplyMsg(null);
  };

  const handleTypeChange = (original: string, newType: string) => {
    if (!UI_TYPE_TO_PANDAS[newType]) return;
    const originalType = types[original] ?? "text";
    if (newType === originalType) {
      setPendingTypeCasts((prev) => { const n = { ...prev }; delete n[original]; return n; });
    } else {
      setPendingTypeCasts((prev) => ({ ...prev, [original]: newType }));
    }
    setApplyMsg(null);
  };

  const applyEdits = async () => {
    setApplying(true);
    setApplyMsg(null);
    try {
      const type_casts: Record<string, string> = {};
      Object.entries(pendingTypeCasts).forEach(([col, uiType]) => {
        const pandas = UI_TYPE_TO_PANDAS[uiType];
        if (pandas) type_casts[col] = pandas;
      });
      await applyTransforms(sessionId, pendingRenames, type_casts, {});

      const newTypes = { ...types };
      Object.entries(pendingTypeCasts).forEach(([col, uiType]) => {
        const renamedTo = pendingRenames[col] ?? col;
        newTypes[renamedTo] = uiType;
        if (pendingRenames[col]) delete newTypes[col];
      });
      Object.entries(pendingRenames).forEach(([col, newName]) => {
        if (!pendingTypeCasts[col]) {
          newTypes[newName] = newTypes[col];
          delete newTypes[col];
        }
      });
      onTypesChanged?.(newTypes);

      setPendingRenames({});
      setPendingTypeCasts({});
      setApplyMsg("Changes applied successfully.");

      const [p, d] = await Promise.all([getPreview(sessionId), getDataframeInfo(sessionId)]);
      setPreview(p);
      setDfInfo(d);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : "Failed to apply changes.");
    } finally {
      setApplying(false);
    }
  };

  if (loading)
    return (
      <div className="p-6 space-y-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-slate-200 rounded-xl" />
        ))}
      </div>
    );
  if (error) return <div className="p-6 text-red-500 text-sm">{error}</div>;
  if (!preview) return null;

  const displayColumns = preview.columns;

  const tableProps = {
    columns: displayColumns,
    types,
    selectedCol,
    onColClick: handleColClick,
    pendingRenames,
    pendingTypeCasts,
    onRename: handleRename,
    onTypeChange: handleTypeChange,
  };

  const handleCustomFieldApplied = async (rows: number, cols: number) => {
    onMutated?.(rows, cols);
    // Refresh preview after new column added
    const [p, d] = await Promise.all([getPreview(sessionId), getDataframeInfo(sessionId)]);
    setPreview(p);
    setDfInfo(d);
  };

  return (
    <>
      {showCustomField && (
        <CustomFieldModal
          sessionId={sessionId}
          workspaceId={workspaceId}
          columns={preview?.columns ?? columns}
          onClose={() => setShowCustomField(false)}
          onApplied={handleCustomFieldApplied}
        />
      )}
    <div className="flex h-full overflow-hidden">
      {/* Left pane */}
      <div className={`overflow-y-auto p-6 space-y-4 transition-all ${selectedCol ? "flex-1 min-w-0" : "flex-1"}`}>
        {/* Create Custom Column button */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowCustomField(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-colors shadow-sm"
          >
            <Plus size={13} />
            Create Custom Column
          </button>
        </div>

        {hasPendingEdits && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-amber-700">
              {Object.keys(pendingRenames).length + Object.keys(pendingTypeCasts).length} pending change(s)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => { setPendingRenames({}); setPendingTypeCasts({}); setApplyMsg(null); }}
                className="text-xs px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={applyEdits}
                disabled={applying}
                className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60 flex items-center gap-1"
              >
                <Check size={12} />
                {applying ? "Applying…" : "Apply Changes"}
              </button>
            </div>
          </div>
        )}
        {applyMsg && (
          <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-4 py-2">{applyMsg}</div>
        )}

        {dfInfo && <DataDictionary info={dfInfo} />}

        <DataTable
          title="First 10 Rows (head)"
          defaultOpen={true}
          rows={preview.head}
          {...tableProps}
        />
        <DataTable
          title="Last 10 Rows (tail)"
          defaultOpen={false}
          rows={preview.tail}
          {...tableProps}
        />
        <DataTable
          title="Random Sample (10 rows)"
          defaultOpen={false}
          rows={preview.sample}
          {...tableProps}
          rightAction={
            <button
              onClick={handleResample}
              disabled={resampling}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={resampling ? "animate-spin" : ""} />
              Resample
            </button>
          }
        />
      </div>

      {/* Right pane: inline column profiler */}
      {selectedCol && (
        <div className="w-[380px] shrink-0 border-l border-slate-200 bg-slate-50 overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-10">
            <span className="text-sm font-semibold text-slate-700 font-mono">{selectedCol}</span>
            <button
              onClick={() => setSelectedCol(null)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-4 flex-1">
            <ColumnProfilerTab sessionId={sessionId} column={selectedCol} compact />
          </div>
        </div>
      )}
    </div>
    </>
  );
}
