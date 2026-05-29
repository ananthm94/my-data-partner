"use client";

import { useState } from "react";
import { Hash, AlignLeft, Calendar, Tag, Table2, GitMerge, ChevronDown, ChevronRight, Zap, ArrowLeft, Eye, EyeOff, AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/navigation";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  numeric: <Hash size={13} />,
  numeric_category: <Hash size={13} />,
  text: <AlignLeft size={13} />,
  datetime: <Calendar size={13} />,
  boolean: <Tag size={13} />,
  categorical: <Tag size={13} />,
  identifier: <Hash size={13} />,
};

export type SidebarView = "table" | "relationships" | "column";

function DropConfirm({
  column,
  onConfirm,
  onCancel,
}: {
  column: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mx-2 my-1 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
        <span className="text-amber-700 font-medium">Drop <span className="font-mono">{column}</span>?</span>
      </div>
      <p className="text-amber-600 leading-snug">This permanently removes the column from the dataset.</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 py-1 bg-red-500 text-white rounded font-semibold hover:bg-red-600 transition-colors"
        >
          Drop
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({
  sessionId,
  columns,
  types,
  selectedCol,
  currentView,
  onSelectCol,
  onNavigate,
  onDropColumn,
  droppingCol,
}: {
  sessionId: string;
  columns: string[];
  types: Record<string, string>;
  selectedCol: string | null;
  currentView: SidebarView;
  onSelectCol: (col: string) => void;
  onNavigate: (view: "table" | "relationships") => void;
  onDropColumn?: (col: string) => void;
  droppingCol?: string | null;
}) {
  const router = useRouter();
  const [colsOpen, setColsOpen] = useState(true);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);

  const handleDropRequest = (col: string) => {
    setConfirmDrop(col);
  };

  const handleDropConfirm = (col: string) => {
    setConfirmDrop(null);
    onDropColumn?.(col);
  };

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
      {/* Brand header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0">
        <button
          onClick={() => router.push("/")}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title="Back to home"
        >
          <ArrowLeft size={14} />
        </button>
        <Zap className="text-blue-600" size={15} />
        <span className="font-bold text-slate-800 text-sm">myDataPartner</span>
      </div>

      {/* Session id */}
      <div className="px-4 py-1.5 border-b border-slate-100 shrink-0">
        <span className="text-[10px] text-slate-400 font-mono truncate block" title={sessionId}>
          {sessionId}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-1">
        <button
          onClick={() => onNavigate("table")}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors
            ${currentView === "table"
              ? "bg-blue-50 text-blue-700 font-semibold"
              : "text-slate-600 hover:bg-slate-50"}`}
        >
          <Table2 size={14} className="shrink-0" />
          <span>Table</span>
        </button>

        <button
          onClick={() => onNavigate("relationships")}
          className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors
            ${currentView === "relationships"
              ? "bg-blue-50 text-blue-700 font-semibold"
              : "text-slate-600 hover:bg-slate-50"}`}
        >
          <GitMerge size={14} className="shrink-0" />
          <span>Relationships</span>
        </button>

        {/* Columns folder */}
        <div className="mt-1">
          <button
            onClick={() => setColsOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 px-4 py-1.5 text-left transition-colors hover:bg-slate-50"
          >
            {colsOpen ? (
              <ChevronDown size={12} className="text-slate-400 shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-slate-400 shrink-0" />
            )}
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Columns ({columns.length})
            </span>
          </button>

          {colsOpen && (
            <ul>
              {columns.map((col) => (
                <li key={col}>
                  {confirmDrop === col ? (
                    <DropConfirm
                      column={col}
                      onConfirm={() => handleDropConfirm(col)}
                      onCancel={() => setConfirmDrop(null)}
                    />
                  ) : (
                    <div
                      className={`group w-full flex items-center gap-2 pl-8 pr-2 py-1.5 text-sm text-left transition-colors
                        ${selectedCol === col && currentView === "column"
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      <span className="text-slate-400 shrink-0">
                        {TYPE_ICONS[types[col]] ?? <Tag size={13} />}
                      </span>
                      <button
                        onClick={() => onSelectCol(col)}
                        className="truncate text-xs flex-1 text-left"
                      >
                        {col}
                      </button>
                      {onDropColumn && (
                        <button
                          onClick={() => handleDropRequest(col)}
                          disabled={droppingCol === col}
                          title={`Drop column "${col}"`}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all shrink-0 disabled:opacity-40"
                        >
                          {droppingCol === col ? (
                            <span className="text-[10px] text-slate-400">…</span>
                          ) : (
                            <EyeOff size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </aside>
  );
}
