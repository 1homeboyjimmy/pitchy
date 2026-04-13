export type AnalyzeResponse = {
  investment_score: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  market_summary: string;
};

export type AnalysisItem = AnalyzeResponse & {
  id: number;
  name: string;
  created_at: string;
};



export type AnalysisResult = {
  name: string;
  score: number;
  breakdown: {
    market: number;
    team: number;
    product: number;
    traction: number;
    financials: number;
  };
  strengths: string[];
  risks: string[];
  recommendation: string;
  summary: string;
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

export type PresentationSlide = {
  type: string;
  title?: string;
  subtitle?: string;
  content?: string | string[];
};

export type UserProfile = {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  is_active: boolean;
  email_verified: boolean;
  is_social?: boolean;
  subscription_tier?: string;
  cookie_consent?: boolean | null;
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
    paid_subscriptions?: number;
  };
  series: Array<{
    date: string;
    users: number;
    analyses: number;
    chat_sessions: number;
    chat_messages: number;
    errors: number;
    paid_subscriptions?: number;
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

// Use relative paths so Next.js rewrites can proxy to the backend
const API_BASE = "";
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
    // Handle expired/invalid token globally
    if (res.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem("vi_auth_state");
      // Avoid redirect loops on auth pages
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?expired=1";
      }
      throw new Error("Invalid token");
    }
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

export type ChatSessionCreateRequest = {
  title: string;
  initial_message?: string;
};

export type ChatSessionResponse = {
  id: number;
  title: string;
  created_at: string;
  analysis_id?: number;
};

export type AnalysisResponse = {
  id: number;
  name: string;
  category: string | null;
  investment_score: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  market_summary: string;
  created_at: string;
};

export type ChatSessionDetailResponse = ChatSessionResponse & {
  messages: ChatMessageResponse[];
  analysis?: AnalysisResponse | null;
};

export type ChatMessageResponse = {
  id: number;
  role: "user" | "assistant";
  content: string;
  thoughts?: string;
  sources?: { title: string; url: string }[];
  created_at: string;
  feedback?: number;
  client_id?: string;
};

export async function getChatSessions(token: string): Promise<ChatSessionResponse[]> {
  return getAuthJson<ChatSessionResponse[]>("/chat/sessions", token);
}

export async function getChatSession(id: number, token: string): Promise<ChatSessionDetailResponse> {
  return getAuthJson<ChatSessionDetailResponse>(`/chat/sessions/${id}`, token);
}

export async function createChatSession(data: ChatSessionCreateRequest, token: string): Promise<ChatSessionDetailResponse> {
  return postAuthJson<ChatSessionDetailResponse>("/chat/sessions", data, token);
}

export async function createChatSessionAuto(initial_message: string, token: string): Promise<ChatSessionDetailResponse> {
  return postAuthJson<ChatSessionDetailResponse>("/chat/sessions/auto", { initial_message }, token);
}

export async function createGuestIntent(initial_message: string): Promise<{ intent_id: string }> {
  return postJson<{ intent_id: string }>("/guest/intents", { initial_message });
}

export async function createChatSessionFromIntent(intent_id: string, token: string): Promise<ChatSessionDetailResponse> {
  return postAuthJson<ChatSessionDetailResponse>("/chat/sessions/from-intent", { intent_id }, token);
}

export async function deleteChatSession(id: number, token: string): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE}/chat/sessions/${id}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Error deleting session");
  }
  return response.json();
}

export async function sendChatMessage(sessionId: number, content: string, token: string): Promise<ChatMessageResponse> {
  return postAuthJson<ChatMessageResponse>(`/chat/sessions/${sessionId}/messages`, { content }, token);
}

export async function* sendChatMessageStream(
    sessionId: number,
    content: string,
    token: string,
    signal?: AbortSignal,
    userClientId?: string,
    assistantClientId?: string,
    useDeepSearch: boolean = false,
    useResearch: boolean = false
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token && token !== COOKIE_SESSION_MARKER) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, client_id: userClientId, assistant_client_id: assistantClientId, use_deep_search: useDeepSearch, use_research: useResearch }),
    credentials: "include",
    signal
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem("vi_auth_state");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?expired=1";
      }
    }
    throw new Error("Stream request failed");
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        try {
          yield JSON.parse(line);
        } catch (e) {
          console.error("Error parsing stream line", e, line);
        }
      }
    }
  }
}

export async function sendChatMessageFeedback(sessionId: number, messageId: number, feedback: number, token: string): Promise<{ status: string; feedback: number }> {
  return postAuthJson<{ status: string; feedback: number }>(`/chat/sessions/${sessionId}/messages/${messageId}/feedback`, { feedback }, token);
}

export async function createPayment(tier: string, is_annual: boolean, promo_code: string | null, token: string): Promise<{ confirmation_url: string }> {
  return postAuthJson<{ confirmation_url: string }>("/billing/create-payment", { tier, is_annual, promo_code }, token);
}

export async function validatePromoCode(code: string): Promise<{ valid: boolean, discount_percent: number, detail?: string }> {
  const response = await fetch(`${API_BASE}/billing/promo/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  return response.json();
}

export type UserResponse = {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
  is_social: boolean;
  subscription_tier: string;
  subscription_expires_at: string | null;
  cookie_consent?: boolean | null;
};

export async function getMe(token: string): Promise<UserResponse> {
  return getAuthJson<UserResponse>("/me", token);
}

/* ——— Tree (Decision Tree) ——— */

export type TreeInputResponse = {
  field: string;
  label: string;
  type: string;
  options?: string[] | null;
  placeholder?: string | null;
  required: boolean;
  status: "empty" | "partial" | "completed";
  value?: unknown;
};

export type TreeNextActionResponse = {
  title: string;
  target_block?: string | null;
  reason?: string | null;
};

export type TreeFormSchemaItem = {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

export type TreeNodeDataResponse = {
  description?: string | null;
  completion_criteria?: Record<string, string>;
  inputs?: TreeInputResponse[];
  outputs?: Record<string, string>;
  next_action?: TreeNextActionResponse | null;
  chat_hint?: string | null;
  risks?: string[];
  dependencies?: string[];
  aiRecommendation?: string | null;
  sourceRef?: string | null;
  form_schema?: TreeFormSchemaItem[];
  form_data?: Record<string, string>;
  summary?: Record<string, string> | null;
  feedback?: string | null;
};

export type TreeNodeResponse = {
  id: string;
  type: "core" | "optional" | "conditional";
  status: "empty" | "partial" | "completed" | "critical" | "skipped";
  label: string;
  category?: string | null;
  level: number;
  required?: boolean;
  priority?: number;
  impact_score?: number;
  data: TreeNodeDataResponse;
  parent_id: string | null;
  children_ids: string[];
};

export type TreeEdgeResponse = {
  id: string;
  source: string;
  target: string;
};

export type TreeResponse = {
  id: number;
  title: string;
  tree_data: {
    nodes: TreeNodeResponse[];
    edges: TreeEdgeResponse[];
  };
  readiness_index: number;
  status: string;
  source_type: string;
  created_at: string;
};

export type RagSearchResponse = {
  context: string;
};

export type ImportContextRequest = {
  text: string;
  session_id?: number | null;
};

export type ProjectContextType = {
  project_name?: string | null;
  problem?: string | null;
  solution?: string | null;
  target_audience?: string | null;
  features?: string[];
  raw_text?: string | null;
};

export type ImportContextResponse = {
  success: boolean;
  message?: string;
  summary?: ProjectContextType;
};

export async function importContext(data: ImportContextRequest, token: string): Promise<ImportContextResponse> {
  return postAuthJson<ImportContextResponse>("/chat/import-context", data, token);
}

export type TreeChatResponse = {
  reply: string;
  tree_data: {
    nodes: TreeNodeResponse[];
    edges: TreeEdgeResponse[];
  };
  readiness_index: number;
  hints?: string[];
  model?: string;
};

export async function getTreeList(token: string): Promise<TreeResponse[]> {
  return getAuthJson<TreeResponse[]>("/tree/list", token);
}

export async function getTree(treeId: number, token: string): Promise<TreeResponse> {
  return getAuthJson<TreeResponse>(`/tree/${treeId}`, token);
}

export async function getTreeChatHistory(
  treeId: number, 
  token: string, 
  nodeId?: string
): Promise<{ history: { role: string; content: string; thoughts?: string; model_used?: string; timestamp: string; client_id?: string }[] }> {
  const url = nodeId ? `/tree/${treeId}/history?node_id=${nodeId}` : `/tree/${treeId}/history`;
  return getAuthJson<{ history: { role: string; content: string; thoughts?: string; model_used?: string; timestamp: string; client_id?: string }[] }>(url, token);
}


export async function createTreeFromText(description: string, token: string): Promise<TreeResponse> {
  return postAuthJson<TreeResponse>("/tree/create", { description }, token);
}

export async function* postTreeChatStream(
  treeId: number,
  message: string,
  token: string,
  activeNodeId?: string,
  signal?: AbortSignal,
  clientId?: string,
  assistantClientId?: string,
  useDeepSearch?: boolean
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token && token !== COOKIE_SESSION_MARKER) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/tree/${treeId}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, active_node_id: activeNodeId, client_id: clientId, assistant_client_id: assistantClientId, use_deep_search: useDeepSearch }),
    credentials: "include",
    signal
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem("vi_auth_state");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?expired=1";
      }
    }
    throw new Error("Tree stream request failed");
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        try {
          yield JSON.parse(line);
        } catch (e) {
          console.error("Error parsing stream line", e, line);
        }
      }
    }
  }
}

export async function deleteTree(treeId: number, token: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/tree/${treeId}`, undefined, token, "DELETE");
}

export async function evaluateNode(
  treeId: number, 
  node_id: string, 
  form_data: Record<string, string>, 
  token: string
): Promise<TreeResponse> {
  return postAuthJson<TreeResponse>(`/tree/${treeId}/evaluate-node`, { node_id, form_data }, token);
}

/* ——— Tools ——— */

export type ToolResultResponse = {
  id: number;
  query: string;
  tool_type: "quick-search" | "deep-research";
  content: string;
  sources: { title: string; url: string }[] | null;
  created_at: string;
};

export async function getToolsHistory(token: string): Promise<ToolResultResponse[]> {
  return getAuthJson<ToolResultResponse[]>("/api/tools/history", token);
}

export async function getToolResult(id: number, token: string): Promise<ToolResultResponse> {
  return getAuthJson<ToolResultResponse>(`/api/tools/results/${id}`, token);
}

export async function deleteToolResult(id: number, token: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/tools/results/${id}`, undefined, token, "DELETE");
}

export async function toolQuickSearch(query: string, token: string): Promise<ToolResultResponse> {
  return postAuthJson<ToolResultResponse>("/api/tools/quick-search", { query }, token);
}

export async function toolDeepResearch(query: string, token: string): Promise<ToolResultResponse> {
  return postAuthJson<ToolResultResponse>("/api/tools/deep-research", { query }, token);
}
