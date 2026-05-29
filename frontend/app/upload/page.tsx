"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronRight, CheckCircle, XCircle } from "lucide-react";
import {
  type ColumnSchema,
  type Metadata,
  type Suggestions,
  suggestTransforms,
  applyTransforms,
} from "@/lib/api";

interface SessionData {
  session_id: string;
  metadata: Metadata;
  schema_: ColumnSchema[];
}

function UploadWizardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session") ?? "";

  const [step, setStep] = useState<1 | 2>(1);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [context, setContext] = useState("");
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch session info from the backend
  useEffect(() => {
    if (!sessionId) return;
    // We already have metadata from the upload response, stored in sessionStorage
    const raw = sessionStorage.getItem(`session_${sessionId}`);
    if (raw) {
      setSessionData(JSON.parse(raw));
    } else {
      setError("Session data not found. Please upload again.");
    }
  }, [sessionId]);

  // Store upload response in sessionStorage from landing page
  // (We pass it via sessionStorage since Next.js router doesn't carry state)
  // The landing page sets this before navigating.

  const handleSuggest = async () => {
    if (!sessionId) return;
    setLoadingSuggest(true);
    setError(null);
    try {
      const res = await suggestTransforms(sessionId, context);
      setAiAvailable(res.ai_available);
      setAiMessage(res.message ?? null);
      setSuggestions(res.suggestions);
      // Pre-accept all suggestions
      const acc: Record<string, boolean> = {};
      const allKeys = [
        ...Object.keys(res.suggestions.renames).map((k) => `rename:${k}`),
        ...Object.keys(res.suggestions.type_casts).map((k) => `type:${k}`),
        ...Object.keys(res.suggestions.imputations).map((k) => `impute:${k}`),
      ];
      allKeys.forEach((k) => (acc[k] = true));
      setAccepted(acc);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get suggestions");
    } finally {
      setLoadingSuggest(false);
    }
  };

  const skipToDashboard = () => router.push(`/dashboard/${sessionId}`);

  const handleConfirm = async () => {
    if (!suggestions || !sessionId) return;
    setApplying(true);
    setError(null);
    try {
      const renames: Record<string, string> = {};
      const type_casts: Record<string, string> = {};
      const imputations: Record<string, string> = {};

      Object.entries(suggestions.renames).forEach(([k, v]) => {
        if (accepted[`rename:${k}`]) renames[k] = v;
      });
      Object.entries(suggestions.type_casts).forEach(([k, v]) => {
        if (accepted[`type:${k}`]) type_casts[k] = v;
      });
      Object.entries(suggestions.imputations).forEach(([k, v]) => {
        if (accepted[`impute:${k}`]) imputations[k] = v;
      });

      await applyTransforms(sessionId, renames, type_casts, imputations);
      router.push(`/dashboard/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply transforms");
      setApplying(false);
    }
  };

  const toggle = (key: string) =>
    setAccepted((prev) => ({ ...prev, [key]: !prev[key] }));

  if (!sessionData && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading session…
      </div>
    );
  }

  if (error && !sessionData) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  const meta = sessionData!.metadata;
  const schema = sessionData!.schema_;

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <span className={step === 1 ? "font-semibold text-blue-600" : ""}>1. Review Data</span>
            <ChevronRight size={14} />
            <span className={step === 2 ? "font-semibold text-blue-600" : ""}>2. AI Suggestions</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Data Context Wizard</h1>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Metadata cards */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Total Rows", value: meta.total_rows.toLocaleString() },
                { label: "Columns", value: meta.total_columns },
                { label: "File Size", value: `${meta.file_size_mb} MB` },
              ].map((card) => (
                <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
                  <div className="text-2xl font-bold text-slate-800">{card.value}</div>
                  <div className="text-xs text-slate-500 mt-1">{card.label}</div>
                </div>
              ))}
            </div>

            {/* Schema table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
                Column Schema
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left">Column</th>
                      <th className="px-4 py-2 text-left">Inferred Type</th>
                      <th className="px-4 py-2 text-right">Completeness</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {schema.map((col) => (
                      <tr key={col.column_name} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-slate-700">{col.column_name}</td>
                        <td className="px-4 py-2 text-slate-500">{col.inferred_type}</td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={`font-medium ${
                              col.completeness_pct === 100
                                ? "text-green-600"
                                : col.completeness_pct >= 80
                                ? "text-yellow-600"
                                : "text-red-500"
                            }`}
                          >
                            {col.completeness_pct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Context textarea */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
              <label className="font-semibold text-slate-700 text-sm block">
                Business Context (optional)
              </label>
              <textarea
                className="w-full border border-slate-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                rows={4}
                placeholder="Add any structural goals, data descriptions, or business context…"
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSuggest}
                disabled={loadingSuggest}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {loadingSuggest ? "Analyzing with Claude AI…" : "Analyze with AI →"}
              </button>
              <button
                onClick={skipToDashboard}
                className="px-5 py-3 border border-slate-300 text-slate-600 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                title="Skip AI suggestions and go straight to the dashboard"
              >
                Skip →
              </button>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && suggestions && (
          <div className="space-y-6">
            {!aiAvailable && aiMessage && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                <span className="mt-0.5">⚠️</span>
                <div>
                  <strong>AI suggestions unavailable.</strong> {aiMessage}
                  <br />
                  You can still proceed directly to the dashboard without any transformations.
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 text-sm">
                {aiAvailable
                  ? "AI Transformation Suggestions — toggle to accept/reject each change"
                  : "No suggestions available"}
              </div>
              <div className="divide-y divide-slate-100">
                {/* Renames */}
                {Object.entries(suggestions.renames).map(([old, newName]) => (
                  <SuggestionRow
                    key={`rename:${old}`}
                    kind="Rename"
                    original={old}
                    proposed={newName}
                    checked={!!accepted[`rename:${old}`]}
                    onToggle={() => toggle(`rename:${old}`)}
                  />
                ))}
                {/* Type casts */}
                {Object.entries(suggestions.type_casts).map(([col, type]) => (
                  <SuggestionRow
                    key={`type:${col}`}
                    kind="Cast Type"
                    original={`${col} → object`}
                    proposed={`${col} → ${type}`}
                    checked={!!accepted[`type:${col}`]}
                    onToggle={() => toggle(`type:${col}`)}
                  />
                ))}
                {/* Imputations */}
                {Object.entries(suggestions.imputations).map(([col, strategy]) => (
                  <SuggestionRow
                    key={`impute:${col}`}
                    kind="Impute"
                    original={`${col}: missing values`}
                    proposed={`${col}: fill with ${strategy}`}
                    checked={!!accepted[`impute:${col}`]}
                    onToggle={() => toggle(`impute:${col}`)}
                  />
                ))}
                {Object.keys(suggestions.renames).length === 0 &&
                  Object.keys(suggestions.type_casts).length === 0 &&
                  Object.keys(suggestions.imputations).length === 0 && (
                    <div className="px-4 py-6 text-center text-slate-500 text-sm">
                      No transformations suggested — your dataset looks clean!
                    </div>
                  )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="px-5 py-3 border border-slate-300 text-slate-600 rounded-xl font-medium hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={applying}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {applying ? "Applying…" : "Confirm & Initialize Dashboard →"}
              </button>
            </div>
          </div>
        )}

        {/* Loading skeleton for step 2 */}
        {step === 2 && !suggestions && loadingSuggest && (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 bg-slate-200 rounded-xl" />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function SuggestionRow({
  kind,
  original,
  proposed,
  checked,
  onToggle,
}: {
  kind: string;
  original: string;
  proposed: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <button onClick={onToggle} className="shrink-0">
        {checked ? (
          <CheckCircle size={20} className="text-green-500" />
        ) : (
          <XCircle size={20} className="text-slate-300" />
        )}
      </button>
      <span className="text-xs font-semibold text-blue-600 uppercase w-20 shrink-0">{kind}</span>
      <span className="text-sm text-slate-500 line-through truncate flex-1">{original}</span>
      <ChevronRight size={14} className="text-slate-300 shrink-0" />
      <span className="text-sm text-slate-800 font-medium truncate flex-1">{proposed}</span>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>}>
      <UploadWizardInner />
    </Suspense>
  );
}
