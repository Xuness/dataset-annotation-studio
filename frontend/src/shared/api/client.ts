const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
export const API_BASE_URL = configuredBaseUrl || "http://127.0.0.1:8765";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function issueMessage(issue: Record<string, unknown>): string | null {
  const type = typeof issue.type === "string" ? issue.type : "";
  if (type === "extra_forbidden") return "当前后端不支持此字段";
  if (type === "missing") return "缺少必填字段";
  if (type === "json_invalid") return "请求内容不是有效 JSON";

  const rawMessage = [issue.msg, issue.message, issue.error].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  if (!rawMessage) return null;
  return rawMessage.startsWith("Value error, ") ? rawMessage.slice(13) : rawMessage;
}

function issueLocation(issue: Record<string, unknown>): string {
  if (!Array.isArray(issue.loc)) return "";
  return issue.loc
    .filter((segment) => segment !== "body")
    .map(String)
    .join(".");
}

export function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail.trim() || null;
  if (typeof detail === "number" || typeof detail === "boolean") return String(detail);
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      const message = formatApiErrorDetail(item);
      return message ? [message] : [];
    });
    return [...new Set(messages)].join("；") || null;
  }
  if (!detail || typeof detail !== "object") return null;

  const issue = detail as Record<string, unknown>;
  const message = issueMessage(issue);
  if (message) {
    const location = issueLocation(issue);
    return location ? `${location}：${message}` : message;
  }
  if ("detail" in issue) return formatApiErrorDetail(issue.detail);

  try {
    const serialized = JSON.stringify(detail);
    return serialized && serialized !== "{}" ? serialized : null;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      const formatted = formatApiErrorDetail(body.detail);
      if (formatted) detail = formatted;
    } catch {
      // Keep the generic response message.
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function apiAssetUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
