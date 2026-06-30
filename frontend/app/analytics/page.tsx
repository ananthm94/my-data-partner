"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  Eye,
  FileCode2,
  Info,
  Layers,
  Loader2,
  MessageSquare,
  UploadCloud,
  Send,
  RotateCcw,
  Settings,
  Terminal,
} from "lucide-react";
import {
  configureAnalytics,
  uploadAnalyticsFiles,
  generateSources,
  generateStaging,
  generateSemantic,
  sendAnalyticsChat,
  getAnalyticsState,
  getAnalyticsSystemPrompt,
  getAnalyticsTables,
  resetAnalytics,
  type AnalyticsTableInfo,
  type AnalyticsPipelineState,
  type AnalyticsChatResponse,
  type AnalyticsChartSpec,
} from "@/lib/api";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const STEPS = [
  { label: "Upload", icon: UploadCloud },
  { label: "Sources", icon: Database },
  { label: "Staging", icon: FileCode2 },
  { label: "Semantic", icon: Layers },
  { label: "Chat", icon: MessageSquare },
];

export default function AnalyticsPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // LLM config
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [configured, setConfigured] = useState(false);
  const [showLLMConfig, setShowLLMConfig] = useState(false);

  // Pipeline state
  const [tables, setTables] = useState<AnalyticsTableInfo[]>([]);
  const [sourcesYaml, setSourcesYaml] = useState("");
  const [stagingModels, setStagingModels] = useState<Record<string, string>>({});
  const [dbtLog, setDbtLog] = useState("");
  const [semanticLayer, setSemanticLayer] = useState<Record<string, unknown>>({});
  const [messages, setMessages] = useState<Array<{ role: string; content: string; sql?: string; data?: Record<string, unknown>[]; chart?: AnalyticsChartSpec }>>([]);

  // Chat
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Transparency
  const [showArchitecture, setShowArchitecture] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const goToStep = (s: number) => {
    setStep(s);
    setMaxStep((prev) => Math.max(prev, s));
  };

  // Load existing state on mount — check both pipeline state and DuckDB tables
  useEffect(() => {
    Promise.all([
      getAnalyticsState().catch(() => null),
      getAnalyticsTables().catch(() => []),
    ]).then(([state, dbTables]) => {
      // Use DuckDB tables as source of truth, fall back to state
      const liveTables = dbTables && dbTables.length > 0 ? dbTables : state?.tables ?? [];
      if (liveTables.length > 0) setTables(liveTables);

      if (state) {
        if (state.sources_yaml) setSourcesYaml(state.sources_yaml);
        if (Object.keys(state.staging_models).length > 0) setStagingModels(state.staging_models);
        if (Object.keys(state.semantic_layer).length > 0) setSemanticLayer(state.semantic_layer);
        if (state.messages.length > 0) setMessages(state.messages);

        // Compute the highest reachable step from what's been completed
        let restored = 1;
        if (liveTables.length > 0) restored = 2;
        if (state.sources_status === "success") restored = 3;
        if (state.staging_status === "success") restored = 4;
        if (state.semantic_status === "success") restored = 5;

        setStep(state.current_step > 1 ? state.current_step : restored);
        setMaxStep(restored);

        if (state.sources_status === "success" || state.staging_status === "success" || state.semantic_status === "success") {
          setConfigured(true);
        }

        // Pre-fill provider/model from state if available
        if (state.sources_status === "success" && !provider) {
          // Provider was stored in state; we'll pick it up from the pipeline state
        }
      } else if (liveTables.length > 0) {
        // Tables exist in DuckDB but no pipeline state — start from step 2
        setStep(2);
        setMaxStep(2);
      }
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Handlers ──

  const handleConfigure = async () => {
    if (!apiKey.trim()) { setError("API key is required."); return; }
    setLoading(true);
    setError(null);
    try {
      await configureAnalytics({ llm_provider: provider, llm_api_key: apiKey, llm_model: model || null });
      setConfigured(true);
      setShowLLMConfig(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Configuration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const csvFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (csvFiles.length === 0) { setError("Only CSV files are supported."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await uploadAnalyticsFiles(csvFiles);
      setTables(res.tables);
      goToStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerateSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateSources();
      setSourcesYaml(res.sources_yaml);
      if (res.status === "success") goToStep(3);
      else setError(res.error || "Source generation failed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Source generation failed";
      if (/api.key|auth|unauthorized|invalid.*key|no.*key|not configured/i.test(msg)) { setConfigured(false); setShowLLMConfig(true); }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateStaging = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateStaging();
      setStagingModels(res.staging_models);
      setDbtLog(res.dbt_log);
      if (res.status === "success") goToStep(4);
      else setError(res.error || "Staging generation failed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Staging generation failed";
      if (/api.key|auth|unauthorized|invalid.*key|no.*key|not configured/i.test(msg)) { setConfigured(false); setShowLLMConfig(true); }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSemantic = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateSemantic();
      setSemanticLayer(res.semantic_layer);
      if (res.status === "success") goToStep(5);
      else setError(res.error || "Semantic generation failed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Semantic generation failed";
      if (/api.key|auth|unauthorized|invalid.*key|no.*key|not configured/i.test(msg)) { setConfigured(false); setShowLLMConfig(true); }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const res: AnalyticsChatResponse = await sendAnalyticsChat(userMsg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.response, sql: res.sql ?? undefined, data: res.data ?? undefined, chart: res.chart ?? undefined },
      ]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const isKeyError = /api.key|auth|unauthorized|invalid.*key|no.*key|not configured/i.test(errMsg);
      if (isKeyError) {
        setConfigured(false);
        setShowLLMConfig(true);
        setMessages((prev) => [...prev, { role: "assistant", content: "It looks like the API key is missing or invalid. Please configure your LLM settings to continue." }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${errMsg}` }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    try {
      await resetAnalytics();
      setStep(1);
      setMaxStep(1);
      setTables([]);
      setSourcesYaml("");
      setStagingModels({});
      setDbtLog("");
      setSemanticLayer({});
      setMessages([]);
      setConfigured(false);
      setApiKey("");
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/")} className="text-slate-400 hover:text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <Database className="text-emerald-500" size={22} />
          <span className="text-lg font-semibold text-slate-800">Analytics Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLLMConfig(true)}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-emerald-600 transition-colors"
          >
            <Settings size={14} /> LLM Config
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-500 transition-colors"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </header>

      {/* Stepper */}
      <div className="flex items-center justify-center gap-1 py-4 px-6">
        {STEPS.map((s, i) => {
          const stepNum = i + 1;
          const active = step === stepNum;
          const reachable = stepNum <= maxStep && stepNum !== step;
          const done = maxStep > stepNum;
          return (
            <div key={s.label} className="flex items-center">
              <button
                onClick={() => reachable && setStep(stepNum)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all
                  ${active ? "bg-emerald-100 text-emerald-700" : reachable ? "bg-emerald-50 text-emerald-600 cursor-pointer hover:bg-emerald-100" : "text-slate-400"}`}
              >
                {done ? <Check size={14} /> : <s.icon size={14} />}
                {s.label}
              </button>
              {i < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300 mx-1" />}
            </div>
          );
        })}
      </div>

      {/* Architecture overview */}
      <div className="mx-auto max-w-4xl px-6">
        <button
          onClick={() => setShowArchitecture(!showArchitecture)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-600 transition-colors py-1"
        >
          <Info size={14} />
          <span>How this pipeline works</span>
          {showArchitecture ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showArchitecture && (
          <div className="mt-2 mb-4 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="grid grid-cols-5 gap-3 text-center text-xs">
              {[
                { step: "1. Upload", desc: "CSV files loaded into an embedded DuckDB database — one table per file", color: "bg-blue-50 border-blue-200 text-blue-700" },
                { step: "2. Sources", desc: "LLM generates a dbt sources.yml describing your raw tables and columns", color: "bg-violet-50 border-violet-200 text-violet-700" },
                { step: "3. Staging", desc: "LLM generates staging SQL models — clean names, proper types, filtered rows — then dbt runs them", color: "bg-amber-50 border-amber-200 text-amber-700" },
                { step: "4. Semantic", desc: "LLM creates a semantic layer — entities, dimensions, measures, and relationships between tables", color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
                { step: "5. Chat", desc: "ReAct agent with data quality tools answers questions using SQL — explores, validates, and self-corrects", color: "bg-rose-50 border-rose-200 text-rose-700" },
              ].map((s, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div className={`w-full border rounded-lg p-3 ${s.color} ${step === i + 1 ? "ring-2 ring-offset-1 ring-emerald-400" : ""}`}>
                    <p className="font-semibold mb-1">{s.step}</p>
                    <p className="leading-snug opacity-80">{s.desc}</p>
                  </div>
                  {i < 4 && <ChevronRight size={14} className="text-slate-300 mt-2 hidden sm:block rotate-0" />}
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
              <p><strong>Stack:</strong> DuckDB (embedded warehouse) + dbt-core (transformations) + LangChain (multi-LLM) + LangGraph (pipeline orchestration)</p>
              <p><strong>Data lives in:</strong> <code className="bg-slate-100 px-1 rounded">data/warehouse.duckdb</code> and <code className="bg-slate-100 px-1 rounded">data/dbt_project/</code> — editable with any tool</p>
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-auto max-w-3xl px-6">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">
            {error}
            <button onClick={() => setError(null)} className="ml-2 font-semibold hover:underline">Dismiss</button>
          </div>
        </div>
      )}

      {/* LLM config overlay — accessible from header at any time */}
      {showLLMConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="relative">
            <button
              onClick={() => setShowLLMConfig(false)}
              className="absolute -top-3 -right-3 bg-white border border-slate-200 rounded-full w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 shadow-sm text-sm"
            >
              &times;
            </button>
            <LLMConfigInline
              provider={provider}
              setProvider={setProvider}
              apiKey={apiKey}
              setApiKey={setApiKey}
              model={model}
              setModel={setModel}
              loading={loading}
              onConfigure={handleConfigure}
            />
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Step 1: Upload — always accessible, no LLM needed */}
        {step === 1 && (
          <StepUpload loading={loading} onUpload={handleUpload} tables={tables} onNext={tables.length > 0 ? () => goToStep(2) : undefined} />
        )}

        {/* Steps 2-5: require LLM configuration */}
        {step >= 2 && !configured && (
          <LLMConfigInline
            provider={provider}
            setProvider={setProvider}
            apiKey={apiKey}
            setApiKey={setApiKey}
            model={model}
            setModel={setModel}
            loading={loading}
            onConfigure={handleConfigure}
          />
        )}

        {step >= 2 && configured && (
          <>
            {/* Step 2: Sources */}
            {step === 2 && (
              <StepSources
                loading={loading}
                sourcesYaml={sourcesYaml}
                tables={tables}
                onGenerate={handleGenerateSources}
                onNext={() => goToStep(3)}
              />
            )}

            {/* Step 3: Staging */}
            {step === 3 && (
              <StepStaging
                loading={loading}
                models={stagingModels}
                dbtLog={dbtLog}
                onGenerate={handleGenerateStaging}
                onNext={() => goToStep(4)}
              />
            )}

            {/* Step 4: Semantic */}
            {step === 4 && (
              <StepSemantic
                loading={loading}
                semantic={semanticLayer}
                onGenerate={handleGenerateSemantic}
                onNext={() => goToStep(5)}
              />
            )}

            {/* Step 5: Chat */}
            {step === 5 && (
              <StepChat
                loading={loading}
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                onSend={handleChat}
                chatEndRef={chatEndRef}
                tables={tables}
                sourcesYaml={sourcesYaml}
                stagingModels={stagingModels}
                semanticLayer={semanticLayer}
                systemPrompt={systemPrompt}
                onLoadSystemPrompt={() => {
                  getAnalyticsSystemPrompt()
                    .then((res) => setSystemPrompt(res.system_prompt))
                    .catch(() => setSystemPrompt("Failed to load system prompt."));
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

// ── LLM Config (inline for steps 2-5) ──────────────────────

function LLMConfigInline({ provider, setProvider, apiKey, setApiKey, model, setModel, loading, onConfigure }: {
  provider: string;
  setProvider: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  loading: boolean;
  onConfigure: () => void;
}) {
  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">Configure LLM</h2>
        <p className="text-sm text-slate-500">An API key is needed to generate models and chat. Your key is stored in memory only — never saved to disk.</p>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Model (optional)</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave empty for default"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={onConfigure}
          disabled={loading}
          className="w-full bg-emerald-600 text-white rounded-lg py-2 font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Configuring..." : "Continue"}
        </button>
      </div>
    </div>
  );
}

// ── Step components ──────────────────────────────────────────

function StepUpload({ loading, onUpload, tables, onNext }: {
  loading: boolean;
  onUpload: (files: FileList | null) => void;
  tables: AnalyticsTableInfo[];
  onNext?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-800">Upload CSV Files</h2>
      <p className="text-sm text-slate-500">Upload one or more CSV files to load into the DuckDB warehouse.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onUpload(e.dataTransfer.files); }}
        onClick={() => !loading && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-all text-center
          ${dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-white"}
          ${loading ? "opacity-60 pointer-events-none" : "hover:border-emerald-400 hover:bg-slate-50"}`}
      >
        <UploadCloud className="mx-auto text-emerald-400 mb-3" size={40} />
        <p className="font-semibold text-slate-700">Drop CSV files here</p>
        <p className="text-slate-400 text-sm mt-1">or click to select files</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> Uploading and loading into DuckDB...
        </div>
      )}

      {tables.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Table</th>
                <th className="text-right px-4 py-2 font-medium">Rows</th>
                <th className="text-right px-4 py-2 font-medium">Columns</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-emerald-700">{t.name}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{t.row_count.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{t.columns.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onNext && tables.length > 0 && (
        <button onClick={onNext} className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2">
          Continue <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

function StepSources({ loading, sourcesYaml, tables, onGenerate, onNext }: {
  loading: boolean;
  sourcesYaml: string;
  tables: AnalyticsTableInfo[];
  onGenerate: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-800">Generate dbt Sources</h2>
      <p className="text-sm text-slate-500">
        AI will generate a <code className="bg-slate-100 px-1 rounded">sources.yml</code> for your {tables.length} table{tables.length !== 1 ? "s" : ""}.
      </p>

      <button
        onClick={onGenerate}
        disabled={loading}
        className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {loading ? <><Loader2 className="animate-spin" size={16} /> Generating...</> : "Generate Sources"}
      </button>

      {sourcesYaml && (
        <>
          <div className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto">
            <pre className="text-sm font-mono whitespace-pre-wrap">{sourcesYaml}</pre>
          </div>
          <button onClick={onNext} className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2">
            Continue <ChevronRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function StepStaging({ loading, models, dbtLog, onGenerate, onNext }: {
  loading: boolean;
  models: Record<string, string>;
  dbtLog: string;
  onGenerate: () => void;
  onNext: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const modelNames = Object.keys(models);

  useEffect(() => {
    if (modelNames.length > 0 && !activeTab) setActiveTab(modelNames[0]);
  }, [modelNames, activeTab]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-800">Generate Staging Models</h2>
      <p className="text-sm text-slate-500">
        AI will generate staging SQL models with cleaned column names and proper types.
      </p>

      <button
        onClick={onGenerate}
        disabled={loading}
        className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {loading ? <><Loader2 className="animate-spin" size={16} /> Generating &amp; running dbt...</> : "Generate Staging Models"}
      </button>

      {modelNames.length > 0 && (
        <>
          <div className="flex gap-1 border-b border-slate-200">
            {modelNames.map((name) => (
              <button
                key={name}
                onClick={() => setActiveTab(name)}
                className={`px-3 py-1.5 text-sm font-medium rounded-t transition-colors
                  ${activeTab === name ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}
              >
                {name}
              </button>
            ))}
          </div>
          {activeTab && models[activeTab] && (
            <div className="bg-slate-900 text-slate-100 rounded-b-xl rounded-tr-xl p-4 overflow-x-auto">
              <pre className="text-sm font-mono whitespace-pre-wrap">{models[activeTab]}</pre>
            </div>
          )}
        </>
      )}

      {dbtLog && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700 font-medium">dbt run log</summary>
          <pre className="mt-2 bg-slate-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap text-slate-600 overflow-x-auto">{dbtLog}</pre>
        </details>
      )}

      {modelNames.length > 0 && (
        <button onClick={onNext} className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2">
          Continue <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

function StepSemantic({ loading, semantic, onGenerate, onNext }: {
  loading: boolean;
  semantic: Record<string, unknown>;
  onGenerate: () => void;
  onNext: () => void;
}) {
  const entities = (semantic.entities as Array<Record<string, unknown>>) || [];
  const relationships = (semantic.relationships as Array<Record<string, unknown>>) || [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-800">Generate Semantic Layer</h2>
      <p className="text-sm text-slate-500">
        AI will create a semantic layer defining entities, dimensions, measures, and relationships.
      </p>

      <button
        onClick={onGenerate}
        disabled={loading}
        className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {loading ? <><Loader2 className="animate-spin" size={16} /> Generating...</> : "Generate Semantic Layer"}
      </button>

      {entities.length > 0 && (
        <div className="space-y-3">
          {entities.map((entity, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <h3 className="font-semibold text-slate-800 text-base">{String(entity.name)}</h3>
              <p className="text-sm text-slate-500">{String(entity.description || "")}</p>
              <p className="text-xs text-slate-400 mt-1">Table: <code className="bg-slate-100 px-1 rounded">{String(entity.table)}</code></p>

              {Array.isArray(entity.dimensions) && entity.dimensions.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Dimensions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(entity.dimensions as Array<Record<string, unknown>>).map((d, j) => (
                      <span key={j} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{String(d.name)}</span>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(entity.measures) && entity.measures.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Measures</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(entity.measures as Array<Record<string, unknown>>).map((m, j) => (
                      <span key={j} className="bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded-full">{String(m.name)}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {relationships.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Relationships</p>
              {relationships.map((r, i) => (
                <p key={i} className="text-sm text-slate-600">
                  <span className="font-medium">{String(r.from_entity)}</span>
                  <span className="text-slate-400"> &rarr; </span>
                  <span className="font-medium">{String(r.to_entity)}</span>
                  <span className="text-slate-400 ml-2">({String(r.type)})</span>
                </p>
              ))}
            </div>
          )}

          <button onClick={onNext} className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-2">
            Start Chatting <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function StepChat({ loading, messages, chatInput, setChatInput, onSend, chatEndRef, tables, sourcesYaml, stagingModels, semanticLayer, systemPrompt, onLoadSystemPrompt }: {
  loading: boolean;
  messages: Array<{ role: string; content: string; sql?: string; data?: Record<string, unknown>[]; chart?: AnalyticsChartSpec }>;
  chatInput: string;
  setChatInput: (v: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  tables: AnalyticsTableInfo[];
  sourcesYaml: string;
  stagingModels: Record<string, string>;
  semanticLayer: Record<string, unknown>;
  systemPrompt: string | null;
  onLoadSystemPrompt: () => void;
}) {
  const [showContext, setShowContext] = useState(false);
  const [contextTab, setContextTab] = useState<"summary" | "sources" | "staging" | "semantic" | "prompt">("summary");
  const entities = (semanticLayer.entities as Array<Record<string, unknown>>) || [];
  const relationships = (semanticLayer.relationships as Array<Record<string, unknown>>) || [];

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold text-slate-800">Ask your data</h2>
        <button
          onClick={() => {
            setShowContext(!showContext);
            if (!showContext && !systemPrompt) onLoadSystemPrompt();
          }}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${
            showContext ? "bg-emerald-100 text-emerald-700" : "text-slate-500 hover:text-emerald-600 hover:bg-slate-100"
          }`}
        >
          <Eye size={14} />
          {showContext ? "Hide context" : "What the agent sees"}
        </button>
      </div>

      {/* Context panel */}
      {showContext && (
        <div className="mb-3 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-100 overflow-x-auto">
            {([
              { id: "summary", label: "Summary" },
              { id: "sources", label: "Sources YAML" },
              { id: "staging", label: "Staging SQL" },
              { id: "semantic", label: "Semantic Layer" },
              { id: "prompt", label: "System Prompt" },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setContextTab(tab.id);
                  if (tab.id === "prompt" && !systemPrompt) onLoadSystemPrompt();
                }}
                className={`px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  contextTab === tab.id
                    ? "border-b-2 border-emerald-500 text-emerald-700 bg-emerald-50/50"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="p-4 max-h-64 overflow-y-auto">
            {contextTab === "summary" && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-slate-700 mb-1">Tables in DuckDB</p>
                  <div className="flex flex-wrap gap-2">
                    {tables.map((t) => (
                      <span key={t.name} className="bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full font-mono">
                        {t.name} <span className="opacity-60">({t.row_count.toLocaleString()} rows, {t.columns.length} cols)</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium text-slate-700 mb-1">Staging Models</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(stagingModels).map((name) => (
                      <span key={name} className="bg-amber-50 text-amber-700 text-xs px-2.5 py-1 rounded-full font-mono">{name}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium text-slate-700 mb-1">Semantic Layer</p>
                  <p className="text-slate-600 text-xs">
                    {entities.length} entities, {entities.reduce((acc, e) => acc + ((e.dimensions as unknown[])?.length || 0), 0)} dimensions, {entities.reduce((acc, e) => acc + ((e.measures as unknown[])?.length || 0), 0)} measures, {relationships.length} relationships
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    <strong>Agent tools:</strong> run_sql, get_schema, profile_column, detect_outliers
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    The agent explores data quality first, checks for outliers and NULLs, refines queries, then validates before answering.
                  </p>
                </div>
              </div>
            )}
            {contextTab === "sources" && (
              <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap">{sourcesYaml || "No sources generated yet."}</pre>
            )}
            {contextTab === "staging" && (
              <div className="space-y-3">
                {Object.entries(stagingModels).map(([name, sql]) => (
                  <div key={name}>
                    <p className="text-xs font-semibold text-slate-600 mb-1 font-mono">{name}</p>
                    <pre className="text-xs font-mono bg-slate-50 rounded-lg p-3 text-slate-700 whitespace-pre-wrap overflow-x-auto">{sql}</pre>
                  </div>
                ))}
                {Object.keys(stagingModels).length === 0 && <p className="text-xs text-slate-500">No staging models generated yet.</p>}
              </div>
            )}
            {contextTab === "semantic" && (
              <div className="space-y-2">
                {entities.map((entity, i) => (
                  <div key={i} className="text-xs">
                    <p className="font-semibold text-slate-700">{String(entity.name)} <span className="font-normal text-slate-400">({String(entity.table)})</span></p>
                    <p className="text-slate-500 ml-2">
                      Dimensions: {((entity.dimensions as Array<Record<string, unknown>>) || []).map((d) => String(d.name)).join(", ") || "none"}
                    </p>
                    <p className="text-slate-500 ml-2">
                      Measures: {((entity.measures as Array<Record<string, unknown>>) || []).map((m) => String(m.name)).join(", ") || "none"}
                    </p>
                  </div>
                ))}
                {relationships.length > 0 && (
                  <div className="text-xs pt-2 border-t border-slate-100">
                    <p className="font-semibold text-slate-700 mb-1">Relationships</p>
                    {relationships.map((r, i) => (
                      <p key={i} className="text-slate-500">{String(r.from_entity)} → {String(r.to_entity)} ({String(r.type)})</p>
                    ))}
                  </div>
                )}
                {entities.length === 0 && <p className="text-xs text-slate-500">No semantic layer generated yet.</p>}
              </div>
            )}
            {contextTab === "prompt" && (
              <div>
                <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                  <Terminal size={12} /> This is the exact system prompt sent to the LLM on each message:
                </p>
                <pre className="text-xs font-mono bg-slate-900 text-slate-200 rounded-lg p-4 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                  {systemPrompt || "Loading..."}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <MessageSquare className="mx-auto mb-3" size={40} />
            <p>Ask a question about your data and the AI will write SQL to answer it.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-emerald-600 text-white"
                  : "bg-white border border-slate-200 text-slate-700"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.sql && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">SQL query</summary>
                  <pre className="mt-1 bg-slate-900 text-slate-100 rounded-lg p-2 text-xs font-mono overflow-x-auto">{msg.sql}</pre>
                </details>
              )}
              {msg.chart && <ChatChart chart={msg.chart} />}
              {msg.data && msg.data.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">Data ({msg.data.length} rows)</summary>
                  <div className="mt-1 overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          {Object.keys(msg.data[0]).map((k) => (
                            <th key={k} className="border border-slate-200 px-2 py-1 bg-slate-50 text-left font-medium">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.data.slice(0, 20).map((row, ri) => (
                          <tr key={ri}>
                            {Object.values(row).map((v, ci) => (
                              <td key={ci} className="border border-slate-200 px-2 py-1">{String(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-400 flex items-center gap-2">
              <Loader2 className="animate-spin" size={14} /> Analyzing data...
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-3 border-t border-slate-200">
        <input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !loading && onSend()}
          placeholder="Ask a question about your data..."
          className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-400"
          disabled={loading}
        />
        <button
          onClick={onSend}
          disabled={loading || !chatInput.trim()}
          className="px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function ChatChart({ chart }: { chart: AnalyticsChartSpec }) {
  const { chart_type, title, x_key, y_key, data } = chart;
  if (!data || data.length === 0) return null;

  return (
    <div className="mt-3 bg-slate-50 rounded-xl p-4 border border-slate-200">
      <p className="text-xs font-semibold text-slate-600 mb-3">{title}</p>
      <div className="w-full" style={{ height: Math.min(300, 40 + data.length * 28) }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart_type === "pie" ? (
            <PieChart>
              <Pie
                data={data}
                dataKey={y_key}
                nameKey={x_key}
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          ) : chart_type === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey={y_key} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          ) : chart_type === "horizontal_bar" ? (
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis dataKey={x_key} type="category" tick={{ fontSize: 11 }} stroke="#94a3b8" width={120} />
              <Tooltip />
              <Bar dataKey={y_key} fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={x_key} tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey={y_key} fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
