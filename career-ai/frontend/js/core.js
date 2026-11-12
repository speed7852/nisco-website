// Shared browser helpers for NISCO Career AI: configuration, session, API client, DOM helper,
// status messages and the confirmation dialog. Plain ES modules, no build step.
// Every value from the API is rendered with textContent or element attributes, never as HTML.

export const CONFIG = window.CAREER_AI_CONFIG || { apiBase: "", authMode: "key" };
export const SESSION_STORAGE_KEY = "careerAiSession";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Mutable app state shared by the modules. */
export const state = {
  session: null,
  profile: null,
  profileUpdatedAt: null,
  jobs: [],
  applications: [],
  files: [],
  cvVersions: [],
  activeCvId: null,
  profileItems: [],
  sections: [],
  missing: [],
  /** Extracted CV text by version id, loaded on demand to show where a proposal came from. */
  cvText: new Map(),
};

export const $ = (id) => document.getElementById(id);

/** el("a", { href, class, text, onclick }, ...children). Text is always set as text, never HTML. */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  // Flatten fully: children may be nested lists (for example [dt, dd] pairs); appending an array would
  // render its string form.
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleString() : "");
export const formatSize = (bytes) => `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
export const isHttpsLink = (value) => typeof value === "string" && value.startsWith("https://");

export function say(text, kind = "success") {
  const box = $("message");
  box.textContent = text;
  box.className = `small ${kind}`;
}

// ---- Session -----------------------------------------------------------------------------------

export function loadStoredSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (stored && stored.token && Date.parse(stored.expiresAt) > Date.now()) return stored;
  } catch {
    // storage unavailable or corrupt: treat as signed out
  }
  return null;
}

export function storeSession(session) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // the session still works for this page view
  }
}

export function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem("careerKey"); // raw key stored by versions before Phase 1
  } catch {
    // nothing to clear
  }
}

// ---- API client --------------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || `Request failed (${status}).`);
    this.status = status;
    this.body = body || {};
    this.code = this.body.error;
  }
}

let onUnauthorized = () => undefined;
/** Called with no arguments when a request other than sign-in returns 401. */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(path, { method = "GET", json, body, headers = {}, raw = false } = {}) {
  const init = {
    method,
    headers: { ...headers },
    cache: "no-store",
    credentials: CONFIG.authMode === "access" ? "include" : "omit",
  };
  if (CONFIG.authMode === "key" && state.session) init.headers.authorization = `Bearer ${state.session.token}`;
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers["content-type"] = "application/json";
  } else if (body !== undefined) {
    init.body = body;
  }

  let response;
  try {
    response = await fetch(CONFIG.apiBase + path, init);
  } catch {
    throw new ApiError(0, { message: "Could not reach Career AI. Check your connection and try again." });
  }
  if (raw && response.ok) return response;
  let data = {};
  try {
    data = await response.json();
  } catch {
    // empty or non-JSON error body
  }
  if (response.status === 401 && path !== "/api/session") onUnauthorized();
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

/** Uploads a file as the raw request body, the way the Worker's upload endpoints expect. */
export function uploadFile(path, file) {
  return api(path, {
    method: "POST",
    body: file,
    headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
  });
}

/** Saves a Blob through a temporary object URL (the API never serves files inline). */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function clearFieldErrors() {
  document.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
}

/** Marks invalid inputs and returns a readable summary of field errors from a 400 response. */
export function showFieldErrors(error, inputIdForField) {
  clearFieldErrors();
  const fields = (error.body && error.body.fields) || {};
  const parts = [];
  for (const [field, message] of Object.entries(fields)) {
    const input = $(inputIdForField(field));
    if (input) input.setAttribute("aria-invalid", "true");
    parts.push(`${field}: ${message}`);
  }
  return parts.length ? `${error.message} ${parts.join(" ")}` : error.message;
}

/** Disables a button while an async action runs, so a double click cannot send twice. */
export async function busy(button, action) {
  if (button) button.disabled = true;
  try {
    return await action();
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Workspace refresh -------------------------------------------------------------------------------

let refresher = async () => undefined;
/** app.js registers the function that reloads and re-renders the profile workspace. */
export function setWorkspaceRefresher(fn) {
  refresher = fn;
}
/**
 * Re-renders the profile workspace after a change. By default only the profile facts are reloaded
 * (one request); pass { full: true } after CV changes to reload CV versions and files as well.
 * Keeping this small matters: the API allows 120 requests a minute per client.
 */
export const refreshWorkspace = (options = {}) => refresher(options);

// ---- Confirmation dialog ---------------------------------------------------------------------------

/**
 * Asks for confirmation in the page's <dialog id="confirm-dialog">. With `phrase`, the confirm
 * button only works once that exact phrase is typed. Resolves true or false. No form is used, so
 * the strict CSP (form-action 'none') does not interfere.
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", phrase = null, danger = false }) {
  const dialog = $("confirm-dialog");
  const input = $("confirm-input");
  const ok = $("confirm-ok");
  const cancel = $("confirm-cancel");
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = message;
  $("confirm-phrase-row").hidden = !phrase;
  $("confirm-phrase").textContent = phrase || "";
  input.value = "";
  ok.textContent = confirmLabel;
  ok.className = danger ? "danger" : "";
  ok.disabled = Boolean(phrase);
  const opener = document.activeElement;

  return new Promise((resolve) => {
    const controller = new AbortController();
    const { signal } = controller;
    const finish = (result) => {
      controller.abort();
      if (dialog.open) dialog.close();
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
      resolve(result);
    };
    input.addEventListener("input", () => (ok.disabled = phrase ? input.value !== phrase : false), { signal });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !ok.disabled) finish(true);
    }, { signal });
    ok.addEventListener("click", () => finish(true), { signal });
    cancel.addEventListener("click", () => finish(false), { signal });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    }, { signal });
    dialog.showModal();
    (phrase ? input : cancel).focus();
  });
}
