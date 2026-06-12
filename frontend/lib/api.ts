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
  html?: string;
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

// Перевод известных серверных сообщений (англ.) на русский для понятных ошибок
// входа/регистрации. Неизвестные строки отдаём как есть.
function translateAuthDetail(msg: string): string {
  const map: Record<string, string> = {
    "Invalid credentials": "Неверный email или пароль",
    "Invalid token": "Сессия истекла, войдите снова",
    "User is blocked": "Аккаунт заблокирован",
    "User is temporarily locked": "Слишком много попыток входа. Попробуйте через 15 минут.",
    "Email is not verified": "Email не подтверждён — проверьте почту",
    "Email already registered": "Этот email уже зарегистрирован",
    "Too many requests": "Слишком много запросов, попробуйте позже",
  };
  return map[msg] || msg;
}

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
  // Маркер «это API-вызов клиента». Next.js страницы и API бэкенда делят пути
  // (/grants, /projects), а cookie-session-юзеры НЕ шлют Authorization. Поэтому
  // навигацию браузера (нет заголовка) рендерим страницей, а fetch из api.ts
  // (есть заголовок) проксируем на бэкенд. Работает и за Caddy Basic Auth.
  headers["x-pitchy-api"] = "1";
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    // 401 на самих auth-эндпоинтах (/auth/login и т.п.) — это «неверный
    // логин/пароль», а НЕ «протухла сессия». Глобальный авто-логаут с подменой
    // текста на "Invalid token" к ним применять нельзя: пользователь должен
    // увидеть реальную причину. Поэтому глобальную обработку 401 пропускаем для
    // /auth/* и отдаём настоящий detail (с переводом на русский ниже).
    const isAuthEndpoint = path.startsWith("/auth/");
    // Handle expired/invalid token globally
    if (res.status === 401 && !isAuthEndpoint && typeof window !== "undefined") {
      window.localStorage.removeItem("vi_auth_state");
      // Avoid redirect loops on auth pages
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?expired=1";
      }
      throw new Error("Invalid token");
    }
    const err = await res.json().catch(() => ({}));
    const d = err?.detail;
    let detail = "Request failed";
    if (typeof d === "string") {
      detail = translateAuthDetail(d);
    } else if (Array.isArray(d)) {
      // FastAPI 422 returns detail as an array of { loc, msg, type, ... }.
      // Translate common pydantic messages so users see something useful
      // instead of the generic "Request failed".
      const translate = (m: string): string => {
        if (/Password must contain letters and numbers/i.test(m)) return "Пароль должен содержать буквы и цифры";
        const minMatch = m.match(/at least (\d+) character/i);
        if (minMatch) return `Минимум ${minMatch[1]} символов`;
        const maxMatch = m.match(/at most (\d+) character/i);
        if (maxMatch) return `Максимум ${maxMatch[1]} символов`;
        if (/value is not a valid email|valid email address/i.test(m)) return "Неверный формат email";
        if (/Field required/i.test(m)) return "Поле обязательно";
        return m;
      };
      const parts = d
        .map((e: { msg?: string }) => translate(e?.msg || ""))
        .filter(Boolean);
      if (parts.length) detail = parts.join("; ");
    }
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
  project_id?: number | null;
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
    useResearch: boolean = false,
    intent?: string,
    regenerateDeck: boolean = false
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token && token !== COOKIE_SESSION_MARKER) {
    headers.Authorization = `Bearer ${token}`;
  }
  // Маркер «это API-вызов клиента». Next.js страницы и API бэкенда делят пути
  // (/grants, /projects), а cookie-session-юзеры НЕ шлют Authorization. Поэтому
  // навигацию браузера (нет заголовка) рендерим страницей, а fetch из api.ts
  // (есть заголовок) проксируем на бэкенд. Работает и за Caddy Basic Auth.
  headers["x-pitchy-api"] = "1";
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content,
      client_id: userClientId,
      assistant_client_id: assistantClientId,
      use_deep_search: useDeepSearch,
      use_research: useResearch,
      intent,
      regenerate_deck: regenerateDeck,
    }),
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
    let errorDetail = "Stream request failed";
    try {
        const errorData = await res.json();
        if (errorData && errorData.detail) {
            errorDetail = `API_ERROR:${errorData.detail}`;
        } else if (res.status === 403) {
            errorDetail = "API_ERROR:Функция недоступна на вашем тарифе";
        }
    } catch (e) {
        // ignore json parse error
    }
    throw new Error(errorDetail);
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE spec uses CRLF; sse-starlette emits \r\n\r\n between events.
    // Accept both \r\n\r\n and \n\n so the parser works with any backend.
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const lines = event.split(/\r?\n/);
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }
        if (trimmedLine.startsWith('data:')) {
          const dataStr = trimmedLine.substring(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            yield JSON.parse(dataStr);
          } catch (e) {
            console.error("Error parsing stream line", e, dataStr);
          }
        } else if (trimmedLine.startsWith('{')) {
          // Fallback for raw JSON chunks if any
          try {
            yield JSON.parse(trimmedLine);
          } catch (e) {}
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

export async function validatePromoCode(code: string): Promise<{ valid: boolean, discount_percent: number, target_tier?: string | null, fixed_price?: number | null, detail?: string }> {
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

export type PaymentRecord = {
  id: number;
  yookassa_id: string | null;
  amount: number;
  currency: string;
  status: string;          // pending, waiting_for_capture, succeeded, canceled
  tier: string;
  is_annual: boolean;
  created_at: string | null;
};

export type MyPaymentsResponse = {
  current_subscription: {
    tier: string;
    expires_at: string | null;
    is_admin: boolean;
  };
  payments: PaymentRecord[];
};

export async function getMyPayments(token: string): Promise<MyPaymentsResponse> {
  return getAuthJson<MyPaymentsResponse>("/me/payments", token);
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
  // Маркер «это API-вызов клиента». Next.js страницы и API бэкенда делят пути
  // (/grants, /projects), а cookie-session-юзеры НЕ шлют Authorization. Поэтому
  // навигацию браузера (нет заголовка) рендерим страницей, а fetch из api.ts
  // (есть заголовок) проксируем на бэкенд. Работает и за Caddy Basic Auth.
  headers["x-pitchy-api"] = "1";
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
    // SSE spec uses CRLF; sse-starlette emits \r\n\r\n between events.
    // Accept both \r\n\r\n and \n\n so the parser works with any backend.
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const lines = event.split(/\r?\n/);
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }
        if (trimmedLine.startsWith('data:')) {
          const dataStr = trimmedLine.substring(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            yield JSON.parse(dataStr);
          } catch (e) {
            console.error("Error parsing stream line", e, dataStr);
          }
        } else if (trimmedLine.startsWith('{')) {
          // Fallback for raw JSON chunks if any
          try {
            yield JSON.parse(trimmedLine);
          } catch (e) {}
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

/* ——— Projects (Паспорт проекта) ——— */

export type PassportData = Record<string, unknown>;

export type Project = {
  id: number;
  name: string;
  passport: PassportData;
  readiness_index: number;
  status: "active" | "archived";
  passport_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectListItem = {
  id: number;
  name: string;
  readiness_index: number;
  status: "active" | "archived";
  session_count: number;
  updated_at: string;
};

export type PassportView = {
  passport: PassportData;
  readiness_index: number;
  missing_sections: string[];
};

export async function getProjects(token: string, includeArchived = false): Promise<ProjectListItem[]> {
  return getAuthJson<ProjectListItem[]>(`/projects?include_archived=${includeArchived}`, token);
}

export async function getProject(id: number, token: string): Promise<Project> {
  return getAuthJson<Project>(`/projects/${id}`, token);
}

export async function createProject(
  data: { name: string; passport?: PassportData; attach_session_id?: number },
  token: string
): Promise<Project> {
  return postAuthJson<Project>("/projects", data, token);
}

export async function updateProject(
  id: number,
  data: { name?: string; status?: "active" | "archived" },
  token: string
): Promise<Project> {
  return patchAuthJson<Project>(`/projects/${id}`, data, token);
}

export type OnboardResult = {
  project: Project;
  summary: string;
};

// Онбординг «2 минуты до матча»: описание идеи → папка с черновиком паспорта.
export async function onboardProject(idea: string, token: string): Promise<OnboardResult> {
  return postAuthJson<OnboardResult>("/projects/onboard", { idea }, token);
}

export async function deleteProject(id: number, token: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/projects/${id}`, undefined, token, "DELETE");
}

export async function getPassport(id: number, token: string): Promise<PassportView> {
  return getAuthJson<PassportView>(`/projects/${id}/passport`, token);
}

export async function patchPassport(
  id: number,
  fields: Record<string, unknown>,
  token: string
): Promise<PassportView> {
  return patchAuthJson<PassportView>(`/projects/${id}/passport`, { fields }, token);
}

export async function getProjectSessions(id: number, token: string): Promise<ChatSessionResponse[]> {
  return getAuthJson<ChatSessionResponse[]>(`/projects/${id}/sessions`, token);
}

export async function attachSessionToProject(
  projectId: number,
  sessionId: number,
  token: string
): Promise<ChatSessionResponse> {
  return postAuthJson<ChatSessionResponse>(`/projects/${projectId}/sessions/${sessionId}`, {}, token);
}

/* ——— Grants (Гранты) ——— */

export type Grant = {
  id: number;
  name: string;
  organization: string | null;
  description: string | null;
  url: string | null;
  logo_url: string | null;
  amount_min: number | null;
  amount_max: number | null;
  geo: string | null;
  stages: string[];
  sectors: string[];
  entity_types: string[];
  requirements: Record<string, unknown> | null;
  opens_at: string | null;
  deadline: string | null;
  status: "open" | "upcoming" | "closed";
  // Статус модерации авто-обнаруженных грантов (для админ-очереди).
  moderation?: "approved" | "pending" | "rejected";
};

export type GrantMatch = {
  grant: Grant;
  score: number;
  hard_pass: boolean;
  reasons: { matched?: string[]; missing?: string[]; conflict?: boolean };
};

// Стадия воронки CRM «Мои гранты» (канбан). Порядок = порядок колонок.
export type CrmStage = "interested" | "preparing" | "submitted" | "won" | "rejected";

export type GrantApplication = {
  id: number;
  project_id: number;
  grant_id: number;
  status: "draft" | "generated" | "submitted";
  stage: CrmStage;
  content: {
    sections?: Record<string, string>;
    gaps?: string[];
    checklist?: string[];
    // Структура шаблона под конкретный грант (Кирпич A–C).
    template_key?: string;
    template_title?: string;
    section_meta?: { key: string; label: string; group_id: string; group_title: string }[];
    static?: Record<string, { label: string; value: string }>;
    user_input?: { key: string; label: string; hint?: string }[];
  };
  match_score: number;
  created_at: string;
  updated_at: string;
};

// Гранты ходят на /grants. URL /grants/* заняты страницами Next, поэтому
// next.config переписывает их на бэкенд ТОЛЬКО для запросов с заголовком
// Authorization (наши fetch его шлют, навигация в браузере — нет), так что
// страница и API живут на одном пути без коллизии.
export async function getGrants(token: string, status?: string): Promise<Grant[]> {
  const q = status ? `?status=${status}` : "";
  return getAuthJson<Grant[]>(`/grants${q}`, token);
}

export async function getGrant(id: number, token: string): Promise<Grant> {
  return getAuthJson<Grant>(`/grants/${id}`, token);
}

// Черновик гранта, извлечённый парсером по ссылке (поля GrantCreateRequest).
export type GrantDraft = {
  name: string;
  organization: string | null;
  description: string | null;
  url: string | null;
  logo_url: string | null;
  amount_min: number | null;
  amount_max: number | null;
  geo: string | null;
  stages: string[];
  sectors: string[];
  entity_types: string[];
  requirements: Record<string, unknown> | null;
  opens_at: string | null;
  deadline: string | null;
  status: string;
};

// Парсер: извлечь черновик по ссылке (НЕ сохраняет). Только админ.
export async function extractGrantFromUrl(url: string, token: string): Promise<GrantDraft> {
  return postAuthJson<GrantDraft>(`/grants/extract`, { url }, token);
}

// Сохранить грант в каталог (после правки черновика). Только админ.
export async function createGrant(payload: Partial<GrantDraft>, token: string): Promise<Grant> {
  return postAuthJson<Grant>(`/grants`, payload, token);
}

export async function matchGrants(
  projectId: number,
  token: string,
  opts?: { includeClosed?: boolean; onlyEligible?: boolean }
): Promise<GrantMatch[]> {
  const params = new URLSearchParams({ project_id: String(projectId) });
  if (opts?.includeClosed) params.set("include_closed", "true");
  if (opts?.onlyEligible) params.set("only_eligible", "true");
  return getAuthJson<GrantMatch[]>(`/grants/match?${params.toString()}`, token);
}

export async function generateGrantApplication(
  grantId: number,
  projectId: number,
  token: string,
  extraContext?: string
): Promise<GrantApplication> {
  return postAuthJson<GrantApplication>(
    `/grants/${grantId}/apply`,
    { project_id: projectId, extra_context: extraContext },
    token
  );
}

export async function getGrantApplications(token: string, projectId?: number): Promise<GrantApplication[]> {
  const q = projectId != null ? `?project_id=${projectId}` : "";
  return getAuthJson<GrantApplication[]>(`/grants/applications${q}`, token);
}

export async function getGrantApplication(appId: number, token: string): Promise<GrantApplication> {
  return getAuthJson<GrantApplication>(`/grants/applications/${appId}`, token);
}

export async function updateGrantApplication(
  appId: number,
  data: { content?: Record<string, unknown>; status?: string; stage?: CrmStage },
  token: string
): Promise<GrantApplication> {
  return patchAuthJson<GrantApplication>(`/grants/applications/${appId}`, data, token);
}

// Добавить грант на канбан «Мои гранты» без генерации заявки (стадия «Интересует»).
// Идемпотентно: повторный вызов вернёт уже существующую карточку.
export async function trackGrant(
  grantId: number,
  projectId: number,
  token: string
): Promise<GrantApplication> {
  return postAuthJson<GrantApplication>(
    `/grants/${grantId}/track`,
    { project_id: projectId },
    token
  );
}

// ---- Авто-обнаружение грантов: источники + модерация (только админ) ----

// Источник авто-парсера: официальная страница/каталог, который краулер
// обходит раз в сутки. kind: listing — страница со списком программ,
// page — одна страница одной программы.
export type GrantSource = {
  id: number;
  name: string;
  url: string;
  kind: "listing" | "page";
  enabled: boolean;
  max_items: number;
  last_crawled_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
};

export async function getGrantSources(token: string): Promise<GrantSource[]> {
  return getAuthJson<GrantSource[]>(`/grants/sources`, token);
}

export async function createGrantSource(
  data: { name: string; url: string; kind?: "listing" | "page"; max_items?: number },
  token: string
): Promise<GrantSource> {
  return postAuthJson<GrantSource>(`/grants/sources`, data, token);
}

export async function updateGrantSource(
  sourceId: number,
  data: { name?: string; url?: string; kind?: "listing" | "page"; enabled?: boolean; max_items?: number },
  token: string
): Promise<GrantSource> {
  return patchAuthJson<GrantSource>(`/grants/sources/${sourceId}`, data, token);
}

export async function deleteGrantSource(sourceId: number, token: string): Promise<void> {
  await deleteAuth(`/grants/sources/${sourceId}`, token);
}

// Запустить обход источника сейчас (парсинг идёт в фоне на бэкенде).
export async function crawlGrantSource(
  sourceId: number,
  token: string
): Promise<{ status: string; detail: string }> {
  return postAuthJson<{ status: string; detail: string }>(
    `/grants/sources/${sourceId}/crawl`,
    {},
    token
  );
}

// Очередь модерации: гранты, найденные краулером (moderation = pending).
export async function getGrantModerationQueue(token: string): Promise<Grant[]> {
  return getAuthJson<Grant[]>(`/grants/moderation`, token);
}

// Решение модерации: approve — в каталог, reject — скрыть.
export async function moderateGrant(
  grantId: number,
  action: "approve" | "reject",
  token: string
): Promise<Grant> {
  return postAuthJson<Grant>(`/grants/${grantId}/moderate`, { action }, token);
}
