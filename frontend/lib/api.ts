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
  session_id: string;
  metadata: Metadata;
  schema_: ColumnSchema[];
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

export interface ColumnProfile {
  column_name: string;
  data_type: string;
  total: number;
  missing: number;
  missing_pct: number;
  unique: number;
  stats?: Record<string, number | string | null>;
  distribution_data?: Array<Record<string, number | string>>;
  frequency_data?: Array<{ bucket: string; count: number }>;
  word_frequency?: Array<{ word: string; count: number }>;
}

export interface RelationshipResult {
  correlation: { pearson: number; spearman: number };
  regression: { slope: number; intercept: number; r_squared: number; p_value: number };
  scatter_data: Array<{ x: number; y: number }>;
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
