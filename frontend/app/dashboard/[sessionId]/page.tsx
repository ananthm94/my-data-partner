"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Zap, ArrowLeft } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import OverviewTab from "@/components/tabs/OverviewTab";
import TableTab from "@/components/tabs/TableTab";
import ColumnProfilerTab from "@/components/tabs/ColumnProfilerTab";
import RelationshipTab from "@/components/tabs/RelationshipTab";
import { getPreview } from "@/lib/api";

type Tab = "overview" | "table" | "profiler" | "relationship";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "table", label: "Table" },
  { id: "profiler", label: "Column Profiler" },
  { id: "relationship", label: "Relationships" },
];

export default function DashboardPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("overview");
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    getPreview(sessionId)
      .then((data) => {
        setColumns(data.columns);
        if (data.columns.length > 0) setSelectedCol(data.columns[0]);
      })
      .catch(() => {})
      .finally(() => setLoadingMeta(false));
  }, [sessionId]);

  // Get schema types from sessionStorage (stored by upload page if available)
  useEffect(() => {
    const keys = Object.keys(sessionStorage);
    for (const key of keys) {
      if (key.startsWith("session_")) {
        try {
          const data = JSON.parse(sessionStorage.getItem(key) ?? "{}");
          if (data.session_id === sessionId && data.schema_) {
            const t: Record<string, string> = {};
            data.schema_.forEach((s: { column_name: string; inferred_type: string }) => {
              t[s.column_name] = s.inferred_type;
            });
            setTypes(t);
          }
        } catch {
          // ignore
        }
      }
    }
  }, [sessionId]);

  const handleColSelect = (col: string) => {
    setSelectedCol(col);
    setTab("profiler");
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <Zap className="text-blue-600" size={20} />
          <span className="font-bold text-slate-800">myDataPartner</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm text-slate-500 font-mono truncate max-w-[200px]">
            {sessionId}
          </span>
        </div>

        {/* Tabs */}
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${tab === t.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Body: sidebar + workspace */}
      <div className="flex flex-1 overflow-hidden">
        {loadingMeta ? (
          <div className="w-56 shrink-0 border-r border-slate-200 bg-white animate-pulse">
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-8 bg-slate-200 rounded" />
              ))}
            </div>
          </div>
        ) : (
          <Sidebar
            columns={columns}
            types={types}
            selected={selectedCol}
            onSelect={handleColSelect}
          />
        )}

        {/* Workspace */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto">
            {tab === "overview" && <OverviewTab sessionId={sessionId} />}
            {tab === "table" && <TableTab sessionId={sessionId} />}
            {tab === "profiler" && (
              <ColumnProfilerTab sessionId={sessionId} column={selectedCol} />
            )}
            {tab === "relationship" && (
              <RelationshipTab sessionId={sessionId} columns={columns} types={types} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
