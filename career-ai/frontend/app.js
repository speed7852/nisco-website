"use strict";

// NISCO Career AI browser app. Plain JavaScript, no build step.
// Every value from the API is rendered with textContent or element attributes, never as HTML.
(() => {
  const CONFIG = window.CAREER_AI_CONFIG || { apiBase: "", authMode: "key" };
  const SESSION_STORAGE_KEY = "careerAiSession";
  const SHORTLIST_THRESHOLD = 80;
  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

  // Must match APPLICATION_STATUSES in worker/src/domain/applications.ts. "submitted" is not
  // offered: it requires an approval record, which arrives in a later phase.
  const STATUSES = [
    ["prepared", "Prepared"],
    ["applied", "Applied (by me)"],
    ["recruiter_contact", "Recruiter contact"],
    ["interview", "Interview"],
    ["offer", "Offer"],
    ["rejected", "Rejected"],
    ["withdrawn", "Withdrawn"],
  ];
  const STATUS_LABELS = Object.fromEntries(STATUSES);

  const state = { session: null, profile: null, profileUpdatedAt: null, jobs: [], applications: [], files: [] };
  const $ = (id) => document.getElementById(id);

  // ---- Small DOM helper ------------------------------------------------------------------------

  /** el("a", { href, class, text, onclick }, ...children). Text is always set as text, never HTML. */
  function el(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false) continue;
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : String(value));
    }
    for (const child of children) if (child !== null && child !== undefined) node.append(child);
    return node;
  }

  const formatDate = (iso) => (iso ? new Date(iso).toLocaleString() : "");
  const isHttpsLink = (value) => typeof value === "string" && value.startsWith("https://");

  function say(text, kind = "success") {
    const box = $("message");
    box.textContent = text;
    box.className = `small ${kind}`;
  }

  // ---- Session ---------------------------------------------------------------------------------

  function loadStoredSession() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
      if (stored && stored.token && Date.parse(stored.expiresAt) > Date.now()) return stored;
    } catch {
      // storage unavailable or corrupt: treat as signed out
    }
    return null;
  }

  function storeSession(session) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // the session still works for this page view
    }
  }

  function clearStoredSession() {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem("careerKey"); // raw key stored by versions before Phase 1
    } catch {
      // nothing to clear
    }
  }

  // ---- API client --------------------------------------------------------------------------------

  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.message) || `Request failed (${status}).`);
      this.status = status;
      this.body = body || {};
    }
  }

  async function api(path, { method = "GET", json, body, headers = {}, raw = false } = {}) {
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
    if (response.status === 401 && path !== "/api/session") {
      lock("Your session has ended. Sign in again.");
    }
    if (!response.ok) throw new ApiError(response.status, data);
    return data;
  }

  function clearFieldErrors() {
    document.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  }

  /** Marks invalid inputs and returns a readable summary of field errors from a 400 response. */
  function showFieldErrors(error, inputIdForField) {
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

  // ---- Sign-in and layout ------------------------------------------------------------------------

  function lock(message = "") {
    clearStoredSession();
    state.session = null;
    $("app").hidden = true;
    $("login").hidden = false;
    $("access-key").value = "";
    const status = $("login-message");
    status.textContent = message;
    status.className = message ? "small error" : "small";
  }

  async function showApp() {
    $("login").hidden = true;
    const app = $("app");
    app.hidden = false;
    // Until the saved data is on screen the workspace is busy and inert, so nothing typed or
    // clicked in the meantime can be overwritten by the load finishing later.
    app.setAttribute("aria-busy", "true");
    app.inert = true;
    try {
      await loadAll();
    } catch (error) {
      if (error.status !== 401) say(error.message, "error");
    } finally {
      app.inert = false;
      app.setAttribute("aria-busy", "false");
    }
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = $("access-key").value.trim();
    const status = $("login-message");
    if (!key) {
      status.textContent = "Enter your access key.";
      status.className = "small error";
      return;
    }
    const button = $("login-button");
    button.disabled = true;
    status.textContent = "Checking…";
    status.className = "small";
    try {
      const session = await api("/api/session", { method: "POST", json: { accessKey: key } });
      state.session = { token: session.token, expiresAt: session.expiresAt };
      storeSession(state.session);
      $("access-key").value = "";
      status.textContent = "";
      await showApp();
    } catch (error) {
      status.textContent = error.message;
      status.className = "small error";
    } finally {
      button.disabled = false;
    }
  });

  $("logout").addEventListener("click", () => lock());

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((other) => {
        if (other === button) other.setAttribute("aria-current", "page");
        else other.removeAttribute("aria-current");
      });
      for (const tab of ["profile", "jobs", "studio", "tracker"]) $(`tab-${tab}`).hidden = tab !== button.dataset.tab;
    });
  });

  // ---- Loading -------------------------------------------------------------------------------------

  let loadGeneration = 0;

  async function loadAll() {
    const generation = (loadGeneration += 1);
    const [profile, jobs, applications, files, runs] = await Promise.all([
      api("/api/profile"),
      api("/api/jobs"),
      api("/api/applications"),
      api("/api/files"),
      api("/api/discovery/runs?limit=1"),
    ]);
    // A newer load started while this one was in flight: its data is fresher, so drop this one.
    if (generation !== loadGeneration) return;
    fillProfile(profile.profile, profile.updatedAt);
    state.jobs = jobs.jobs || [];
    state.applications = applications.applications || [];
    state.files = files.files || [];
    renderJobs();
    renderApplications();
    renderFiles();
    renderLastRun((runs.runs || [])[0]);
  }

  // ---- Profile -------------------------------------------------------------------------------------

  const PROFILE_FIELDS = ["name", "headline", "years", "location", "summary", "skills", "experience", "roles"];

  function fillProfile(profile, updatedAt) {
    state.profile = profile;
    state.profileUpdatedAt = updatedAt;
    for (const field of PROFILE_FIELDS) {
      const value = profile ? profile[field] : "";
      $(`p-${field}`).value = value === null || value === undefined ? "" : String(value);
    }
    $("profile-saved").textContent = updatedAt ? `Last saved ${formatDate(updatedAt)}` : "Not saved yet";
  }

  function profileFromForm() {
    const profile = {};
    for (const field of PROFILE_FIELDS) profile[field] = $(`p-${field}`).value.trim();
    profile.years = profile.years === "" ? null : Number(profile.years);
    return profile;
  }

  function profileHasUnsavedChanges() {
    const current = profileFromForm();
    const saved = state.profile || {};
    return PROFILE_FIELDS.some((field) => String(current[field] ?? "") !== String(saved[field] ?? ""));
  }

  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/profile", { method: "PUT", json: profileFromForm() });
      fillProfile(result.profile, result.updatedAt);
      clearFieldErrors();
      say("Career profile saved.");
    } catch (error) {
      say(error.status === 400 ? showFieldErrors(error, (field) => `p-${field}`) : error.message, "error");
    }
  });

  // ---- Files ---------------------------------------------------------------------------------------

  function renderFiles() {
    const list = $("files-list");
    list.replaceChildren(
      ...state.files.map((file) =>
        el(
          "li",
          {},
          el(
            "span",
            {},
            el("strong", { text: file.name }),
            el("span", { class: "muted small", text: ` · ${Math.max(1, Math.round(file.sizeBytes / 1024))} KB · ${formatDate(file.createdAt)}${file.kind === "legacy_upload" ? " · earlier upload" : ""}` }),
          ),
          el(
            "span",
            { class: "row" },
            el("button", { type: "button", class: "secondary", text: "Download", onclick: () => downloadFile(file) }),
            el("button", { type: "button", class: "danger", text: "Delete", onclick: () => deleteFile(file) }),
          ),
        ),
      ),
    );
    if (state.files.length === 0) list.append(el("li", { class: "muted small", text: "No CV files uploaded yet." }));
  }

  async function downloadFile(file) {
    try {
      const response = await api(`/api/files/${file.id}`, { raw: true });
      const url = URL.createObjectURL(await response.blob());
      const link = el("a", { href: url, download: file.name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      say(error.message, "error");
    }
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete "${file.name}" permanently?`)) return;
    try {
      await api(`/api/files/${file.id}`, { method: "DELETE" });
      state.files = state.files.filter((other) => other.id !== file.id);
      renderFiles();
      say("File deleted.");
    } catch (error) {
      say(error.message, "error");
    }
  }

  $("upload-cv").addEventListener("click", async () => {
    const file = $("cv-file").files[0];
    if (!file) return say("Choose a CV file first.", "error");
    if (!/\.(pdf|docx)$/i.test(file.name)) return say("Only PDF (.pdf) and Word (.docx) files are accepted.", "error");
    if (file.size > MAX_UPLOAD_BYTES) return say("Files must be 8 MB or smaller.", "error");
    try {
      const result = await api("/api/files", {
        method: "POST",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      });
      state.files = [result.file, ...state.files];
      renderFiles();
      $("cv-file").value = "";
      say(`Uploaded ${result.file.name} privately.`);
    } catch (error) {
      say(error.message, "error");
    }
  });

  $("reconcile-files").addEventListener("click", async () => {
    try {
      const result = await api("/api/files/reconcile", { method: "POST" });
      state.files = (await api("/api/files")).files || [];
      renderFiles();
      say(result.registered > 0 ? `Found ${result.registered} earlier upload(s).` : "No unlisted earlier uploads found.");
    } catch (error) {
      say(error.message, "error");
    }
  });

  // ---- Jobs ----------------------------------------------------------------------------------------

  function renderLastRun(run) {
    const pill = $("last-run");
    if (!run) {
      pill.textContent = "No discovery run yet";
      pill.className = "pill";
      return;
    }
    const inserted = run.summary && typeof run.summary.inserted === "number" ? ` · ${run.summary.inserted} new` : "";
    pill.textContent = `Last discovery ${formatDate(run.startedAt)} · ${run.status}${inserted}`;
    pill.className = `pill ${run.status === "ok" ? "ok" : "warn"}`;
  }

  function matchBlock(job) {
    const match = job.match;
    const parts = [];
    if (match.status === "scored" || (match.status === "needs_review" && match.verified)) {
      parts.push(el("div", { class: "score", text: `${match.score}% match` }));
      parts.push(
        el("span", {
          class: `pill ${match.shortlisted ? "ok" : ""}`,
          text: match.shortlisted ? `Shortlisted (${SHORTLIST_THRESHOLD}%+)` : `Below ${SHORTLIST_THRESHOLD}%`,
        }),
      );
    }
    if (match.status === "needs_review") {
      parts.push(el("p", { class: "notice", text: `The last assessment did not complete (${match.lastError || "unknown"}). ${match.verified ? "The score above is from the previous successful assessment." : ""} Try "Assess match" again.` }));
    } else if (match.status === "legacy_unverified") {
      parts.push(el("p", { class: "notice", text: `An older score (${match.score}%) was recorded before validation existed. It is not used for the shortlist until re-assessed.` }));
    } else if (match.status === "pending") {
      parts.push(el("p", { class: "muted small", text: "Not assessed yet." }));
    }
    if (match.verified && (match.matched.length || match.gaps.length || match.rationale)) {
      parts.push(
        el(
          "div",
          { class: "columns" },
          el("div", {}, el("strong", { text: "Matches your profile" }), el("ul", {}, ...match.matched.map((item) => el("li", { text: item })))),
          el("div", {}, el("strong", { text: "Missing or not shown" }), el("ul", {}, ...match.gaps.map((item) => el("li", { text: item })))),
        ),
      );
      if (match.rationale) parts.push(el("p", { class: "muted small", text: match.rationale }));
    }
    return parts;
  }

  function renderJobs() {
    const shortlistOnly = $("shortlist-only").checked;
    const visible = shortlistOnly ? state.jobs.filter((job) => job.match.shortlisted) : state.jobs;
    $("job-count").textContent = String(state.jobs.length);
    $("shortlist-count").textContent = String(state.jobs.filter((job) => job.match.shortlisted).length);

    const options = state.jobs.map((job) => el("option", { value: job.id, text: `${job.title} — ${job.company}` }));
    $("draft-job").replaceChildren(...options.map((option) => option.cloneNode(true)));
    $("track-job").replaceChildren(...options);

    const list = $("jobs-list");
    list.replaceChildren(
      ...visible.map((job) =>
        el(
          "article",
          { class: "item" },
          el("div", { class: "bar" }, el("h3", { text: job.title }), el("span", { class: "pill", text: job.company })),
          el("p", { class: "muted small", text: [job.location, job.source === "manual" ? "Added by you" : `Found on ${job.source}`, formatDate(job.createdAt)].filter(Boolean).join(" · ") }),
          ...matchBlock(job),
          el(
            "div",
            { class: "actions" },
            el("button", { type: "button", class: "secondary", text: "Assess match", onclick: (event) => assessJob(job, event.currentTarget) }),
            isHttpsLink(job.url) ? el("a", { href: job.url, target: "_blank", rel: "noopener noreferrer", text: "Open listing" }) : null,
          ),
        ),
      ),
    );
    if (visible.length === 0) {
      list.append(el("p", { class: "muted", text: shortlistOnly ? "No jobs at 80% or above yet." : "No jobs saved yet." }));
    }
  }

  async function assessJob(job, button) {
    button.disabled = true;
    button.textContent = "Assessing…";
    try {
      const result = await api(`/api/jobs/${job.id}/match`, { method: "POST" });
      state.jobs = state.jobs.map((other) => (other.id === job.id ? result.job : other));
      renderJobs();
      say(result.status === "scored" ? "Assessment saved." : "The assessment did not complete. Any previous score was kept.", result.status === "scored" ? "success" : "error");
    } catch (error) {
      say(error.message, "error");
      button.disabled = false;
      button.textContent = "Assess match";
    }
  }

  $("shortlist-only").addEventListener("change", renderJobs);

  $("job-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const job = {
      title: $("j-title").value,
      company: $("j-company").value,
      location: $("j-location").value,
      url: $("j-url").value,
      description: $("j-desc").value,
    };
    try {
      await api("/api/jobs", { method: "POST", json: job });
      $("job-form").reset();
      clearFieldErrors();
      state.jobs = (await api("/api/jobs")).jobs || [];
      renderJobs();
      say("Job saved. Use Assess match to score it against your profile.");
    } catch (error) {
      if (error.status === 409) say("This job is already saved.", "error");
      else say(error.status === 400 ? showFieldErrors(error, (field) => ({ description: "j-desc" })[field] || `j-${field}`) : error.message, "error");
    }
  });

  // ---- Application studio --------------------------------------------------------------------------

  $("generate-draft").addEventListener("click", async () => {
    const jobId = $("draft-job").value;
    if (!jobId) return say("Add a job first.", "error");
    if (profileHasUnsavedChanges()) say("Your profile form has unsaved changes. Drafts use the saved profile only.", "error");
    const output = $("draft-output");
    output.replaceChildren(el("p", { class: "muted", text: "Drafting…" }));
    try {
      const result = await api("/api/ai/draft", { method: "POST", json: { jobId, task: $("draft-task").value } });
      output.replaceChildren(
        el("p", { class: "muted small", text: `Based on your profile saved ${formatDate(result.profileUpdatedAt)}. Review before use.` }),
        el("pre", { text: result.draft }),
      );
    } catch (error) {
      output.replaceChildren();
      say(error.message, "error");
    }
  });

  // ---- Application tracker -------------------------------------------------------------------------

  $("track-status").replaceChildren(...STATUSES.map(([value, label]) => el("option", { value, text: label })));

  function renderApplications() {
    $("app-count").textContent = String(state.applications.length);
    const list = $("applications-list");
    list.replaceChildren(
      ...state.applications.map((application) => {
        const statusId = `status-${application.id}`;
        const notesId = `notes-${application.id}`;
        const knownStatus = Object.prototype.hasOwnProperty.call(STATUS_LABELS, application.status);
        const statusSelect = el(
          "select",
          { id: statusId },
          ...(knownStatus ? [] : [el("option", { value: application.status, text: `${application.status} (old value)`, selected: true, disabled: true })]),
          ...STATUSES.map(([value, label]) => el("option", { value, text: label, selected: value === application.status })),
        );
        const notes = el("textarea", { id: notesId, rows: 2, maxlength: 4000 });
        notes.value = application.notes;
        return el(
          "article",
          { class: "item" },
          el("div", { class: "bar" }, el("h3", { text: application.job.title }), el("span", { class: "pill", text: application.job.company })),
          el("p", { class: "muted small", text: `Added ${formatDate(application.createdAt)} · Updated ${formatDate(application.updatedAt)}` }),
          isHttpsLink(application.job.url) ? el("a", { href: application.job.url, target: "_blank", rel: "noopener noreferrer", text: "Open listing" }) : null,
          el("label", { for: statusId, text: "Status" }),
          statusSelect,
          el("label", { for: notesId, text: "Notes or next action" }),
          notes,
          el("div", { class: "actions" }, el("button", { type: "button", class: "secondary", text: "Save changes", onclick: () => saveApplication(application, statusSelect, notes) })),
        );
      }),
    );
    if (state.applications.length === 0) list.append(el("p", { class: "muted", text: "No applications tracked yet." }));
  }

  async function saveApplication(application, statusSelect, notes) {
    // Send only what changed; the API keeps omitted fields as they are.
    const changes = {};
    if (statusSelect.value !== application.status) changes.status = statusSelect.value;
    if (notes.value !== application.notes) changes.notes = notes.value;
    if (Object.keys(changes).length === 0) return say("Nothing to save.");
    try {
      const result = await api(`/api/applications/${application.id}`, { method: "PATCH", json: changes });
      state.applications = state.applications.map((other) => (other.id === application.id ? result.application : other));
      renderApplications();
      say("Application tracker updated.");
    } catch (error) {
      say(error.message, "error");
    }
  }

  $("tracker-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const jobId = $("track-job").value;
    if (!jobId) return say("Add a job first.", "error");
    try {
      await api("/api/applications", { method: "POST", json: { jobId, status: $("track-status").value, notes: $("track-notes").value } });
      $("track-notes").value = "";
      state.applications = (await api("/api/applications")).applications || [];
      renderApplications();
      say("Application added to tracker.");
    } catch (error) {
      say(error.status === 409 ? "This job is already in your tracker. Update it below." : error.message, "error");
    }
  });

  // ---- Start -------------------------------------------------------------------------------------

  async function start() {
    try {
      sessionStorage.removeItem("careerKey"); // never keep the raw key from older versions
    } catch {
      // storage unavailable
    }
    if (CONFIG.authMode === "access") {
      $("login-form").hidden = true;
      try {
        await api("/api/session");
        await showApp();
      } catch {
        lock("Sign in through Cloudflare Access, then reload this page.");
        $("login-form").hidden = true;
      }
      return;
    }
    state.session = loadStoredSession();
    if (state.session) await showApp();
  }

  start();
})();
