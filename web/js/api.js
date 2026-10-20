// Talks to the Learnly server. Every response is {status, data} or {status, error_code, message}.

import { store } from "./store.js";

export class ApiError extends Error {
  constructor(status, code, message, body = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

let refreshing = null;

export async function refreshSession() {
  if (!refreshing) {
    refreshing = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Requested-With": "learnly" },
    })
      .then(async (r) => {
        if (!r.ok) {
          store.set({ user: null, token: null, amr: [] });
          return false;
        }
        const { data } = await r.json();
        store.set({ user: data.user, token: data.access_token, amr: data.amr || [] });
        return true;
      })
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

async function request(method, path, body, { headers = {}, retry = true, raw = false } = {}) {
  const opts = { method, credentials: "same-origin", headers: { ...headers } };
  if (store.token) opts.headers.Authorization = `Bearer ${store.token}`;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(`/api/v1${path}`, opts);
  } catch {
    throw new ApiError(0, "OFFLINE", "Can't reach the Learnly server. Is it still running?");
  }
  if (resp.status === 401 && retry && store.token) {
    const err = await resp.clone().json().catch(() => ({}));
    if (err.error_code === "TOKEN_EXPIRED" && (await refreshSession())) {
      return request(method, path, body, { headers, retry: false, raw });
    }
  }
  if (raw) return resp;
  let json = {};
  try {
    json = await resp.json();
  } catch {
    json = {};
  }
  if (!resp.ok || json.status === "error") {
    if (resp.status === 401 && (json.error_code === "SESSION_EXPIRED" || json.error_code === "INVALID_TOKEN")) {
      store.set({ user: null, token: null, amr: [] });
    }
    throw new ApiError(resp.status, json.error_code || "HTTP_" + resp.status, json.message || `Request failed (${resp.status}).`, json);
  }
  return json.data;
}

export const api = {
  get: (path, opts) => request("GET", path, undefined, opts),
  post: (path, body = {}, opts) => request("POST", path, body, opts),
  put: (path, body = {}, opts) => request("PUT", path, body, opts),
  patch: (path, body = {}, opts) => request("PATCH", path, body, opts),
  del: (path, opts) => request("DELETE", path, undefined, opts),
  raw: (method, path, body, opts) => request(method, path, body, { ...opts, raw: true }),

  /** POST and read server-sent events. onEvent(name, data) is called for each one. */
  async stream(path, body, onEvent, { signal, headers = {} } = {}) {
    const resp = await request("POST", path, body, { raw: true, headers: { Accept: "text/event-stream", ...headers } });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      throw new ApiError(resp.status, json.error_code || "HTTP_" + resp.status, json.message || "Request failed.", json);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const abort = () => reader.cancel().catch(() => {});
    signal?.addEventListener("abort", abort);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          let name = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) name = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          onEvent(name, parsed);
        }
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  },
};

/**
 * Upload a file as the raw request body, reporting progress (0..1) to onProgress.
 * `path` is under /api/v1 and may carry query parameters (e.g. ?filename=…).
 * Resolves with the response's data; rejects with ApiError.
 */
export function upload(path, file, { onProgress, signal, retry = true } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1${path}`);
    if (store.token) xhr.setRequestHeader("Authorization", `Bearer ${store.token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "OFFLINE", "The upload stopped. Is Learnly still running?"));
    xhr.onabort = () => reject(new ApiError(0, "ABORTED", "Upload cancelled."));
    xhr.onload = async () => {
      let json = {};
      try {
        json = JSON.parse(xhr.responseText || "{}");
      } catch {
        json = {};
      }
      if (xhr.status === 401 && retry && json.error_code === "TOKEN_EXPIRED" && (await refreshSession())) {
        upload(path, file, { onProgress, signal, retry: false }).then(resolve, reject);
        return;
      }
      if (xhr.status >= 400 || json.status === "error") {
        reject(new ApiError(xhr.status, json.error_code || "HTTP_" + xhr.status, json.message || `Upload failed (${xhr.status}).`, json));
        return;
      }
      resolve(json.data);
    };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

export function idempotencyKey() {
  if (crypto.randomUUID) return "lk-" + crypto.randomUUID();
  return "lk-" + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
