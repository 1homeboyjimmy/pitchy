export type AnalyzeResponse = {
  investment_score: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  market_summary: string;
};

export type AnalysisItem = AnalyzeResponse & {
  id: number;
  created_at: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatSession = {
  id: number;
  title: string;
  created_at: string;
};

export type UserProfile = {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  is_active: boolean;
  email_verified: boolean;
  is_social?: boolean;
  created_at: string;
};

export type Analytics = {
  range: { start: string; end: string };
  totals: {
    users: number;
    analyses: number;
    chat_sessions: number;
    chat_messages: number;
    errors: number;
  };
  series: Array<{
    date: string;
    users: number;
    analyses: number;
    chat_sessions: number;
    chat_messages: number;
    errors: number;
  }>;
};

export type ErrorItem = {
  id: number;
  user_id: number | null;
  path: string;
  method: string;
  status_code: number;
  detail: string;
  created_at: string;
};

export type ErrorResponse = {
  count: number;
  items: ErrorItem[];
};

export type TopUser = {
  id: number;
  email: string;
  name: string;
  analyses: number;
  messages: number;
  total: number;
};

export type ChatSearchItem = {
  id: number;
  session_id: number;
  title: string;
  role: string;
  content: string;
  created_at: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const COOKIE_SESSION_MARKER = "cookie-session";

async function request<T>(
  path: string,
  body?: unknown,
  token?: string | null,
  method: "GET" | "POST" | "DELETE" | "PATCH" = "POST"
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token && token !== COOKIE_SESSION_MARKER) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = typeof err?.detail === "string" ? err.detail : "Request failed";
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, body);
}

export async function postAuthJson<T>(
  path: string,
  body: unknown,
  token: string
): Promise<T> {
  return request<T>(path, body, token);
}

export async function getAuthJson<T>(path: string, token: string): Promise<T> {
  return request<T>(path, undefined, token, "GET");
}

export async function deleteAuth(path: string, token: string): Promise<void> {
  await request(path, undefined, token, "DELETE");
}

export async function patchAuthJson<T>(
  path: string,
  body: unknown,
  token: string
): Promise<T> {
  return request<T>(path, body, token, "PATCH");
}
