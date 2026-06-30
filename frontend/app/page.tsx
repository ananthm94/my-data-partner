"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Zap, Database, BarChart3 } from "lucide-react";
import { sampleFile, needsSampling } from "@/lib/sampler";
import { uploadFile } from "@/lib/api";

export default function LandingPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<null | "ml" | "analytics">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        setStatus("Only CSV files are supported.");
        return;
      }
      setLoading(true);
      setStatus(needsSampling(file) ? "Optimizing large dataset for rapid analysis..." : "Uploading...");
      try {
        const blob = await sampleFile(file, setStatus);
        setStatus("Uploading...");
        const res = await uploadFile(blob, file.name);
        sessionStorage.setItem(`workspace_${res.workspace_id}`, JSON.stringify(res));
        router.push(`/upload?workspace=${res.workspace_id}&dataset=${res.dataset_id}`);
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      }
    },
    [router]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="max-w-2xl w-full text-center space-y-6">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2">
          <Zap className="text-blue-600" size={32} />
          <span className="text-3xl font-bold text-slate-800 tracking-tight">myDataPartner</span>
        </div>
        <p className="text-slate-500 text-lg">
          AI-powered data profiling, transformation, and analytics.
        </p>

        {/* Mode selection */}
        {!mode && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setMode("ml")}
              className="group p-6 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left"
            >
              <BarChart3 className="text-blue-500 mb-3" size={28} />
              <h3 className="text-lg font-semibold text-slate-800">ML Model Prep</h3>
              <p className="text-sm text-slate-500 mt-1">
                Clean, profile, and transform your data with AI-suggested improvements.
              </p>
            </button>

            <button
              onClick={() => router.push("/analytics")}
              className="group p-6 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all text-left"
            >
              <Database className="text-emerald-500 mb-3" size={28} />
              <h3 className="text-lg font-semibold text-slate-800">Analytics Agent</h3>
              <p className="text-sm text-slate-500 mt-1">
                Build a dbt pipeline, create a semantic layer, and ask questions with AI.
              </p>
            </button>
          </div>
        )}

        {/* ML path — file upload (existing flow) */}
        {mode === "ml" && (
          <>
            <button
              onClick={() => setMode(null)}
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              &larr; Back
            </button>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !loading && inputRef.current?.click()}
              className={`mt-4 border-2 border-dashed rounded-2xl p-12 cursor-pointer transition-all
                ${dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white"}
                ${loading ? "opacity-60 pointer-events-none" : "hover:border-blue-400 hover:bg-slate-50"}`}
            >
              <UploadCloud className="mx-auto text-blue-400 mb-3" size={48} />
              <p className="font-semibold text-slate-700 text-lg">
                Drop a CSV file here
              </p>
              <p className="text-slate-400 text-sm mt-1">or click to select a file</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          </>
        )}

        {status && (
          <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 animate-pulse">
            {status}
          </div>
        )}
      </div>
    </main>
  );
}
