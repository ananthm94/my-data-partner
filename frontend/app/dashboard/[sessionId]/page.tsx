"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronDown, Plus, GitMerge, Zap, Database } from "lucide-react";
import Sidebar, { type SidebarView } from "@/components/Sidebar";
import TableTab from "@/components/tabs/TableTab";
import ColumnProfilerTab from "@/components/tabs/ColumnProfilerTab";
import RelationshipTab from "@/components/tabs/RelationshipTab";
import MergeModal from "@/components/MergeModal";
import {
  getWorkspace,
  addDatasetToWorkspace,
  getDataSchema,
  dropColumns,
  type WorkspaceDataset,
  type WorkspaceJoinResponse,
} from "@/lib/api";
import { needsSampling, sampleFile } from "@/lib/sampler";

// ---- Status bar with flash animation ----------------------------------------

function StatusBar({
  rows,
  columns,
  flash,
}: {
  rows: number;
  columns: number;
  flash: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${
        flash
          ? "bg-green-50 border border-green-300 text-green-700"
          : "bg-slate-100 border border-slate-200 text-slate-600"
      }`}
    >
      <Database size={11} className={flash ? "text-green-500" : "text-slate-400"} />
      <span>{rows.toLocaleString()} rows</span>
      <span className="text-slate-300">·</span>
      <span>{columns} columns</span>
    </div>
  );
}

// ---- Dataset switcher -------------------------------------------------------

function DatasetSwitcher({
  datasets,
  activeId,
  onSwitch,
}: {
  datasets: WorkspaceDataset[];
  activeId: string;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = datasets.find((d) => d.dataset_id === activeId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
      >
        <Database size={13} className="text-blue-500 shrink-0" />
        <span className="max-w-[200px] truncate">{active?.name ?? "Select dataset"}</span>
        <ChevronDown size={13} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-40 min-w-[240px] py-1 overflow-hidden">
          {datasets.map((ds) => (
            <button
              key={ds.dataset_id}
              onClick={() => { onSwitch(ds.dataset_id); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                ds.dataset_id === activeId
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <div className="font-medium truncate">{ds.name}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {ds.rows.toLocaleString()} rows · {ds.columns} columns
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main dashboard ---------------------------------------------------------

export default function DashboardPage() {
  // URL param is the workspaceId (kept as [sessionId] folder for the route)
  const { sessionId: workspaceId } = useParams<{ sessionId: string }>();

  const [datasets, setDatasets] = useState<WorkspaceDataset[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>("");
  const [datasetStats, setDatasetStats] = useState<{ rows: number; columns: number } | null>(null);
  const [statsFlash, setStatsFlash] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [view, setView] = useState<SidebarView>("table");
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [showMerge, setShowMerge] = useState(false);
  const [droppingCol, setDroppingCol] = useState<string | null>(null);
  const [addingDataset, setAddingDataset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flash the status bar
  const triggerFlash = useCallback((rows: number, cols: number) => {
    setDatasetStats({ rows, columns: cols });
    setStatsFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setStatsFlash(false), 2000);
  }, []);

  // Load schema (columns + types) for a dataset
  const loadDatasetMeta = useCallback(
    async (datasetId: string) => {
      // Try sessionStorage first for the initial dataset
      const storageKey = `workspace_${workspaceId}`;
      const cached = sessionStorage.getItem(storageKey);
      if (cached) {
        try {
          const data = JSON.parse(cached);
          if (data.dataset_id === datasetId && data.schema_) {
            const t: Record<string, string> = {};
            data.schema_.forEach((s: { column_name: string; inferred_type: string }) => {
              t[s.column_name] = s.inferred_type;
            });
            setColumns(data.schema_.map((s: { column_name: string }) => s.column_name));
            setTypes(t);
            return;
          }
        } catch { /* ignore */ }
      }
      // Fall back to API
      try {
        const schema = await getDataSchema(datasetId);
        const t: Record<string, string> = {};
        schema.schema_.forEach((s) => { t[s.column_name] = s.inferred_type; });
        setColumns(schema.columns);
        setTypes(t);
      } catch { /* ignore */ }
    },
    [workspaceId]
  );

  // Initial workspace load
  useEffect(() => {
    getWorkspace(workspaceId)
      .then((meta) => {
        setDatasets(meta.datasets);
        const activeId = meta.active_dataset_id || meta.datasets[0]?.dataset_id || "";
        setActiveDatasetId(activeId);
        const active = meta.datasets.find((d) => d.dataset_id === activeId);
        if (active) setDatasetStats({ rows: active.rows, columns: active.columns });
        loadDatasetMeta(activeId);
      })
      .catch(() => {})
      .finally(() => setLoadingMeta(false));
  }, [workspaceId, loadDatasetMeta]);

  // Switch active dataset
  const handleSwitchDataset = useCallback(
    async (newId: string) => {
      setActiveDatasetId(newId);
      setSelectedCol(null);
      setView("table");
      const ds = datasets.find((d) => d.dataset_id === newId);
      if (ds) setDatasetStats({ rows: ds.rows, columns: ds.columns });
      await loadDatasetMeta(newId);
    },
    [datasets, loadDatasetMeta]
  );

  // Handle mutation callback (impute, mutate, drop col, etc.)
  const handleMutated = useCallback(
    (rows: number, cols: number) => {
      triggerFlash(rows, cols);
      setDatasets((prev) =>
        prev.map((d) =>
          d.dataset_id === activeDatasetId ? { ...d, rows, columns: cols } : d
        )
      );
    },
    [activeDatasetId, triggerFlash]
  );

  // Drop column from sidebar
  const handleDropColumn = async (col: string) => {
    setDroppingCol(col);
    try {
      const result = await dropColumns(activeDatasetId, [col], workspaceId);
      const newCols = columns.filter((c) => c !== col);
      setColumns(newCols);
      if (selectedCol === col) setSelectedCol(null);
      handleMutated(result.rows, result.columns);
    } catch { /* ignore */ } finally {
      setDroppingCol(null);
    }
  };

  // Add Dataset flow
  const handleAddDatasetFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) return;
    setAddingDataset(true);
    try {
      const blob = needsSampling(file) ? await sampleFile(file, () => {}) : file;
      const res = await addDatasetToWorkspace(workspaceId, blob, file.name);
      const newDataset: WorkspaceDataset = {
        dataset_id: res.dataset_id,
        name: res.name,
        rows: res.rows,
        columns: res.columns,
      };
      setDatasets((prev) => [...prev, newDataset]);
      handleSwitchDataset(res.dataset_id);
    } catch { /* ignore */ } finally {
      setAddingDataset(false);
    }
  };

  // Handle join result
  const handleJoined = async (result: WorkspaceJoinResponse) => {
    setShowMerge(false);
    const newDataset: WorkspaceDataset = {
      dataset_id: result.new_dataset_id,
      name: `Merged (${result.rows.toLocaleString()} × ${result.columns})`,
      rows: result.rows,
      columns: result.columns,
    };
    setDatasets((prev) => [...prev, newDataset]);
    await handleSwitchDataset(result.new_dataset_id);
  };

  const handleColSelect = (col: string) => {
    setSelectedCol(col);
    setView("column");
  };

  const handleNavigate = (v: "table" | "relationships") => setView(v);

  const onTypesChanged = (newTypes: Record<string, string>) => setTypes(newTypes);

  // ---- Render ----------------------------------------------------------------

  if (loadingMeta) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden animate-pulse">
        <div className="w-56 shrink-0 border-r border-slate-200 bg-white">
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 bg-slate-200 rounded" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 bg-slate-200 rounded w-64" />
          <div className="h-48 bg-slate-200 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <>
      {showMerge && (
        <MergeModal
          workspaceId={workspaceId}
          datasets={datasets}
          onClose={() => setShowMerge(false)}
          onJoined={handleJoined}
        />
      )}

      {/* Hidden file input for Add Dataset */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleAddDatasetFile(f);
          e.target.value = "";
        }}
      />

      <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
        {/* Top bar */}
        <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
          <Zap size={14} className="text-blue-600 shrink-0" />
          <span className="text-sm font-bold text-slate-700 shrink-0">Workspace</span>
          <div className="w-px h-4 bg-slate-200" />

          {/* Dataset switcher */}
          <DatasetSwitcher
            datasets={datasets}
            activeId={activeDatasetId}
            onSwitch={handleSwitchDataset}
          />

          {/* Add Dataset button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={addingDataset}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-50"
          >
            <Plus size={12} />
            {addingDataset ? "Uploading…" : "Add Dataset"}
          </button>

          {/* Merge Tables button */}
          {datasets.length >= 2 && (
            <button
              onClick={() => setShowMerge(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 hover:border-purple-300 hover:text-purple-600 transition-colors"
            >
              <GitMerge size={12} />
              Merge Tables
            </button>
          )}

          <div className="flex-1" />

          {/* Status bar */}
          {datasetStats && (
            <StatusBar
              rows={datasetStats.rows}
              columns={datasetStats.columns}
              flash={statsFlash}
            />
          )}
        </div>

        {/* Body: sidebar + workspace */}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            sessionId={workspaceId}
            columns={columns}
            types={types}
            selectedCol={selectedCol}
            currentView={view}
            onSelectCol={handleColSelect}
            onNavigate={handleNavigate}
            onDropColumn={handleDropColumn}
            droppingCol={droppingCol}
          />

          {/* Workspace */}
          {view === "table" ? (
            <div className="flex-1 overflow-hidden min-w-0">
              <TableTab
                sessionId={activeDatasetId}
                workspaceId={workspaceId}
                columns={columns}
                types={types}
                onTypesChanged={onTypesChanged}
                onMutated={handleMutated}
              />
            </div>
          ) : view === "relationships" ? (
            <main className="flex-1 overflow-y-auto p-6 min-w-0">
              <div className="max-w-5xl mx-auto">
                <RelationshipTab sessionId={activeDatasetId} columns={columns} types={types} />
              </div>
            </main>
          ) : (
            <main className="flex-1 overflow-y-auto p-6 min-w-0">
              <div className="max-w-4xl mx-auto">
                <ColumnProfilerTab
                  sessionId={activeDatasetId}
                  workspaceId={workspaceId}
                  column={selectedCol}
                  allColumns={columns}
                  onMutated={handleMutated}
                />
              </div>
            </main>
          )}
        </div>
      </div>
    </>
  );
}
