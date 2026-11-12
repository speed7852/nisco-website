// Structured profile facts: the review queue (proposals from a CV or from the original notes), the
// confirmed profile editor, and the data controls (export, delete all). Matching and drafts use
// confirmed facts only; nothing here confirms anything without an explicit click.
import { $, api, busy, confirmDialog, el, formatDate, refreshWorkspace, saveBlob, say, state } from "./core.js";

const GROUPS = [
  ["contact", "Contact details"],
  ["summary", "Summary"],
  ["skills", "Skills"],
  ["experience", "Employment history"],
  ["education", "Education"],
  ["certifications", "Certifications"],
  ["preferences", "Job preferences"],
  ["notes", "Free-text notes"],
];

export const specFor = (section) => state.sections.find((spec) => spec.section === section);
const labelFor = (section) => specFor(section)?.label ?? section;
const confirmedIn = (section) => state.profileItems.filter((item) => item.section === section && item.status === "confirmed");

export async function loadProfileFacts() {
  const data = await api("/api/profile/items");
  state.sections = data.sections || [];
  state.profileItems = data.items || [];
  state.missing = data.missing || [];
  // Load the extracted text of each CV that still has proposals, to show where each one came from.
  const cvIds = new Set(state.profileItems.filter((item) => item.status === "proposed" && item.source.cvVersionId && !item.source.cvDeleted).map((item) => item.source.cvVersionId));
  await Promise.all(
    [...cvIds].filter((id) => !state.cvText.has(id)).map(async (id) => {
      try {
        state.cvText.set(id, (await api(`/api/cv/versions/${id}/text`)).text);
      } catch {
        // the proposal is still shown, just without the quoted source
      }
    }),
  );
}

// ---- Values: display and editing ------------------------------------------------------------------

/** A readable, read-only rendering of a stored value. */
export function valueView(section, value) {
  const spec = specFor(section);
  if (!spec) return el("span", { text: JSON.stringify(value) });
  if (spec.fields.length === 1) {
    const field = spec.fields[0];
    const raw = value[field.name];
    const text = field.kind === "choice" ? (field.choices || []).find((choice) => choice.value === raw)?.label ?? raw : raw;
    return el("p", { class: "value-text", text: Array.isArray(text) ? text.join(", ") : text ?? "" });
  }
  const rows = spec.fields.filter((field) => value[field.name] !== undefined && value[field.name] !== "" && !(Array.isArray(value[field.name]) && value[field.name].length === 0));
  return el(
    "dl",
    { class: "value" },
    rows.map((field) => [
      el("dt", { text: field.label }),
      el("dd", {}, Array.isArray(value[field.name]) ? el("ul", {}, value[field.name].map((line) => el("li", { text: line }))) : value[field.name]),
    ]),
  );
}

const valueSummary = (section, value) => valueView(section, value).textContent.replace(/\s+/g, " ").trim();

/** Inputs for one value, labelled from the section's field definitions. read() returns the value. */
function valueEditor(section, value, idPrefix) {
  const spec = specFor(section);
  const controls = [];
  const nodes = spec.fields.map((field) => {
    const id = `${idPrefix}-${field.name}`;
    const current = value?.[field.name];
    let input;
    if (field.kind === "choice") {
      input = el("select", { id }, el("option", { value: "", text: "Choose…" }), (field.choices || []).map((choice) => el("option", { value: choice.value, text: choice.label, selected: choice.value === current })));
    } else if (field.kind === "multiline" || field.kind === "list") {
      input = el("textarea", { id, rows: field.kind === "list" ? 4 : 3, maxlength: field.kind === "list" ? undefined : field.max });
      input.value = Array.isArray(current) ? current.join("\n") : current ?? "";
    } else {
      input = el("input", { id, maxlength: field.max, autocomplete: "off" });
      input.value = current ?? "";
    }
    controls.push([field, input]);
    const hint = field.kind === "list" && !field.label.includes("one per line") ? " (one per line)" : "";
    return el("div", { class: "field" }, el("label", { for: id, text: `${field.label}${hint}${field.required ? " (required)" : ""}` }), input);
  });
  return {
    node: el("div", { class: "editor" }, nodes),
    read() {
      const out = {};
      for (const [field, input] of controls) {
        if (field.kind === "list") {
          const lines = input.value.split("\n").map((line) => line.trim()).filter(Boolean);
          if (lines.length) out[field.name] = lines;
        } else if (input.value.trim() !== "") {
          out[field.name] = input.value.trim();
        }
      }
      return out;
    },
    focus() {
      controls[0]?.[1].focus();
    },
  };
}

function sourceText(item) {
  const source = item.source;
  if (source.type === "cv_extraction") {
    if (source.cvDeleted) return "From a CV you have since deleted";
    const version = state.cvVersions.find((candidate) => candidate.id === source.cvVersionId);
    return `From CV “${version?.file?.name ?? "unknown"}”`;
  }
  if (source.type === "legacy_profile") return `From your original profile notes${source.field ? ` (${source.field})` : ""}`;
  return "Added by you";
}

function quote(item) {
  const { cvVersionId, span } = item.source;
  const text = cvVersionId ? state.cvText.get(cvVersionId) : null;
  if (!text || !span) return null;
  const excerpt = text.slice(span.start, span.end);
  return el("blockquote", { class: "source-quote" }, el("span", { class: "muted small", text: "As written in the CV: " }), excerpt.length > 400 ? `${excerpt.slice(0, 400)}…` : excerpt);
}

// ---- Confirming, rejecting, editing ----------------------------------------------------------------

/** Sends a request that may conflict with an existing confirmed value; asks before replacing it. */
async function withReplacePrompt(section, newValue, send) {
  try {
    return await send(false);
  } catch (error) {
    if (error.code !== "confirmed_value_exists") throw error;
    const label = labelFor(section);
    const current = confirmedIn(section)[0];
    const replace = await confirmDialog({
      title: `Replace your confirmed ${label.toLowerCase()}?`,
      message: `Confirmed now: “${current ? valueSummary(section, current.value) : "?"}”. Replace it with “${valueSummary(section, newValue)}”? The current value is kept in your history as superseded.`,
      confirmLabel: "Replace",
    });
    if (!replace) return null;
    return send(true);
  }
}

async function confirmProposal(item, editor, button) {
  await busy(button, async () => {
    const value = editor ? editor.read() : item.value;
    try {
      const result = await withReplacePrompt(item.section, value, (replaceConfirmed) =>
        api(`/api/profile/items/${item.id}/confirm`, { method: "POST", json: { ...(editor ? { value } : {}), ...(replaceConfirmed ? { replaceConfirmed: true } : {}) } }),
      );
      if (!result) return say(`Kept your confirmed ${labelFor(item.section).toLowerCase()}. The proposal is still waiting for review.`);
      await refreshWorkspace();
      say(`${labelFor(item.section)} confirmed${result.superseded ? " (it replaced the previous value)" : ""}.`);
    } catch (error) {
      say(error.code === "already_confirmed" ? "The same value is already confirmed. Reject this proposal instead." : error.message, "error");
    }
  });
}

async function rejectProposal(item, button) {
  await busy(button, async () => {
    try {
      await api(`/api/profile/items/${item.id}/reject`, { method: "POST" });
      await refreshWorkspace();
      say(`${labelFor(item.section)} proposal rejected.`);
    } catch (error) {
      say(error.message, "error");
    }
  });
}

async function confirmRemaining(versionId, name, count, button) {
  const ok = await confirmDialog({
    title: "Confirm all facts from this CV?",
    message: `The ${count} fact(s) read from “${name}” are added to your profile exactly as written in the CV. A fact that would replace or repeat one you have already confirmed, or that needs editing first, stays here for you to check. You can edit or remove any fact afterwards.`,
    confirmLabel: "Confirm all",
  });
  if (!ok) return;
  await busy(button, async () => {
    try {
      const result = await api(`/api/cv/versions/${versionId}/proposals/confirm`, { method: "POST" });
      await refreshWorkspace();
      const left = result.skipped.wouldReplace + result.skipped.duplicate + result.skipped.needsEdit;
      say(`Confirmed ${result.confirmed} fact(s) from “${name}”.${left ? ` ${left} left below for you to check.` : ""}`);
    } catch (error) {
      say(error.message, "error");
    }
  });
}

async function rejectRemaining(versionId, name, button) {
  const ok = await confirmDialog({ title: "Reject the remaining proposals?", message: `Every proposal from “${name}” that you have not confirmed will be rejected. Confirmed facts are not affected.`, confirmLabel: "Reject remaining" });
  if (!ok) return;
  await busy(button, async () => {
    try {
      const result = await api(`/api/cv/versions/${versionId}/proposals/reject`, { method: "POST" });
      await refreshWorkspace();
      say(`Rejected ${result.rejected} proposal(s) from “${name}”.`);
    } catch (error) {
      say(error.message, "error");
    }
  });
}

// ---- Rendering: review queue -----------------------------------------------------------------------

function proposalCard(item) {
  const label = labelFor(item.section);
  const view = el("div", {}, valueView(item.section, item.value));
  let editor = null;
  const current = specFor(item.section)?.single ? confirmedIn(item.section)[0] : null;
  const editButton = el("button", { type: "button", class: "secondary edit", text: "Edit before confirming", "aria-label": `Edit ${label} before confirming` });
  editButton.addEventListener("click", () => {
    editor = valueEditor(item.section, item.value, `proposal-${item.id}`);
    view.replaceChildren(editor.node);
    editButton.hidden = true;
    editor.focus();
  });
  return el(
    "article",
    { class: "item proposal", "data-item-id": item.id, "data-section": item.section },
    el("div", { class: "bar" }, el("h5", { text: label }), el("span", { class: "pill warn", text: "Awaiting review" })),
    view,
    quote(item),
    el("p", { class: "muted small", text: sourceText(item) }),
    current ? el("p", { class: "notice", text: `Already confirmed: “${valueSummary(item.section, current.value)}”. Confirming this would replace it (you will be asked).` }) : null,
    el(
      "div",
      { class: "actions" },
      el("button", { type: "button", class: "confirm", text: "Confirm", "aria-label": `Confirm ${label}`, onclick: (event) => confirmProposal(item, editor, event.currentTarget) }),
      editButton,
      el("button", { type: "button", class: "secondary reject", text: "Reject", "aria-label": `Reject ${label}`, onclick: (event) => rejectProposal(item, event.currentTarget) }),
    ),
  );
}

function renderProposals() {
  const proposed = state.profileItems.filter((item) => item.status === "proposed");
  $("proposal-count").textContent = proposed.length ? `${proposed.length} awaiting review` : "Nothing to review";
  const groups = new Map();
  for (const item of proposed) {
    const key = item.source.cvVersionId ? `cv:${item.source.cvVersionId}` : item.source.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const container = $("proposals");
  container.replaceChildren(
    ...[...groups.entries()].map(([key, items]) => {
      const versionId = key.startsWith("cv:") ? key.slice(3) : null;
      const version = versionId ? state.cvVersions.find((candidate) => candidate.id === versionId) : null;
      const title = version ? `From CV “${version.file?.name ?? "unknown"}”` : key === "legacy_profile" ? "From your original profile notes" : "Other proposals";
      return el(
        "section",
        { class: "proposal-group", "data-source": key, "aria-label": title },
        el(
          "div",
          { class: "bar" },
          el("h4", { text: `${title} · ${items.length}` }),
          version ? el("button", { type: "button", class: "confirm-all", text: `Confirm all ${items.length}`, "aria-label": `Confirm all ${items.length} proposals from ${version.file?.name ?? "this CV"}`, onclick: (event) => confirmRemaining(version.id, version.file?.name ?? "this CV", items.length, event.currentTarget) }) : null,
          version ? el("button", { type: "button", class: "secondary reject-all", text: "Reject all remaining", "aria-label": `Reject all remaining proposals from ${version.file?.name ?? "this CV"}`, onclick: (event) => rejectRemaining(version.id, version.file?.name ?? "this CV", event.currentTarget) }) : null,
        ),
        items.map(proposalCard),
      );
    }),
  );
  if (proposed.length === 0) container.append(el("p", { class: "muted small", text: "No proposals are waiting. Upload a CV or review your original notes to get proposals." }));
}

// ---- Rendering: confirmed profile ------------------------------------------------------------------

async function saveEdit(item, editor, button) {
  await busy(button, async () => {
    try {
      await api(`/api/profile/items/${item.id}`, { method: "PATCH", json: { value: editor.read() } });
      await refreshWorkspace();
      say(`${labelFor(item.section)} updated.`);
    } catch (error) {
      say(error.message, "error");
    }
  });
}

async function removeFact(item, button) {
  const label = labelFor(item.section);
  const ok = await confirmDialog({ title: `Remove this ${label.toLowerCase()}?`, message: `“${valueSummary(item.section, item.value)}” will be removed from your confirmed profile and no longer used for matching or drafts.`, confirmLabel: "Remove", danger: true });
  if (!ok) return;
  await busy(button, async () => {
    try {
      await api(`/api/profile/items/${item.id}`, { method: "DELETE" });
      await refreshWorkspace();
      say(`${label} removed.`);
    } catch (error) {
      say(error.message, "error");
    }
  });
}

async function addFact(section, editor, button) {
  await busy(button, async () => {
    const value = editor.read();
    try {
      const result = await withReplacePrompt(section, value, (replaceConfirmed) =>
        api("/api/profile/items", { method: "POST", json: { section, value, ...(replaceConfirmed ? { replaceConfirmed: true } : {}) } }),
      );
      if (!result) return say(`Kept your confirmed ${labelFor(section).toLowerCase()}.`);
      await refreshWorkspace();
      say(`${labelFor(section)} added to your confirmed profile.`);
    } catch (error) {
      say(error.code === "already_confirmed" ? "That value is already confirmed." : error.message, "error");
    }
  });
}

function factRow(item) {
  const label = labelFor(item.section);
  const body = el("div", {}, valueView(item.section, item.value));
  const actions = el("div", { class: "actions" });
  const showView = () => {
    body.replaceChildren(valueView(item.section, item.value));
    actions.replaceChildren(
      el("button", { type: "button", class: "secondary", text: "Edit", "aria-label": `Edit ${label}`, onclick: showEditor }),
      el("button", { type: "button", class: "danger", text: "Remove", "aria-label": `Remove ${label}`, onclick: (event) => removeFact(item, event.currentTarget) }),
    );
  };
  function showEditor() {
    const editor = valueEditor(item.section, item.value, `fact-${item.id}`);
    body.replaceChildren(editor.node);
    actions.replaceChildren(
      el("button", { type: "button", text: "Save", "aria-label": `Save ${label}`, onclick: (event) => saveEdit(item, editor, event.currentTarget) }),
      el("button", { type: "button", class: "secondary", text: "Cancel", onclick: showView }),
    );
    editor.focus();
  }
  showView();
  const provenance = `${sourceText(item)}${item.userEdited ? " · edited by you" : ""}${item.decidedAt ? ` · confirmed ${formatDate(item.decidedAt)}` : ""}`;
  return el("li", { class: "fact", "data-item-id": item.id }, body, el("p", { class: "muted small", text: provenance }), actions);
}

function sectionBlock(spec) {
  const confirmed = confirmedIn(spec.section);
  const add = el("div", { class: "add" });
  const stateLabel = { confirmed: "Confirmed", unconfirmed: "Awaiting review", missing: "Missing" }[spec.state] ?? spec.state;
  // Skills, employment history and preferred titles also count as present when their free-text
  // note is confirmed (see SATISFIED_BY in worker/src/profile/proposals.ts).
  const coveredByNotes = spec.state === "confirmed" && confirmed.length === 0;
  const showAddButton = () =>
    add.replaceChildren(
      spec.single && confirmed.length
        ? ""
        : el("button", { type: "button", class: "secondary", text: `Add ${spec.label.toLowerCase()}`, onclick: () => {
            const editor = valueEditor(spec.section, null, `add-${spec.section}`);
            add.replaceChildren(
              editor.node,
              el(
                "div",
                { class: "actions" },
                el("button", { type: "button", text: "Save", "aria-label": `Save new ${spec.label.toLowerCase()}`, onclick: (event) => addFact(spec.section, editor, event.currentTarget) }),
                el("button", { type: "button", class: "secondary", text: "Cancel", onclick: showAddButton }),
              ),
            );
            editor.focus();
          } }),
    );
  showAddButton();
  return el(
    "div",
    { class: "facts-section", "data-section": spec.section },
    el("div", { class: "bar" }, el("h5", { text: spec.label }), el("span", { class: `pill ${spec.state === "confirmed" ? "ok" : spec.state === "unconfirmed" || spec.expected ? "warn" : ""}`, text: stateLabel })),
    confirmed.length ? el("ul", { class: "list facts" }, confirmed.map(factRow)) : null,
    coveredByNotes ? el("p", { class: "muted small", text: "Covered by your confirmed free-text notes below." }) : null,
    add,
  );
}

function renderConfirmed() {
  const missing = state.missing.map(labelFor);
  $("profile-missing").textContent = missing.length ? `Still missing: ${missing.join(", ")}.` : "Every expected part of your profile has at least one confirmed fact.";
  $("profile-missing").className = missing.length ? "small notice" : "small success";
  const count = state.profileItems.filter((item) => item.status === "confirmed").length;
  $("confirmed-count").textContent = `${count} confirmed fact${count === 1 ? "" : "s"}`;
  $("facts").replaceChildren(
    ...GROUPS.map(([group, title]) => {
      const specs = state.sections.filter((spec) => spec.group === group);
      if (specs.length === 0) return null;
      return el("section", { class: "facts-group", "aria-label": title }, el("h4", { text: title }), specs.map(sectionBlock));
    }).filter(Boolean),
  );
}

export function renderProfileFacts() {
  renderProposals();
  renderConfirmed();
}

// ---- Original notes, export and delete ---------------------------------------------------------------

export function initProfileFacts() {
  $("legacy-propose").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      try {
        const result = await api("/api/profile/legacy/proposals", { method: "POST" });
        await refreshWorkspace();
        say(
          result.proposalsCreated > 0
            ? `${result.proposalsCreated} proposal(s) created from your saved notes. Review them under “Facts awaiting your review”.`
            : "No new proposals: every saved note is already waiting for review or confirmed.",
        );
      } catch (error) {
        say(error.message, "error");
      }
    }),
  );

  $("export-profile").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      try {
        const response = await api("/api/profile/export", { raw: true });
        const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "");
        saveBlob(await response.blob(), match ? match[1] : "career-ai-profile-export.json");
        say("Profile export downloaded. It contains personal data: store it securely.");
      } catch (error) {
        say(error.message, "error");
      }
    }),
  );

  $("delete-profile-data").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const phrase = "DELETE PROFILE DATA";
    const ok = await confirmDialog({
      title: "Delete all structured profile facts?",
      message: "Every confirmed, proposed and rejected fact is deleted permanently. Matching and drafts stop working until you confirm facts again. Your original notes and your CV files are kept (delete CV versions individually).",
      confirmLabel: "Delete profile facts",
      phrase,
      danger: true,
    });
    if (!ok) return;
    await busy(button, async () => {
      try {
        const result = await api("/api/profile/items", { method: "DELETE", json: { confirm: phrase } });
        await refreshWorkspace();
        say(`Deleted ${result.deleted} profile fact(s). Your original notes and CV files were kept.`);
      } catch (error) {
        say(error.message, "error");
      }
    });
  });
}
