const BASE = "/api";

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isFormData = false
): Promise<T> {
  const opts: RequestInit = { method };
  if (body) {
    if (isFormData) {
      opts.body = body as FormData;
    } else {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json();
}

// ---- Types ----------------------------------------------------------------

export interface ColumnSchema {
  column_name: string;
  inferred_type: string;
  completeness_pct: number;
}

export interface Metadata {
  total_rows: number;
  total_columns: number;
  file_size_mb: number;
}

export interface UploadResponse {
  session_id: string;       // = dataset_id
  workspace_id: string;
  dataset_id: string;
  metadata: Metadata;
  schema_: ColumnSchema[];
}

export interface WorkspaceDataset {
  dataset_id: string;
  name: string;
  rows: number;
  columns: number;
}

export interface WorkspaceMeta {
  workspace_id: string;
  datasets: WorkspaceDataset[];
  active_dataset_id: string;
}

export interface AddDatasetResponse {
  workspace_id: string;
  dataset_id: string;
  name: string;
  rows: number;
  columns: number;
}

export interface SchemaResponse {
  columns: string[];
  schema_: ColumnSchema[];
}

export interface ShapeResponse {
  rows: number;
  columns: number;
}

export interface WorkspaceJoinResponse {
  workspace_id: string;
  new_dataset_id: string;
  rows: number;
  columns: number;
}

export interface Suggestions {
  renames: Record<string, string>;
  type_casts: Record<string, string>;
  imputations: Record<string, string>;
}

export interface SuggestResponse {
  suggestions: Suggestions;
  ai_available: boolean;
  message?: string;
}

export interface GlobalProfile {
  duplicate_rows: number;
  correlation_matrix: Record<string, Record<string, number | null>>;
}

export interface OutlierStats {
  iqr_lower?: number;
  iqr_upper?: number;
  iqr_outlier_count: number;
  zscore_outlier_count?: number;
  zscore_threshold?: number;
  negative_count?: number;
  outlier_values?: number[];
  iqr_lower_date?: string;
  iqr_upper_date?: string;
}

export interface ColumnProfile {
  column_name: string;
  data_type: string;
  total: number;
  missing: number;
  missing_pct: number;
  unique: number;
  stats?: Record<string, number | string | null>;
  distribution_data?: Array<Record<string, number | string>>;
  is_discrete?: boolean;
  frequency_data?: Array<{ bucket: string; count: number }>;
  frequency_data_weekly?: Array<{ bucket: string; count: number }>;
  frequency_data_monthly?: Array<{ bucket: string; count: number }>;
  word_frequency?: Array<{ word: string; count: number }>;
  outlier_stats?: OutlierStats;
}

export interface BoxDataItem {
  category: string;
  q1: number;
  median: number;
  q3: number;
  whisker_low: number;
  whisker_high: number;
  outliers: (number | null)[];
}

export interface RelationshipResult {
  analysis_type: "cont_cont" | "cat_cont" | "cat_cat";
  correlation?: { pearson: number; spearman: number } | null;
  regression?: { slope: number; intercept: number; r_squared: number; p_value: number } | null;
  scatter_data?: Array<{ x: number; y: number }> | null;
  box_data?: BoxDataItem[] | null;
  crosstab_data?: Record<string, Record<string, number>> | null;
  crosstab_columns?: string[] | null;
}

export interface DataframeInfo {
  info: Array<{ column: string; dtype: string; non_null_count: number; null_count: number }>;
  describe: Record<string, Record<string, number | null>>;
}

export interface PreviewData {
  head: Record<string, unknown>[];
  tail: Record<string, unknown>[];
  sample: Record<string, unknown>[];
  columns: string[];
}

export interface JoinResponse {
  session_id: string;
  total_rows: number;
  total_columns: number;
}

export interface CustomFieldPreview {
  preview_values: unknown[];
}

export interface CleanResult {
  session_id: string;
  rows_before: number;
  rows_after: number;
  columns_before: number;
  columns_after: number;
}

// ---- API calls ------------------------------------------------------------

export function uploadFile(blob: Blob, filename: string): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", blob, filename);
  return request("POST", "/upload", form, true);
}

export function getWorkspace(workspace_id: string): Promise<WorkspaceMeta> {
  return request("GET", `/workspace/${encodeURIComponent(workspace_id)}`);
}

export function addDatasetToWorkspace(workspace_id: string, blob: Blob, filename: string): Promise<AddDatasetResponse> {
  const form = new FormData();
  form.append("file", blob, filename);
  return request("POST", `/workspace/${encodeURIComponent(workspace_id)}/upload`, form, true);
}

export function getDataSchema(session_id: string): Promise<SchemaResponse> {
  return request("GET", `/data/schema?session_id=${encodeURIComponent(session_id)}`);
}

export function imputeColumn(
  dataset_id: string,
  column: string,
  strategy: string,
  opts: { constant_value?: string; group_by?: string; sort_by?: string; workspace_id?: string }
): Promise<ShapeResponse> {
  return request("POST", "/transform/impute", { dataset_id, column, strategy, workspace_id: opts.workspace_id ?? null, ...opts });
}

export function dropColumns(
  dataset_id: string,
  columns: string[],
  workspace_id?: string
): Promise<ShapeResponse> {
  return request("POST", "/transform/drop_columns", { dataset_id, columns, workspace_id: workspace_id ?? null });
}

export function mutateColumn(
  dataset_id: string,
  column_name: string,
  expression: string,
  workspace_id?: string
): Promise<ShapeResponse> {
  return request("POST", "/transform/mutate", { dataset_id, column_name, expression, workspace_id: workspace_id ?? null });
}

export function joinDatasets(body: {
  workspace_id: string;
  left_dataset_id: string;
  right_dataset_id: string;
  join_type: string;
  left_key: string;
  right_key: string;
}): Promise<WorkspaceJoinResponse> {
  return request("POST", "/transform/join", body);
}

export function suggestTransforms(
  session_id: string,
  user_context: string
): Promise<SuggestResponse> {
  return request("POST", "/transform/suggest", { session_id, user_context });
}

export function applyTransforms(
  session_id: string,
  renames: Record<string, string>,
  type_casts: Record<string, string>,
  imputations: Record<string, string>
): Promise<{ success: boolean }> {
  return request("POST", "/transform/apply", { session_id, renames, type_casts, imputations });
}

export function getGlobalProfile(session_id: string): Promise<GlobalProfile> {
  return request("GET", `/profile/global?session_id=${encodeURIComponent(session_id)}`);
}

export function getColumnProfile(
  session_id: string,
  column_name: string
): Promise<ColumnProfile> {
  return request(
    "GET",
    `/profile/column?session_id=${encodeURIComponent(session_id)}&column_name=${encodeURIComponent(column_name)}`
  );
}

export function getRelationship(
  session_id: string,
  x_column: string,
  y_column: string
): Promise<RelationshipResult> {
  return request(
    "GET",
    `/analyze/relationship?session_id=${encodeURIComponent(session_id)}&x_column=${encodeURIComponent(x_column)}&y_column=${encodeURIComponent(y_column)}`
  );
}

export function getPreview(session_id: string): Promise<PreviewData> {
  return request("GET", `/data/preview?session_id=${encodeURIComponent(session_id)}`);
}

export function getPreviewRandom(session_id: string): Promise<PreviewData> {
  return request("GET", `/data/preview?session_id=${encodeURIComponent(session_id)}&randomize=true`);
}

export function getDataframeInfo(session_id: string): Promise<DataframeInfo> {
  return request("GET", `/profile/dataframe-info?session_id=${encodeURIComponent(session_id)}`);
}

export function createJoin(
  left_session_id: string,
  right_session_id: string,
  left_keys: string[],
  right_keys: string[],
  how: string
): Promise<JoinResponse> {
  return request("POST", "/join", { left_session_id, right_session_id, left_keys, right_keys, how });
}

export function previewCustomField(
  session_id: string,
  column_name: string,
  expression: string
): Promise<CustomFieldPreview> {
  return request("POST", "/custom-field/preview", { session_id, column_name, expression });
}

export function applyCustomField(
  session_id: string,
  column_name: string,
  expression: string
): Promise<{ success: boolean }> {
  return request("POST", "/custom-field/apply", { session_id, column_name, expression });
}

export function applyClean(
  session_id: string,
  action: string,
  column?: string
): Promise<CleanResult> {
  return request("POST", "/clean", { session_id, action, column });
}
