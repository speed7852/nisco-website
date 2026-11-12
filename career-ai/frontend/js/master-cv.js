// Master CV: upload, in-browser text extraction, version history (one active version), download,
// re-read, register an earlier upload, and permanent deletion with typed confirmation.
import { $, MAX_UPLOAD_BYTES, api, busy, confirmDialog, el, formatDate, formatSize, refreshWorkspace, saveBlob, say, state, uploadFile } from "./core.js";

const CV_TYPES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

/** Plain-language explanations of the extraction warning codes the Worker accepts. */
const WARNINGS = {
  page_limit_reached: "only the first 50 pages were read",
  no_text_layer: "the PDF has no text layer (it may be a scanned image; OCR is not supported)",
  short_text: "very little text was found",
  password_protected: "the file is password protected",
  timeout: "reading took too long",
  parse_error: "the file could not be read",
  truncated: "the text was cut at 200,000 characters",
  unsupported_content: "the file has content that is not supported",
  headers_included: "page-header text was included",
  encrypted: "the document is encrypted",
  too_large: "a part of the document is too large to read safely",
  no_text: "no text was found",
};
const explain = (codes) => codes.map((code) => WARNINGS[code] ?? code).join("; ");

const EXTRACTION_LABELS = { not_extracted: "Not read yet", extracted: "Text read", partial: "Text partly read", failed: "Text could not be read" };

export async function loadCvVersions() {
  const data = await api("/api/cv/versions");
  state.cvVersions = data.versions || [];
  state.activeCvId = data.activeId || null;
}

const fileName = (version) => version.file?.name ?? "deleted CV";

/** Review counts for one CV, from the profile facts already loaded (no extra request). */
function reviewCounts(version) {
  const counts = { proposed: 0, confirmed: 0, rejected: 0 };
  for (const item of state.profileItems) {
    if (item.source.cvVersionId === version.id && item.status in counts) counts[item.status] += 1;
  }
  return counts;
}

// ---- Reading a CV in the browser -------------------------------------------------------------------

/** Extracts the text locally, sends it for validation and structuring, and reports the outcome. */
async function readCv(version, file) {
  say(`Reading “${file.name}” in this browser…`, "muted");
  const { extractCvText } = await import("./extract.js");
  const result = await extractCvText(file);
  const response = await api(`/api/cv/versions/${version.id}/extraction`, {
    method: "POST",
    json: { status: result.status, parser: result.parser, parserVersion: result.parserVersion, text: result.text, pageCount: result.pageCount, warnings: result.warnings },
  });
  state.cvText.delete(version.id);
  await refreshWorkspace({ full: true });
  const extraction = response.version.extraction;
  const characters = (extraction.characters || 0).toLocaleString();
  if (extraction.status === "failed") {
    say(`Could not read text from “${file.name}”: ${explain(extraction.warnings)}. The file is stored privately; you can add facts yourself under Confirmed profile.`, "error");
  } else {
    const partly = extraction.status === "partial" ? ` (partly: ${explain(extraction.warnings)})` : "";
    const next = response.proposalsCreated > 0 ? " Use “Confirm all” under Facts awaiting your review to add them to your profile in one step, or check them one by one." : "";
    say(`Read ${characters} characters from “${file.name}”${partly}. ${response.proposalsCreated} fact(s) proposed for your review.${next}`);
  }
}

async function fetchCvFile(version) {
  const response = await api(`/api/cv/versions/${version.id}/download`, { raw: true });
  const blob = await response.blob();
  return new File([blob], version.file.name, { type: version.file.contentType || blob.type });
}

function validateChosenFile(file) {
  if (!file) return "Choose a CV file first.";
  if (!/\.(pdf|docx)$/i.test(file.name)) return "Only PDF (.pdf) and Word (.docx) files are accepted.";
  if (file.size > MAX_UPLOAD_BYTES) return "Files must be 8 MB or smaller.";
  return null;
}

// ---- Version actions ---------------------------------------------------------------------------

async function run(button, action) {
  await busy(button, async () => {
    try {
      await action();
    } catch (error) {
      say(error.message, "error");
    }
  });
}

async function activate(version, button) {
  await run(button, async () => {
    await api(`/api/cv/versions/${version.id}/activate`, { method: "POST" });
    await refreshWorkspace({ full: true });
    say(`“${fileName(version)}” is now your active master CV.`);
  });
}

async function deactivate(version, button) {
  await run(button, async () => {
    await api(`/api/cv/versions/${version.id}/deactivate`, { method: "POST" });
    await refreshWorkspace({ full: true });
    say("No master CV is active now.");
  });
}

async function download(version, button) {
  await run(button, async () => saveBlob(await (await api(`/api/cv/versions/${version.id}/download`, { raw: true })).blob(), fileName(version)));
}

async function reread(version, button) {
  const { proposed } = reviewCounts(version);
  if (proposed > 0) {
    const ok = await confirmDialog({
      title: "Read this CV again?",
      message: `Its ${proposed} unreviewed proposal(s) will be replaced by a fresh reading. Facts you confirmed or rejected are kept.`,
      confirmLabel: "Read again",
    });
    if (!ok) return;
  }
  await run(button, async () => readCv(version, await fetchCvFile(version)));
}

async function remove(version, button) {
  const ok = await confirmDialog({
    title: `Delete “${fileName(version)}” permanently?`,
    message:
      "The original file and its extracted text are removed from private storage and its unreviewed proposals are discarded. Facts you already confirmed stay in your profile and will show that their source CV was deleted. This cannot be undone.",
    confirmLabel: "Delete CV",
    phrase: "DELETE",
    danger: true,
  });
  if (!ok) return;
  await run(button, async () => {
    await api(`/api/cv/versions/${version.id}`, { method: "DELETE", json: { confirm: "DELETE" } });
    state.cvText.delete(version.id);
    await refreshWorkspace({ full: true });
    say(`“${fileName(version)}” was deleted.`);
  });
}

async function toggleText(version, details) {
  if (!details.open || details.dataset.loaded) return;
  const pre = details.querySelector("pre");
  try {
    const { text } = await api(`/api/cv/versions/${version.id}/text`);
    pre.textContent = text;
    details.dataset.loaded = "true";
  } catch (error) {
    pre.textContent = error.message;
  }
}

// ---- Rendering ---------------------------------------------------------------------------------

function versionCard(version) {
  const name = fileName(version);
  const extraction = version.extraction;
  const review = reviewCounts(version);
  const readable = extraction.status === "extracted" || extraction.status === "partial";
  const details = el("details", { class: "cv-text" }, el("summary", { text: "Show the extracted text" }), el("pre", { text: "Loading…" }));
  details.addEventListener("toggle", () => toggleText(version, details));
  const extractionLine = [
    EXTRACTION_LABELS[extraction.status] ?? extraction.status,
    readable ? `${(extraction.characters || 0).toLocaleString()} characters` : null,
    extraction.pageCount ? `${extraction.pageCount} page(s)` : null,
    extraction.parser ? `${extraction.parser} ${extraction.parserVersion}` : null,
    extraction.warnings.length ? explain(extraction.warnings) : null,
  ].filter(Boolean).join(" · ");
  const reviewLine = readable ? `Review: ${review.proposed} awaiting · ${review.confirmed} confirmed · ${review.rejected} rejected` : null;

  return el(
    "article",
    { class: `item cv-version${version.active ? " active" : ""}`, "data-cv-id": version.id },
    el("div", { class: "bar" }, el("h5", { text: name }), version.active ? el("span", { class: "pill ok", text: "Active master CV" }) : el("span", { class: "pill", text: "Inactive" })),
    el("p", { class: "muted small", text: `${version.file ? `${formatSize(version.file.sizeBytes)} · ` : ""}Uploaded ${formatDate(version.file?.uploadedAt ?? version.createdAt)}${version.activatedAt && version.active ? ` · active since ${formatDate(version.activatedAt)}` : ""}` }),
    el("p", { class: `small extraction ${extraction.status === "failed" ? "error" : ""}`, text: extractionLine }),
    reviewLine ? el("p", { class: "small", text: reviewLine }) : null,
    readable ? details : null,
    el(
      "div",
      { class: "actions" },
      el("button", { type: "button", class: "secondary", text: "Download", "aria-label": `Download ${name}`, onclick: (event) => download(version, event.currentTarget) }),
      version.active
        ? el("button", { type: "button", class: "secondary", text: "Deactivate", "aria-label": `Deactivate ${name}`, onclick: (event) => deactivate(version, event.currentTarget) })
        : el("button", { type: "button", class: "secondary", text: "Make active", "aria-label": `Make ${name} the active master CV`, onclick: (event) => activate(version, event.currentTarget) }),
      el("button", { type: "button", class: "secondary", text: extraction.status === "not_extracted" ? "Read text" : "Read again", "aria-label": `Read the text of ${name}${extraction.status === "not_extracted" ? "" : " again"}`, onclick: (event) => reread(version, event.currentTarget) }),
      el("button", { type: "button", class: "danger", text: "Delete", "aria-label": `Delete ${name} permanently`, onclick: (event) => remove(version, event.currentTarget) }),
    ),
  );
}

function renderStatus() {
  const active = state.cvVersions.find((version) => version.active);
  const status = $("master-cv-status");
  if (!active) {
    status.textContent = state.cvVersions.length ? "No master CV is active. Make one of your versions active." : "No master CV yet. Upload your CV to start.";
    status.className = "small notice";
    return;
  }
  const waiting = state.profileItems.filter((item) => item.status === "proposed").length;
  status.textContent = `Active master CV: “${fileName(active)}” · ${EXTRACTION_LABELS[active.extraction.status] ?? active.extraction.status}${waiting ? ` · ${waiting} fact(s) awaiting your review` : ""}`;
  status.className = "small success";
}

function renderRegisterOptions() {
  const linked = new Set(state.cvVersions.map((version) => version.file?.documentId).filter(Boolean));
  const candidates = state.files.filter((file) => !linked.has(file.id) && CV_TYPES.has(file.contentType));
  const select = $("register-upload-file");
  select.replaceChildren(
    candidates.length ? el("option", { value: "", text: "Choose an earlier upload…" }) : el("option", { value: "", text: "No other PDF or DOCX uploads" }),
    ...candidates.map((file) => el("option", { value: file.id, text: `${file.name} (${formatDate(file.createdAt)})` })),
  );
  select.disabled = candidates.length === 0;
  $("register-upload").disabled = candidates.length === 0;
}

export function renderMasterCv() {
  renderStatus();
  renderRegisterOptions();
  const list = $("cv-versions");
  list.replaceChildren(...state.cvVersions.map(versionCard));
  if (state.cvVersions.length === 0) list.append(el("p", { class: "muted small", text: "No CV versions yet." }));
}

export function initMasterCv() {
  $("master-cv-upload").addEventListener("click", (event) =>
    run(event.currentTarget, async () => {
      const file = $("master-cv-file").files[0];
      const problem = validateChosenFile(file);
      if (problem) return say(problem, "error");
      let version;
      try {
        version = (await uploadFile("/api/cv/versions", file)).version;
      } catch (error) {
        if (error.code === "duplicate_cv") return say("This exact file is already one of your CV versions.", "error");
        throw error;
      }
      $("master-cv-file").value = "";
      await readCv(version, file);
    }),
  );

  $("register-upload").addEventListener("click", (event) =>
    run(event.currentTarget, async () => {
      const documentId = $("register-upload-file").value;
      if (!documentId) return say("Choose an earlier upload first.", "error");
      let version;
      try {
        version = (await api("/api/cv/versions/from-upload", { method: "POST", json: { documentId } })).version;
      } catch (error) {
        if (error.code === "duplicate_cv") return say("This exact file is already one of your CV versions.", "error");
        throw error;
      }
      await readCv(version, await fetchCvFile(version));
    }),
  );
}
