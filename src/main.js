// Credential manager UI. Every ArcGIS call goes through `api` (src/api.js, or src/mock.js with ?mock).
import config from "../config.js";
import { ALL_PRIVILEGES, groupPrivileges } from "./privileges.js";
import { auditCredential, OWNER_KEY, ownerOf, splitPrivileges, tierOf, tokenSlots, worstLevel } from "./audit.js";

const MOCK = new URLSearchParams(location.search).has("mock");
const api = await import(MOCK ? "./mock.js" : "./api.js");

const DAY = 86_400_000;
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "no date");
const daysLeft = (ms) => Math.floor((ms - Date.now()) / DAY);
const splitList = (text, sep) => text.split(sep).map((s) => s.trim()).filter(Boolean);
const LEVEL_TEXT = { ok: "OK", info: "Info", warning: "Warning", danger: "Critical" };

const state = {
  user: null,
  items: [],
  creds: [],
  expirations: [],
  projects: [],
  userTags: [], // [{ tag, count }] from getUserTags, across every item the user owns
  keptTags: new Set(), // new-family tags the user chose to keep (no more warnings)
  renaming: false, // title of the selected credential is being edited
  editingTags: false, // tags of the selected credential are being edited
  editing: null, // detail section being edited: access, redirect-uris, owner or notes
  pendingRedirects: null, // { itemId, redirect_uris } waiting for confirmation
  pendingAccess: null, // access waiting for confirmation
  pendingSlot: null, // { itemId, slot } waiting for confirmation in the generate/regenerate dialog
  revealed: new Set(), // `${itemId}/${slot}` whose partial key is visible
  logos: {}, // `${groupId}/${thumbnail}` → object URL
  filter: "all", // "all" | "none" | groupId
  tags: [], // selected tags (AND)
  terms: [], // free-text search chips (AND)
  query: "", // text being typed in the search box
  kpi: null, // null | "apiKey" | "oauth" | "expiring" | "critical"
  selection: [], // itemIds selected in the table
  selectedId: null,
  editingProjectId: null,
  batchMode: null,
  lastToken: null,
  // Project changes made in this session, applied on top of the (eventually consistent) search results
  projectPatches: {}, // id → { at, deleted?, created?, title?, snippet? }
};

const PATCH_TTL = 60_000;

function applyProjectPatches(projects) {
  const now = Date.now();
  for (const [id, patch] of Object.entries(state.projectPatches)) if (now - patch.at > PATCH_TTL) delete state.projectPatches[id];
  let result = projects.filter((p) => !state.projectPatches[p.id]?.deleted);
  for (const [id, patch] of Object.entries(state.projectPatches)) {
    if (patch.created && !result.some((p) => p.id === id)) result.push({ id, title: patch.title, snippet: "", thumbnail: null, itemIds: [] });
  }
  return result.map((p) => {
    const patch = state.projectPatches[p.id];
    return patch && !patch.deleted ? { ...p, ...(patch.title && { title: patch.title }), ...(patch.snippet !== undefined && { snippet: patch.snippet }), ...(patch.description !== undefined && { description: patch.description }) } : p;
  });
}

// ---------- startup ----------

$("#mock-chip").hidden = !MOCK;
$("#sign-in").addEventListener("click", async () => {
  const button = $("#sign-in");
  button.loading = true;
  try {
    await start(await api.signIn());
  } catch (error) {
    notify("danger", error.message);
  } finally {
    button.loading = false;
  }
});
$("#sign-out").addEventListener("click", async () => {
  await api.signOut();
  location.reload();
});

async function boot() {
  try {
    const user = await api.restoreSession();
    user ? await start(user) : showLogin();
  } catch (error) {
    console.error(error);
    await api.signOut();
    showLogin();
  }
}

function showLogin() {
  $("#login").hidden = false;
  $("#app").hidden = true;
}

async function start(user) {
  state.user = user;
  $("#login").hidden = true;
  $("#app").hidden = false;
  Object.assign($("#nav-user"), { fullName: user.fullName, username: user.username });
  // User menu: links to the portal, the Location Platform dashboard and the account settings
  $("#menu-portal").href = user.portalHome;
  $("#menu-portal").textContent = `My portal · ${new URL(user.portalHome).host}`;
  $("#menu-dashboard").href = `${config.dashboardUrl}/dashboard/`;
  $("#menu-settings").href = `${user.portalHome}/home/user.html#settings`;
  await refresh();
  // Deep link: index.html#credential/<itemId>
  if (hashId() && byId(hashId())) openDetail(hashId(), { push: false });
}

async function refresh() {
  const items = await api.loadItems();
  const [creds, expirations, projects] = await Promise.all([
    api.loadCredentials(items),
    api.loadTokenExpirations(),
    api.loadProjects(),
  ]);
  const userTags = await api.loadUserTags().catch(() => []);
  Object.assign(state, { items, creds, expirations, userTags, projects: applyProjectPatches(projects) });
  state.selection = state.selection.filter((id) => creds.some((c) => c.itemId === id));
  render();
  loadLogos();
}

// Logos are fetched once per thumbnail and then reused
async function loadLogos() {
  const missing = state.projects.filter((p) => p.thumbnail && !(logoKey(p) in state.logos));
  if (!missing.length) return;
  await Promise.all(missing.map(async (p) => (state.logos[logoKey(p)] = await api.loadProjectLogo(p).catch(() => null))));
  renderProjects();
}
const logoKey = (p) => `${p.id}/${p.thumbnail}`;

// Runs an action with a spinner on the button, refreshes and notifies
async function run(button, action, successMessage) {
  if (button) button.loading = true;
  try {
    const result = await action();
    await refresh();
    if (successMessage) notify("success", successMessage);
    return result;
  } catch (error) {
    console.error(error);
    notify("danger", error.message ?? String(error));
  } finally {
    if (button) button.loading = false;
  }
}

function notify(kind, message) {
  const alert = $("#alert");
  alert.kind = kind;
  alert.querySelector("[slot=title]").textContent = { danger: "Error", warning: "Partially done" }[kind] ?? "Done";
  alert.querySelector("[slot=message]").textContent = message;
  alert.open = true;
}

// ---------- derived data ----------

const byId = (itemId) => state.creds.find((c) => c.itemId === itemId);
const itemById = (id) => state.items.find((i) => i.id === id);
const projectsOf = (itemId) => state.projects.filter((p) => p.itemIds.includes(itemId));
const findingsOf = (cred) => auditCredential(cred, state);
const dataItems = () => state.items.filter((i) => i.type !== "Application");
// ArcGIS can store an empty tag ("") on items; it has nothing to show, so it is ignored everywhere
const isShownTag = (t) => !config.hiddenTags.includes(t) && tagLabel(t) !== "";
const tagsOf = (cred) => (cred.item.tags ?? []).filter(isShownTag);
const hiddenTagsOf = (cred) => (cred.item.tags ?? []).filter((t) => config.hiddenTags.includes(t));
const portalItemUrl = (id) => `${state.user.portalHome}/home/item.html?id=${id}`;
const portalGroupUrl = (id) => `${state.user.portalHome}/home/group.html?id=${id}`;
const usageUrl = (id) => `${config.dashboardUrl}/usage/credentials/${id}/`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const tierBadge = (item, short = false) => {
  const tier = tierOf(item);
  return tier
    ? `<span class="badge tier-${tier}" title="Data tier (tag tier:${esc(tier)})">${esc(capitalize(tier))}${short ? "" : " data"}</span>`
    : `<span class="badge neutral" title="Item has no tier:* tag">No tier</span>`;
};

// Tags are "family:value". The family picks the color, the chip shows a readable value.
const TAG_FAMILIES = ["env", "status", "customer", "team", "review"];
const tagFamily = (tag) => (tag.includes(":") ? tag.slice(0, tag.indexOf(":")) : "");
const tagLabel = (tag) => {
  const value = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
  return value.split(/[-_\s]+/).filter(Boolean).map(capitalize).join(" ");
};
const familyClass = (family) => {
  const i = TAG_FAMILIES.indexOf(family);
  if (i >= 0) return `fam-${i}`;
  if (!family) return "fam-none";
  const hash = [...family].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return `fam-${TAG_FAMILIES.length + (hash % 2)}`;
};
const tagChip = (tag) => `<span class="tag ${familyClass(tagFamily(tag))}" title="${esc(tag)}">${esc(tagLabel(tag))}</span>`;
const sortTags = (tags) => [...tags].sort((a, b) => {
  const rank = (t) => { const i = TAG_FAMILIES.indexOf(tagFamily(t)); return i < 0 ? TAG_FAMILIES.length : i; };
  return rank(a) - rank(b) || a.localeCompare(b);
});
const compactTags = (tags, max = 2) => {
  if (!tags.length) return `<span class="muted">—</span>`;
  const sorted = sortTags(tags);
  const rest = sorted.slice(max);
  return sorted.slice(0, max).map(tagChip).join("")
    + (rest.length ? `<span class="tag more" title="${esc(rest.join("\n"))}">+${rest.length}</span>` : "");
};

const KPI_FILTERS = {
  apiKey: { label: "API keys", test: (c) => c.kind === "apiKey" },
  oauth: { label: "OAuth apps", test: (c) => c.kind !== "apiKey" },
  expiring: { label: "Expiring tokens", test: (c) => expiringSlots(c).length > 0 },
  critical: { label: "Critical issues", test: (c) => worstLevel(findingsOf(c)) === "danger" },
};
const expiringSlots = (c) => c.kind === "apiKey"
  ? tokenSlots(c, state.expirations).filter((t) => t.expires && daysLeft(t.expires) <= config.expiringSoonDays)
  : [];

// Everything the search box matches against (partial, case-insensitive): title, Client ID, summary, owner,
// tags (raw and readable), projects, referrers and redirect URIs
const searchText = (c) => [
  c.item.title,
  c.client_id ?? "",
  c.item.snippet ?? "",
  ownerOf(c).owner ?? "",
  ...tagsOf(c).flatMap((t) => [t, tagLabel(t)]),
  ...projectsOf(c.itemId).map((p) => p.title),
  ...(c.httpReferrers ?? []),
  ...(c.redirect_uris ?? []),
].join("\n").toLowerCase();
const searchWords = () => [...state.terms, state.query].map((w) => w.trim().toLowerCase()).filter(Boolean);

function visibleCreds() {
  const words = searchWords();
  return state.creds
    .filter((c) => {
      if (state.filter === "all") return true;
      if (state.filter === "none") return !projectsOf(c.itemId).length;
      return projectsOf(c.itemId).some((p) => p.id === state.filter);
    })
    .filter((c) => !state.kpi || KPI_FILTERS[state.kpi].test(c))
    .filter((c) => state.tags.every((t) => tagsOf(c).includes(t)))
    .filter((c) => { const text = searchText(c); return words.every((w) => text.includes(w)); });
}

// Escapes text and wraps the search words it contains in <mark>
function highlight(text) {
  const words = searchWords();
  if (!words.length) return esc(text);
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return String(text).split(pattern).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}

// ---------- tag picker (new key, edit details, batch add tag) ----------

// Suggestions: the user's tags (getUserTags) plus any tag on a credential, minus data-item tiers and hidden tags
function tagSuggestions() {
  const counts = new Map(state.userTags.map(({ tag, count }) => [tag, count]));
  state.creds.flatMap(tagsOf).forEach((t) => counts.has(t) || counts.set(t, 1));
  return [...counts]
    .filter(([t]) => tagFamily(t) !== "tier" && isShownTag(t))
    .map(([tag, count]) => ({ tag, count }));
}
// Families in use on some other item (a tag only on the item being edited doesn't make its family "known")
const knownFamilies = (ownTags = []) => new Set(tagSuggestions()
  .filter(({ tag, count }) => count - (ownTags.includes(tag) ? 1 : 0) > 0)
  .map(({ tag }) => tagFamily(tag)).filter(Boolean));

// ArcGIS tags are free text: keep them lowercase with no spaces so filters keep matching
const normalizeTag = (t) => t.trim().toLowerCase().replace(/\s*:\s*/, ":").replace(/\s+/g, "-");

// Renders a fresh combobox into `box` (Calcite does not index items added after it renders).
// With `onCommit`, changes are saved as soon as the dropdown closes (inline editing in the detail panel).
function renderTagPicker(box, selected = [], { onCommit } = {}) {
  const suggestions = tagSuggestions();
  const extra = selected.filter((t) => !suggestions.some((s) => s.tag === t)).map((tag) => ({ tag, count: 0 }));
  const families = Object.groupBy(sortTags([...suggestions, ...extra].map((s) => s.tag)), tagFamily);
  const countOf = Object.fromEntries([...suggestions, ...extra].map((s) => [s.tag, s.count]));
  box.innerHTML = `
    <calcite-combobox selection-mode="multiple" allow-custom-values overlay-positioning="fixed" max-items="6"
      placeholder="Add a tag, e.g. env:prod" label="Tags">
      ${Object.entries(families).map(([family, tags]) => `
        <calcite-combobox-item-group label="${esc(family ? capitalize(family) : "No family")}">
          ${tags.map((t) => `<calcite-combobox-item value="${esc(t)}" heading="${esc(family ? `${capitalize(family)}: ${tagLabel(t)}` : tagLabel(t))}"
             description="${esc(t)}" ${selected.includes(t) ? "selected" : ""}>
             <span slot="content-end" class="muted">${countOf[t] ? `${countOf[t]} item${countOf[t] > 1 ? "s" : ""}` : "new"}</span>
           </calcite-combobox-item>`).join("")}
        </calcite-combobox-item-group>`).join("")}
    </calcite-combobox>
    <div class="tag-hints" role="status"></div>`;
  const combo = box.querySelector("calcite-combobox");
  // ownTags: tags already saved on this item, so they don't count as "in use elsewhere"
  box.tagPicker = { onCommit, ownTags: onCommit ? selected : [], committed: tagPickerValues(box, selected).join() };
  combo.addEventListener("calciteComboboxChange", () => {
    renderTagHints(box);
    if (!combo.open) commitTagPicker(box);
  });
  combo.addEventListener("calciteComboboxClose", () => commitTagPicker(box));
  renderTagHints(box, selected);
}

const tagPickerValues = (box, values = box.querySelector("calcite-combobox").selectedItems.map((i) => i.value)) =>
  [...new Set(values.map(normalizeTag).filter(Boolean))];

function commitTagPicker(box, values = tagPickerValues(box)) {
  const { onCommit, committed } = box.tagPicker;
  if (!onCommit || values.join() === committed) return;
  box.tagPicker.committed = values.join();
  onCommit(values);
}

// Tags that start a new family (usually a typo) or have no family, with a one-click fix
function renderTagHints(box, values = tagPickerValues(box)) {
  const families = knownFamilies(box.tagPicker?.ownTags);
  const hints = values.filter((t) => !state.keptTags.has(t)).map((t) => {
    const family = tagFamily(t);
    if (family && families.has(family)) return "";
    const similar = family && [...families].find((f) => f.slice(0, 3) === family.slice(0, 3));
    const fix = similar ? `${similar}:${t.slice(family.length + 1)}` : null;
    const text = !family ? `“${t}” has no family (family:value).`
      : fix ? `“${family}” is a new family. Did you mean <b>${esc(fix)}</b>?`
      : `“${family}” is a new family. Existing: ${esc([...families].sort().join(", "))}.`;
    return `<div class="tag-hint">
      <calcite-icon icon="exclamation-mark-triangle" scale="s" aria-hidden="true"></calcite-icon>
      <span>${text}</span>
      ${fix ? `<calcite-button scale="s" data-tag-fix="${esc(t)}" data-tag-to="${esc(fix)}">Use ${esc(fix)}</calcite-button>` : ""}
      <calcite-button scale="s" appearance="transparent" data-tag-keep="${esc(t)}">${fix ? "Keep" : "OK"}</calcite-button>
    </div>`;
  });
  box.querySelector(".tag-hints").innerHTML = hints.join("");
}

// "Use env:prod" replaces the tag, "Keep" stops warning about it
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-tag-fix], [data-tag-keep]");
  const box = button?.closest(".tag-picker");
  if (!box) return;
  const values = tagPickerValues(box);
  if (button.dataset.tagKeep) {
    state.keptTags.add(button.dataset.tagKeep);
    return renderTagHints(box, values);
  }
  const fixed = [...new Set(values.map((t) => (t === button.dataset.tagFix ? button.dataset.tagTo : t)))];
  const { onCommit, committed, ownTags } = box.tagPicker;
  renderTagPicker(box, fixed, { onCommit });
  Object.assign(box.tagPicker, { committed, ownTags });
  // Pass the values: the new combobox has not loaded its selection yet
  commitTagPicker(box, fixed);
});

// ---------- render ----------

function render() {
  renderProjects();
  renderTags();
  renderSummary();
  renderTable();
  renderDetail();
}

function renderProjects() {
  const item = (value, label, description, project) => {
    const logo = project && state.logos[logoKey(project)];
    return `
      <calcite-list-item value="${esc(value)}" label="${esc(label)}" description="${esc(description)}" ${state.filter === value ? "selected" : ""}>
        ${logo ? `<img slot="content-start" class="logo" src="${logo}" alt="" />` : project ? `<calcite-icon slot="content-start" icon="group"></calcite-icon>` : ""}
        ${project ? `<calcite-action slot="actions-end" icon="pencil" text="Edit project" data-edit-project="${esc(project.id)}"></calcite-action>` : ""}
      </calcite-list-item>`;
  };
  const none = state.creds.filter((c) => !projectsOf(c.itemId).length).length;
  $("#projects").innerHTML = [
    item("all", "All", `${state.creds.length} credentials`),
    ...state.projects.map((p) => item(p.id, p.title, p.snippet || `${p.itemIds.length} items`, p)),
    item("none", "No project", `${none} credentials · needs triage`),
  ].join("");
}

// Search box: tags grouped by family (with how many credentials use each), plus free-text chips
function renderTags() {
  const counts = {};
  state.creds.flatMap(tagsOf).forEach((t) => (counts[t] = (counts[t] ?? 0) + 1));
  state.tags = state.tags.filter((t) => counts[t]);
  const families = Object.groupBy(sortTags(Object.keys(counts)), tagFamily);
  // The count goes in a slot: Calcite filters on the description, and "3 items" would match "te"
  const option = (value, heading, count, selected) =>
    `<calcite-combobox-item value="${esc(value)}" heading="${esc(heading)}" description="${esc(value)}" ${selected ? "selected" : ""}>
      ${count ? `<span slot="content-end" class="muted">${count}</span>` : ""}
    </calcite-combobox-item>`;
  const groups = Object.entries(families).map(([family, tags]) => `
    <calcite-combobox-item-group label="${esc(family ? capitalize(family) : "Other")}">
      ${tags.map((t) => option(t, family ? `${capitalize(family)}: ${tagLabel(t)}` : tagLabel(t), counts[t], state.tags.includes(t))).join("")}
    </calcite-combobox-item-group>`);
  if (state.terms.length) {
    groups.push(`<calcite-combobox-item-group label="Text">${state.terms.map((t) => option(t, `“${t}”`, 0, true)).join("")}</calcite-combobox-item-group>`);
  }
  // Calcite's combobox does not index items added after it renders, so the whole element is rebuilt
  $("#search-box").innerHTML = `
    <calcite-combobox id="search" label="Search credentials" selection-mode="multiple" allow-custom-values placeholder-icon="search"
      placeholder="Search name, Client ID, project… or type a tag family like env:">${groups.join("")}</calcite-combobox>`;
  state.query = "";
}

function renderSummary() {
  const keys = state.creds.filter((c) => c.kind === "apiKey");
  const expiring = keys.flatMap((k) => tokenSlots(k, state.expirations))
    .filter((t) => t.expires && daysLeft(t.expires) <= config.expiringSoonDays).length;
  const critical = state.creds.filter((c) => worstLevel(findingsOf(c)) === "danger").length;
  const tile = (kpi, icon, value, label, level = "") => `
    <button type="button" class="tile ${level}" data-kpi="${kpi}" aria-pressed="${state.kpi === kpi}"
      title="${state.kpi === kpi ? "Clear this filter" : "Show only these credentials"}">
      <calcite-icon icon="${icon}" scale="s" aria-hidden="true"></calcite-icon><b>${value}</b><span>${label}</span>
    </button>`;
  $("#summary").innerHTML = [
    tile("apiKey", "key", keys.length, "API keys"),
    tile("oauth", "app-gear", state.creds.length - keys.length, "OAuth apps"),
    tile("expiring", "clock", expiring, `Tokens expiring ≤ ${config.expiringSoonDays} d`, expiring ? "warning" : ""),
    tile("critical", "exclamation-mark-triangle", critical, "Critical issues", critical ? "danger" : ""),
  ].join("");
}

function renderTable() {
  const title = { all: "All credentials", none: "No project" }[state.filter]
    ?? state.projects.find((p) => p.id === state.filter)?.title;
  $("#list-title").textContent = state.kpi ? `${title} · ${KPI_FILTERS[state.kpi].label}` : title;

  const showProject = state.filter === "all";
  const headers = ["Credential", ...(showProject ? ["Project"] : []), "Tokens", "Privileges", "Items", "Audit"];
  const rows = visibleCreds().map((c) => rowHtml(c, showProject)).join("");
  $("#table").innerHTML = `
    <calcite-action slot="selection-actions" icon="x-circle" text="Revoke tokens" text-enabled data-batch="revoke"></calcite-action>
    <calcite-action slot="selection-actions" icon="group" text="Move to project" text-enabled data-batch="move"></calcite-action>
    <calcite-action slot="selection-actions" icon="tag" text="Add tag" text-enabled data-batch="tag"></calcite-action>
    <calcite-action slot="selection-actions" icon="trash" text="Delete" text-enabled data-batch="delete"></calcite-action>
    <calcite-table-row slot="table-header">
      ${headers.map((h) => `<calcite-table-header heading="${h}"></calcite-table-header>`).join("")}
    </calcite-table-row>
    ${rows || `<calcite-table-row><calcite-table-cell col-span="${headers.length}">${
      state.kpi || state.tags.length || searchWords().length ? `No credentials match the filters. <calcite-button appearance="transparent" scale="s" data-clear-filters>Clear filters</calcite-button>` : "No credentials"
    }</calcite-table-cell></calcite-table-row>`}`;
}

function rowHtml(c, showProject) {
  const findings = findingsOf(c);
  const level = worstLevel(findings);
  const isKey = c.kind === "apiKey";
  const { itemIds, privileges } = splitPrivileges(c.privileges);
  const tokens = isKey ? `<span class="stack">${tokenBadges(c) || `<span class="badge neutral">none</span>`}</span>` : "—";
  return `
    <calcite-table-row data-id="${esc(c.itemId)}" ${state.selection.includes(c.itemId) ? "selected" : ""}>
      <calcite-table-cell>
        <span class="cred-title" title="${isKey ? "API key" : "App credentials (OAuth)"}">
          <calcite-icon icon="${isKey ? "key" : "app-gear"}" scale="s" aria-hidden="true"></calcite-icon>
          <a href="${detailHash(c.itemId)}" class="row-link" data-open="${esc(c.itemId)}"><b>${highlight(c.item.title)}</b></a><span class="sr-only">, ${isKey ? "API key" : "App credentials"}</span>
        </span>
        ${c.item.snippet ? `<span class="row-summary">${highlight(c.item.snippet)}</span>` : ""}
        <span class="tags">${compactTags(tagsOf(c))}</span>
      </calcite-table-cell>
      ${showProject ? `<calcite-table-cell>${projectsOf(c.itemId).map((p) => esc(p.title)).join("<br />") || "—"}</calcite-table-cell>` : ""}
      <calcite-table-cell>${tokens}</calcite-table-cell>
      <calcite-table-cell>${isKey ? `<span title="${esc(privileges.join("\n"))}">${privileges.length}</span>` : "—"}</calcite-table-cell>
      <calcite-table-cell>${isKey ? itemTierBadges(itemIds) : "—"}</calcite-table-cell>
      <calcite-table-cell><span class="badge ${level}">${LEVEL_TEXT[level]}${findings.length ? ` · ${findings.length}` : ""}</span></calcite-table-cell>
    </calcite-table-row>`;
}

// One badge per tier with how many exposed items carry it, e.g. "Premium · 2"
function itemTierBadges(itemIds) {
  if (!itemIds.length) return `<span class="badge neutral">none</span>`;
  const counts = new Map();
  itemIds.forEach((id) => {
    const item = itemById(id);
    const key = item ? tierOf(item) ?? "" : "deleted";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const order = ["restricted", "premium", "open", "", "deleted"];
  const badges = [...counts].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([tier, n]) => {
    if (tier === "deleted") return `<span class="badge warning" title="Items that no longer exist">Deleted · ${n}</span>`;
    if (!tier) return `<span class="badge neutral" title="Items without a tier:* tag">No tier · ${n}</span>`;
    return `<span class="badge tier-${tier}" title="Data tier (tag tier:${esc(tier)})">${esc(capitalize(tier))} · ${n}</span>`;
  });
  return `<span class="stack">${badges.join("")}</span>`;
}

function tokenBadges(c) {
  return tokenSlots(c, state.expirations)
    .map(({ slot, expires }) => {
      if (!expires) return `<span class="badge neutral">T${slot}</span>`;
      const d = daysLeft(expires);
      const level = d < 0 ? "danger" : d <= config.expiringSoonDays ? "warning" : "ok";
      return `<span class="badge ${level}">T${slot} · ${d < 0 ? "expired" : `${d} d`}</span>`;
    })
    .join("");
}

// ---------- context: summary, notes and ownership ----------

// Item and group descriptions are HTML in ArcGIS; the app edits them as plain text
function htmlToText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"), "text/html");
  return doc.body.textContent.trim();
}
const textToHtml = (text) => esc(text.trim()).replace(/\n/g, "<br>");
// Plain text with clickable URLs, for showing notes
const linkify = (text) => esc(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`).replace(/\n/g, "<br>");

// Who can read what is typed in the forms: these fields travel with the item / group
function visibilityNote(where) {
  const text = where === "project"
    ? "Visible to every member of this group and to your organization's administrators."
    : where === "private"
      ? "Stored on the credential item: visible to you and your organization's administrators."
      : "Stored on the credential item, which is shared: everyone it is shared with can read it.";
  return `<p class="privacy-note"><calcite-icon icon="lock" scale="s" aria-hidden="true"></calcite-icon>
    <span>${text} Don't store secrets, and keep personal data to what you need (prefer team aliases).</span></p>`;
}

const OWNER_FIELDS = [
  { key: "owner", label: "Owner", placeholder: "Person or team responsible", icon: "user" },
  { key: "contact", label: "Contact", placeholder: "Email, Slack channel or phone", icon: "envelope" },
  { key: "deployedIn", label: "Deployed in", placeholder: "Repo, environment variable, secret store…", icon: "code" },
  { key: "link", label: "Link", placeholder: "Ticket, CRM opportunity…", icon: "link" },
];

function ownerCard(c) {
  const owner = ownerOf(c);
  const editing = state.editing === "owner";
  const action = state.editing ? "" : `<calcite-button appearance="transparent" scale="s" icon-start="pencil" data-edit-section="owner">Edit</calcite-button>`;
  if (editing) {
    const body = `
      <div class="owner-form">
        ${OWNER_FIELDS.map((f, i) => `<calcite-label>${f.label}
          <calcite-input-text ${i === 0 ? 'id="edit-owner"' : ""} data-owner-field="${f.key}" value="${esc(owner[f.key] ?? "")}" placeholder="${esc(f.placeholder)}"></calcite-input-text>
        </calcite-label>`).join("")}
      </div>
      ${visibilityNote(c.item.access === "private" || !c.item.access ? "private" : "shared")}
      <div class="edit-foot">
        <span></span>
        <calcite-button appearance="outline" scale="s" data-cancel-edit>Cancel</calcite-button>
        <calcite-button scale="s" data-save-owner>Save</calcite-button>
      </div>`;
    return card("user", "Ownership", body, action);
  }
  const rows = OWNER_FIELDS.filter((f) => owner[f.key]).map((f) => `
    <div class="owner-row"><calcite-icon icon="${f.icon}" scale="s" aria-hidden="true"></calcite-icon>
      <span class="muted">${f.label}</span><span>${f.key === "link" || /^https?:/.test(owner[f.key]) ? linkify(owner[f.key]) : esc(owner[f.key])}</span></div>`).join("");
  // Nothing on the credential: show what its projects say about who to call
  const inherited = projectsOf(c.itemId).filter((p) => p.description?.trim());
  const fallback = inherited.length
    ? inherited.map((p) => `<div class="inherited"><span class="muted">From project ${esc(p.title)}</span><p>${linkify(htmlToText(p.description))}</p></div>`).join("")
    : `<span class="muted">Nobody yet. Add who to contact when this credential expires or breaks.</span>`;
  return card("user", "Ownership", rows ? `<div class="owner-rows">${rows}</div>` : fallback, action);
}

function notesCard(c) {
  const editing = state.editing === "notes";
  const action = state.editing ? "" : `<calcite-button appearance="transparent" scale="s" icon-start="pencil" data-edit-section="notes">Edit</calcite-button>`;
  if (editing) {
    return card("speech-bubble", "Notes", `
      <calcite-text-area id="edit-notes" rows="5" label="Notes" placeholder="Context, decisions, history… e.g. referrers open on purpose until 30 Nov">${esc(htmlToText(c.item.description))}</calcite-text-area>
      ${visibilityNote(c.item.access === "private" || !c.item.access ? "private" : "shared")}
      <div class="edit-foot">
        <span></span>
        <calcite-button appearance="outline" scale="s" data-cancel-edit>Cancel</calcite-button>
        <calcite-button scale="s" data-save-notes>Save</calcite-button>
      </div>`, action);
  }
  const text = htmlToText(c.item.description);
  return card("speech-bubble", "Notes", text ? `<p class="notes">${linkify(text)}</p>` : `<span class="muted">No notes.</span>`, action);
}

// Only the item's own key in `properties` changes: other apps' properties are kept
function saveOwner() {
  const c = byId(state.selectedId);
  const owner = Object.fromEntries(
    [...document.querySelectorAll("[data-owner-field]")].map((i) => [i.dataset.ownerField, i.value.trim()]).filter(([, v]) => v)
  );
  const properties = { ...(c.item.properties ?? {}), [OWNER_KEY]: owner };
  state.editing = null;
  run(null, () => api.updateCredentialItem(c.itemId, { properties }), "Ownership saved");
}

function saveNotes() {
  const c = byId(state.selectedId);
  const description = textToHtml($("#edit-notes").value);
  state.editing = null;
  run(null, () => api.updateCredentialItem(c.itemId, { description }), "Notes saved");
}

// ---------- detail view (replaces the list in the centre) ----------

const card = (icon, heading, body, action = "") => `
  <section class="card">
    <header class="card-head"><h3><calcite-icon icon="${icon}" scale="s" aria-hidden="true"></calcite-icon>${heading}</h3>${action}</header>
    ${body}
  </section>`;

// Access sections are edited in place; saving any of them reissues the key's token (see saveSection)
const ACCESS_SECTIONS = {
  items: { icon: "layers", heading: "Exposed items" },
  privileges: { icon: "lock", heading: "Privileges" },
  referrers: { icon: "link", heading: "Referrers" },
};

function renderDetail() {
  const c = byId(state.selectedId);
  $("#list-view").hidden = !!c;
  $("#detail-view").hidden = !c;
  if (!c) return;
  const isKey = c.kind === "apiKey";
  const findings = findingsOf(c);

  const title = state.renaming
    ? `<div class="rename">
        <calcite-input-text id="rename-input" value="${esc(c.item.title)}" label="Credential title" scale="l"></calcite-input-text>
        <calcite-input-text id="snippet-input" value="${esc(c.item.snippet ?? "")}" label="Summary" max-length="250"
          placeholder="One-line summary: what is this credential for?"></calcite-input-text>
        <span class="muted">Enter to save · Esc to cancel</span>
      </div>`
    : `<h2>${esc(c.item.title)}</h2>
       <calcite-action class="reveal" icon="pencil" text="Edit name and summary" scale="s" data-rename></calcite-action>`;
  const summary = state.renaming ? ""
    : c.item.snippet
      ? `<p class="summary-line">${esc(c.item.snippet)}</p>`
      : `<calcite-link class="summary-add" data-rename>Add a one-line summary</calcite-link>`;

  const audit = findings.length
    ? `<ul class="findings">${findings.map((f) => `<li><span class="badge ${f.level}">${LEVEL_TEXT[f.level]}</span> ${esc(f.text)}</li>`).join("")}</ul>`
    : `<span class="badge ok">No issues</span>`;

  const projects = state.projects.length
    ? `<div class="checks">${state.projects.map((p) => `
        <calcite-label layout="inline">
          <calcite-checkbox data-project="${esc(p.id)}" ${p.itemIds.includes(c.itemId) ? "checked" : ""}></calcite-checkbox>
          ${esc(p.title)}
        </calcite-label>`).join("")}</div>`
    : `<span class="muted">Create a project in the left panel.</span>`;

  $("#detail-view").innerHTML = `
    <calcite-button appearance="transparent" icon-start="arrow-left" data-back>${esc($("#list-title").textContent)}</calcite-button>
    <header class="detail-head">
      <div class="title-row">
        <calcite-icon icon="${isKey ? "key" : "app-gear"}" scale="m" aria-hidden="true"></calcite-icon>
        ${title}
        <div class="head-links">
          <calcite-button appearance="outline" kind="neutral" scale="s" icon-start="graph-bar" href="${usageUrl(c.itemId)}" target="_blank">Usage</calcite-button>
          <calcite-button appearance="outline" kind="neutral" scale="s" icon-start="launch" href="${portalItemUrl(c.itemId)}" target="_blank">Portal item</calcite-button>
        </div>
      </div>
      ${summary}
      <div class="meta">
        <span><calcite-icon icon="${isKey ? "key" : "app-gear"}" scale="s" aria-hidden="true"></calcite-icon>${isKey ? "API key" : "OAuth app"}</span>
        <span><calcite-icon icon="calendar" scale="s" aria-hidden="true"></calcite-icon>Registered ${fmtDate(c.registered)}</span>
        <span><calcite-icon icon="clock" scale="s" aria-hidden="true"></calcite-icon>Modified ${fmtDate(c.modified)}</span>
      </div>
      ${state.editingTags
        ? `<div class="detail-tags editing">
            <div id="detail-tags-box" class="tag-picker"></div>
            <calcite-button scale="s" data-done-tags>Done</calcite-button>
          </div>`
        : `<div class="detail-tags">
            <span class="tags">${sortTags(tagsOf(c)).map(tagChip).join("")}</span>
            <calcite-button appearance="transparent" scale="s" icon-start="${tagsOf(c).length ? "pencil" : "plus"}" data-edit-tags>${tagsOf(c).length ? "Edit tags" : "Add tags"}</calcite-button>
          </div>`}
    </header>
    <div class="detail-grid">
      <div class="col">
        ${card("check-shield", "Audit", audit)}
        ${isKey ? Object.keys(ACCESS_SECTIONS).map((key) => accessCard(c, key)).join("") : oauthCards(c)}
      </div>
      <div class="col">
        ${isKey ? tokensCard(c) : ""}
        ${ownerCard(c)}
        ${notesCard(c)}
        ${card("group", "Projects", projects)}
      </div>
    </div>`;

  if (state.editingTags) {
    renderTagPicker($("#detail-tags-box"), tagsOf(c), {
      onCommit: (tags) => run(null, () => api.updateCredentialItem(c.itemId, { title: c.item.title, tags: [...tags, ...hiddenTagsOf(c)] }), "Tags saved"),
    });
    requestAnimationFrame(() => $("#detail-tags-box calcite-combobox")?.setFocus());
  }
  if (state.renaming) requestAnimationFrame(() => $("#rename-input")?.setFocus());
  if (state.editing) requestAnimationFrame(() => $(`#edit-${state.editing}`)?.setFocus?.());
}

function saveRename() {
  const c = byId(state.selectedId);
  const title = $("#rename-input").value.trim() || c.item.title;
  const snippet = $("#snippet-input").value.trim();
  state.renaming = false;
  if (title === c.item.title && snippet === (c.item.snippet ?? "")) return renderDetail();
  run(null, () => api.updateCredentialItem(c.itemId, { title, snippet }), "Saved");
}

document.addEventListener("keydown", (e) => {
  if (!state.renaming || !e.target.closest?.("#rename-input, #snippet-input")) return;
  if (e.key === "Enter") saveRename();
  if (e.key === "Escape") { e.stopPropagation(); state.renaming = false; renderDetail(); }
}, true);

// Like the portal's item page: one row per slot with its own generate / regenerate / invalidate actions
function tokensCard(c) {
  const slots = tokenSlots(c, state.expirations);
  const rows = [1, 2].map((slot) => {
    const active = c[`apiToken${slot}Active`];
    const expires = slots.find((t) => t.slot === slot)?.expires;
    const days = expires ? daysLeft(expires) : null;
    const key = `${c.itemId}/${slot}`;
    const status = !active ? `<span class="badge neutral">Not generated</span>`
      : days === null ? `<span class="badge ok">Active</span>`
      : days < 0 ? `<span class="badge danger">Expired</span>`
      : `<span class="badge ${days <= config.expiringSoonDays ? "warning" : "ok"}">Active</span>`;
    const partial = active && partialKey(c, slot)
      ? `<div class="partial">
          <calcite-link data-toggle-partial="${key}">${state.revealed.has(key) ? "Hide" : "Show"} partial API key</calcite-link>
          ${state.revealed.has(key) ? `<code>${esc(partialKey(c, slot))}</code>` : ""}
        </div>`
      : "";
    const when = !active ? "Generate it to rotate without downtime."
      : !expires ? "No expiration date"
      : `${days < 0 ? "Expired" : "Expires"} ${fmtDate(expires)} · ${days < 0 ? `${-days} days ago` : days === 0 ? "today" : `in ${days} days`}`;
    const actions = active
      ? `<calcite-button appearance="outline" scale="s" icon-start="refresh" data-slot-action="regenerate" data-slot="${slot}">Regenerate</calcite-button>
         <calcite-button appearance="outline" kind="danger" scale="s" icon-start="circle-disallowed" data-invalidate="${slot}">Invalidate</calcite-button>`
      : `<calcite-button appearance="outline" scale="s" icon-start="plus" data-slot-action="generate" data-slot="${slot}">Generate</calcite-button>`;
    return `
      <div class="keyslot">
        <div class="keyslot-info">
          <div class="keyslot-head"><b>API key ${slot}</b> ${status}</div>
          ${partial}
          <span class="muted">${when}</span>
        </div>
        <div class="keyslot-actions">${actions}</div>
      </div>`;
  }).join("");
  return card("key", "API keys", `<div class="keyslots">${rows}</div>`);
}

// The portal's "partial API key": AT<slot>_ + the last 8 characters of the credential's client_id
// (same approach as https://github.com/hhkaos/arcgis-api-key-manager-toolkit)
const partialKey = (c, slot) => (c.client_id?.length >= 8 ? `AT${slot}_${c.client_id.slice(-8)}` : null);

function openSlotDialog(slot, mode) {
  const c = byId(state.selectedId);
  const other = 3 - slot;
  state.pendingSlot = { itemId: c.itemId, slot };
  const regenerate = mode === "regenerate";
  $("#slot-dialog").heading = `${regenerate ? "Regenerate" : "Generate"} API key ${slot}`;
  $("#slot-dialog-body").innerHTML = regenerate
    ? `<p>The current API key ${slot} stops working immediately. Apps using it break until you deploy the new one.</p>
       ${c[`apiToken${other}Active`] ? "" : `<p class="muted">To avoid downtime, generate API key ${other} instead, update your app, then invalidate key ${slot}.</p>`}`
    : `<p>A new API key with the same privileges. API key ${other} ${c[`apiToken${other}Active`] ? "keeps working, so you can switch your app over and then invalidate it." : "is not generated."}</p>`;
  $("#slot-days").value = String(config.defaultValidityDays);
  Object.assign($("#slot-confirm"), { kind: regenerate ? "danger" : "brand", textContent: regenerate ? `Regenerate API key ${slot}` : `Generate API key ${slot}` });
  $("#slot-dialog").open = true;
}

$("#slot-confirm").addEventListener("click", (e) => {
  const { itemId, slot } = state.pendingSlot;
  const expiration = expirationFromDays(Number($("#slot-days").value) || config.defaultValidityDays);
  run(e.currentTarget, async () => {
    const result = await api.generateToken(byId(itemId), slot, expiration);
    $("#slot-dialog").open = false;
    const other = 3 - slot;
    showToken(result, byId(itemId)?.[`apiToken${other}Active`]
      ? `Deploy it to your app, then invalidate API key ${other} to finish the rotation.`
      : "Paste it into your app configuration.");
  });
});

function accessCard(c, key) {
  const { icon, heading } = ACCESS_SECTIONS[key];
  const editing = state.editing === key;
  const action = editing || state.editing ? "" : `<calcite-button appearance="transparent" scale="s" icon-start="pencil" data-edit-section="${key}">Edit</calcite-button>`;
  const body = editing ? accessEditor(c, key) : accessView(c, key);
  return card(icon, heading, body, action);
}

function accessView(c, key) {
  const { itemIds, privileges } = splitPrivileges(c.privileges);
  const chips = (list, empty) => list.length
    ? `<div class="chips">${list.map((p) => `<span class="badge neutral">${esc(p)}</span>`).join("")}</div>`
    : `<span class="muted">${empty}</span>`;
  if (key === "privileges") return privilegeGroups(privileges);
  if (key === "referrers") return chips(c.httpReferrers ?? [], "Any origin: the key works from every website");
  if (!itemIds.length) return `<span class="muted">None</span>`;
  return `<div class="groups">${itemGroups(itemIds).map(([group, ids]) => `
    <div class="group">
      <h4><span class="badge ${group.badge}">${group.label}</span> <span class="muted">${ids.length}</span></h4>
      <ul class="plist">${ids.map((id) => {
        const item = itemById(id);
        return item
          ? `<li><calcite-link href="${portalItemUrl(id)}" target="_blank">${esc(item.title)}</calcite-link> <span class="muted">${esc(item.type)}</span></li>`
          : `<li><span class="muted">${esc(id)} · no longer exists</span></li>`;
      }).join("")}</ul>
    </div>`).join("")}</div>`;
}

// Exposed items grouped by data tier, most sensitive first
const ITEM_GROUPS = [
  { key: "restricted", label: "Restricted", badge: "tier-restricted" },
  { key: "premium", label: "Premium", badge: "tier-premium" },
  { key: "open", label: "Open", badge: "tier-open" },
  { key: "", label: "No tier", badge: "neutral" },
  { key: "deleted", label: "Deleted", badge: "warning" },
];
function itemGroups(itemIds) {
  const groupOf = (id) => { const item = itemById(id); return item ? tierOf(item) ?? "" : "deleted"; };
  return ITEM_GROUPS.map((g) => [g, itemIds.filter((id) => groupOf(id) === g.key)]).filter(([, ids]) => ids.length);
}

// The risks the audit cares about, as a badge
const privilegeFlag = (p) => p.startsWith("portal:admin:") ? `<span class="badge danger">Admin</span>`
  : config.globalAccessPrivileges.includes(p) ? `<span class="badge danger">All your items</span>`
  : !config.allowedPrivileges.includes(p) ? `<span class="badge warning">Outside policy</span>` : "";

// Combobox items for every documented privilege (plus any unknown ones already on the key), grouped as in the docs
const privilegeOptions = (selected) => groupPrivileges([...new Set([...ALL_PRIVILEGES, ...selected])])
  .map(([group, list]) => `<calcite-combobox-item-group label="${esc(group)}">
    ${list.map(({ privilege, name }) => `<calcite-combobox-item value="${esc(privilege)}" heading="${esc(name)}" description="${esc(privilege)}" ${selected.includes(privilege) ? "selected" : ""}>
      ${privilegeFlag(privilege) ? `<span slot="content-end">${privilegeFlag(privilege)}</span>` : ""}
    </calcite-combobox-item>`).join("")}
  </calcite-combobox-item-group>`).join("");

// Privileges grouped as in the docs, with readable names and the risks the audit cares about
function privilegeGroups(privileges) {
  if (!privileges.length) return `<span class="muted">None</span>`;
  const flag = privilegeFlag;
  return `<div class="groups">${groupPrivileges(privileges).map(([group, list]) => `
    <div class="group">
      <h4>${esc(group)}</h4>
      <ul class="plist">${list.map(({ privilege, name }) => `
        <li title="${esc(privilege)}">${esc(name)} ${flag(privilege)} <code class="muted">${esc(privilege)}</code></li>`).join("")}</ul>
    </div>`).join("")}</div>`;
}

function accessEditor(c, key) {
  const { itemIds, privileges } = splitPrivileges(c.privileges);
  let field;
  if (key === "privileges") {
    field = `<calcite-combobox id="edit-privileges" selection-mode="multiple" overlay-positioning="fixed" max-items="8" label="Privileges" placeholder="Search privileges">
      ${privilegeOptions(privileges)}
    </calcite-combobox>`;
  } else if (key === "items") {
    const all = dataItems().map((i) => i.id);
    field = `<calcite-combobox id="edit-items" selection-mode="multiple" overlay-positioning="fixed" max-items="8" label="Exposed items" placeholder="Items this key can read">
      ${itemGroups(all).map(([group, ids]) => `<calcite-combobox-item-group label="${group.label}">
        ${ids.map((id) => { const i = itemById(id); return `<calcite-combobox-item value="${esc(id)}" heading="${esc(i.title)}" description="${esc(i.type)}" ${itemIds.includes(id) ? "selected" : ""}></calcite-combobox-item>`; }).join("")}
      </calcite-combobox-item-group>`).join("")}
    </calcite-combobox>`;
  } else {
    field = `<calcite-text-area id="edit-referrers" rows="3" label="Referrers" placeholder="https://my-app.example.com/*">${esc((c.httpReferrers ?? []).join("\n"))}</calcite-text-area>
      <span class="muted">One URL pattern per line. Empty = any website.</span>`;
  }
  return `
    <div class="editor">${field}</div>
    <div class="edit-foot">
      <span class="muted"><calcite-icon icon="information" scale="s" aria-hidden="true"></calcite-icon> Saving issues a new token.</span>
      <calcite-button appearance="outline" scale="s" data-cancel-edit>Cancel</calcite-button>
      <calcite-button scale="s" data-save-section="${key}">Save…</calcite-button>
    </div>`;
}

function oauthCards(c) {
  const editing = state.editing === "redirect-uris";
  const uris = c.redirect_uris ?? [];
  const action = state.editing ? "" : `<calcite-button appearance="transparent" scale="s" icon-start="pencil" data-edit-section="redirect-uris">Edit</calcite-button>`;
  const body = editing
    ? `<div class="editor">
        <calcite-text-area id="edit-redirect-uris" rows="4" label="Redirect URIs" placeholder="https://my-app.example.com/callback">${esc(uris.join("\n"))}</calcite-text-area>
        <span class="muted">One absolute URI per line, including custom app schemes. Empty = no redirect URIs.</span>
        <span id="redirect-uris-error" role="alert" hidden></span>
      </div>
      <div class="edit-foot">
        <span class="muted"><calcite-icon icon="information" scale="s" aria-hidden="true"></calcite-icon> Removing a URI prevents future sign-ins using it.</span>
        <calcite-button appearance="outline" scale="s" data-cancel-edit>Cancel</calcite-button>
        <calcite-button scale="s" data-save-redirects>Save…</calcite-button>
      </div>`
    : uris.length
      ? `<div class="rows redirect-uris">${uris.map((u) => `<code>${esc(u)}</code>`).join("")}</div>`
      : `<span class="muted">No redirect URIs registered</span>`;
  return card("key", "Client ID", `<code>${esc(c.client_id)}</code>`)
    + card("link", "Redirect URIs", body, action);
}

function saveRedirectUris() {
  const c = byId(state.selectedId);
  const field = $("#edit-redirect-uris");
  const uris = [...new Set(splitList(field.value, "\n"))];
  const invalid = uris.find((uri) => {
    try { new URL(uri); return /\s/.test(uri); } catch { return true; }
  });
  field.status = invalid ? "invalid" : "idle";
  const error = $("#redirect-uris-error");
  error.hidden = !invalid;
  if (invalid) {
    error.textContent = `Enter an absolute URI without spaces: ${invalid}`;
    field.setFocus();
    return;
  }
  const current = c.redirect_uris ?? [];
  const added = uris.filter((u) => !current.includes(u));
  const removed = current.filter((u) => !uris.includes(u));
  if (!added.length && !removed.length) {
    state.editing = null;
    return renderDetail();
  }
  state.pendingRedirects = { itemId: c.itemId, redirect_uris: uris };
  // Editing the OAuth app this console signs in with: dropping its callback locks you out
  const lockout = c.client_id === config.clientId && !uris.includes(config.redirectUri);
  $("#redirect-confirm-save").kind = lockout ? "danger" : "brand";
  $("#redirect-confirm-body").innerHTML = `
    <ul class="diff">
      ${added.map((u) => `<li class="add">+ ${esc(u)}</li>`).join("")}
      ${removed.map((u) => `<li class="remove">− ${esc(u)}</li>`).join("")}
    </ul>
    ${lockout ? `<calcite-notice open kind="danger" icon="exclamation-mark-triangle">
      <div slot="title">You will lose access to Credential Console</div>
      <div slot="message">This is the OAuth app Credential Console signs in with, and <code>${esc(config.redirectUri)}</code> would no longer be registered. You won't be able to sign in here again until you add it back in the portal.</div>
    </calcite-notice>` : ""}
    <p>Future sign-ins must use a registered redirect URI.${removed.length ? " Apps using a removed URI will need their sign-in configuration updated." : ""}</p>
    ${!uris.length ? `<p>No redirect URIs will remain registered.</p>` : ""}`;
  $("#redirect-confirm").open = true;
}

$("#redirect-confirm-save").addEventListener("click", (e) => {
  const { itemId, redirect_uris } = state.pendingRedirects;
  run(e.currentTarget, async () => {
    await api.updateRedirectUris(itemId, redirect_uris);
    $("#redirect-confirm").open = false;
    state.editing = null;
  }, "Redirect URIs saved");
});

// Collects the edited section, then asks for confirmation with a diff before revoking anything
function saveSection(key) {
  const c = byId(state.selectedId);
  const current = { ...splitPrivileges(c.privileges), httpReferrers: c.httpReferrers ?? [] };
  const next = { ...current };
  if (key === "privileges") next.privileges = selectedValues("#edit-privileges");
  if (key === "items") next.itemIds = selectedValues("#edit-items");
  if (key === "referrers") next.httpReferrers = splitList($("#edit-referrers").value, "\n");

  const field = { privileges: "privileges", items: "itemIds", referrers: "httpReferrers" }[key];
  const label = (v) => (key === "items" ? itemById(v)?.title ?? v : v);
  const added = next[field].filter((v) => !current[field].includes(v));
  const removed = current[field].filter((v) => !next[field].includes(v));
  if (!added.length && !removed.length) {
    state.editing = null;
    return renderDetail();
  }

  state.pendingAccess = { itemId: c.itemId, ...next };
  const active = tokenSlots(c, state.expirations).filter((t) => c[`apiToken${t.slot}Active`]);
  $("#access-confirm").heading = `Save ${ACCESS_SECTIONS[key].heading.toLowerCase()}?`;
  $("#access-confirm-body").innerHTML = `
    <ul class="diff">
      ${added.map((v) => `<li class="add">+ ${esc(label(v))}</li>`).join("")}
      ${removed.map((v) => `<li class="remove">− ${esc(label(v))}</li>`).join("")}
    </ul>
    <p>${active.length
      ? `${active.map((t) => `Token ${t.slot}`).join(" and ")} will stop working immediately. Apps using ${active.length > 1 ? "them" : "it"} break until you deploy the new token.`
      : "This key has no active token."} A new token is generated in slot 1.</p>`;
  $("#access-confirm-days").value = String(config.defaultValidityDays);
  $("#access-confirm").open = true;
}

$("#access-confirm-save").addEventListener("click", (e) => {
  const { itemId, privileges, itemIds, httpReferrers } = state.pendingAccess;
  const expiration = expirationFromDays(Number($("#access-confirm-days").value) || config.defaultValidityDays);
  run(e.currentTarget, async () => {
    const result = await api.reconfigureKey(byId(itemId), { privileges, itemIds, httpReferrers, expiration });
    $("#access-confirm").open = false;
    state.editing = null;
    showToken(result, "Access updated. Previous tokens are revoked: deploy this new token.");
  });
});

// Fills the privileges and items comboboxes of the create / reconfigure dialogs
function fillAccessFields(prefix, { privileges = ["premium:user:basemaps"], itemIds = [] } = {}) {
  $(`#${prefix}-privileges`).innerHTML = privilegeOptions(privileges);
  $(`#${prefix}-items`).innerHTML = dataItems()
    .map((i) => `<calcite-combobox-item value="${esc(i.id)}" heading="${esc(i.title)}" ${itemIds.includes(i.id) ? "selected" : ""}
       description="${esc(`${i.type} · ${tierOf(i) ?? "no tier"}`)}"></calcite-combobox-item>`).join("");
}

const selectedValues = (sel) => $(sel).selectedItems.map((i) => i.value);

// ---------- events: filters and navigation ----------

$("#search-box").addEventListener("calciteComboboxChange", (e) => {
  const values = e.target.selectedItems.map((item) => item.value);
  const known = new Set(state.creds.flatMap(tagsOf));
  state.tags = values.filter((v) => known.has(v));
  state.terms = values.filter((v) => !known.has(v));
  state.query = "";
  renderTable();
});
$("#search-box").addEventListener("calciteComboboxFilterChange", (e) => {
  state.query = e.target.filterText ?? "";
  renderTable();
});

$("#projects").addEventListener("calciteListChange", (e) => {
  state.filter = e.target.selectedItems[0]?.value ?? "all";
  renderTable();
  closeDetail();
});

$("#table").addEventListener("calciteTableSelect", (e) => {
  state.selection = e.target.selectedItems.map((row) => row.dataset.id).filter(Boolean);
});

$("#reload").addEventListener("click", (e) => run(e.currentTarget, () => {}));

// ---------- navigation: list ⇄ detail, with browser history (#credential/<itemId>) ----------

const detailHash = (id) => `#credential/${encodeURIComponent(id)}`;
const hashId = () => decodeURIComponent(location.hash.match(/^#credential\/(.+)$/)?.[1] ?? "") || null;

function openDetail(id, { push = true } = {}) {
  Object.assign(state, { selectedId: id, renaming: false, editing: null, editingTags: false });
  renderDetail();
  $(".content").scrollTop = 0;
  if (push && location.hash !== detailHash(id)) history.pushState({ detail: id }, "", detailHash(id));
}

function closeDetail({ push = true } = {}) {
  if (!state.selectedId) return;
  Object.assign(state, { selectedId: null, renaming: false, editing: null, editingTags: false });
  renderDetail();
  if (!push || !hashId()) return;
  // Opened from the list: going back keeps history tidy. Opened from a link: just drop the hash.
  if (history.state?.detail) history.back();
  else history.replaceState(null, "", location.pathname + location.search);
}

// Browser back / forward
window.addEventListener("popstate", () => {
  const id = hashId();
  id && byId(id) ? openDetail(id, { push: false }) : closeDetail({ push: false });
});

document.addEventListener("click", (e) => {
  const target = (sel) => e.target.closest(sel);

  if (target("[data-kpi]")) {
    const kpi = target("[data-kpi]").dataset.kpi;
    state.kpi = state.kpi === kpi ? null : kpi;
    // KPI counts cover every credential, so the list shows all projects too
    if (state.kpi) state.filter = "all";
    renderProjects();
    renderSummary();
    renderTable();
  }
  if (target("[data-clear-filters]")) {
    Object.assign(state, { kpi: null, tags: [], terms: [], query: "" });
    renderTags();
    renderSummary();
    renderTable();
  }
  // Any click on a row opens it, except on the selection checkbox (inside the row's shadow DOM, so no light-DOM cell)
  // and on links or buttons of its own
  const row = target("calcite-table-row[data-id]");
  const opener = target("[data-open]")
    ?? (row && target("calcite-table-cell") && !target("a, calcite-button, calcite-link") ? row : null);
  if (opener) {
    e.preventDefault();
    openDetail(opener.dataset.open ?? opener.dataset.id);
  }
  if (target("[data-back]")) closeDetail();
  if (target("[data-edit-tags]")) {
    state.editingTags = true;
    renderDetail();
  }
  if (target("[data-done-tags]")) {
    // Saves whatever is still pending (e.g. typed while the dropdown was open), then back to the chips
    state.editingTags = false;
    const box = $("#detail-tags-box");
    const before = box.tagPicker.committed;
    commitTagPicker(box);
    if (box.tagPicker.committed === before) renderDetail();
  }
  if (target("[data-edit-section]")) {
    state.editing = target("[data-edit-section]").dataset.editSection;
    renderDetail();
  }
  if (target("[data-cancel-edit]")) {
    state.editing = null;
    renderDetail();
  }
  if (target("[data-save-section]")) saveSection(target("[data-save-section]").dataset.saveSection);
  if (target("[data-save-redirects]")) saveRedirectUris();
  if (target("[data-save-owner]")) saveOwner();
  if (target("[data-save-notes]")) saveNotes();
  if (target("[data-rename]")) {
    state.renaming = true;
    renderDetail();
  }
  if (target("[data-close]")) target("[data-close]").closest("calcite-dialog").open = false;
  if (target("[data-edit-project]")) openProjectEditor(target("[data-edit-project]").dataset.editProject);
  if (target("[data-batch]")) openBatch(target("[data-batch]").dataset.batch);

  const invalidate = target("[data-invalidate]");
  if (invalidate) {
    const slot = Number(invalidate.dataset.invalidate);
    if (!confirm(`Invalidate API key ${slot}? Apps using it will stop working immediately.`)) return;
    run(invalidate, () => api.invalidateSlot(state.selectedId, slot), `API key ${slot} invalidated`);
  }

  const slotAction = target("[data-slot-action]");
  if (slotAction) openSlotDialog(Number(slotAction.dataset.slot), slotAction.dataset.slotAction);

  const toggle = target("[data-toggle-partial]");
  if (toggle) {
    const key = toggle.dataset.togglePartial;
    state.revealed.has(key) ? state.revealed.delete(key) : state.revealed.add(key);
    renderDetail();
  }
});

document.addEventListener("calciteCheckboxChange", (e) => {
  const groupId = e.target.dataset.project;
  if (!groupId) return;
  const action = e.target.checked ? api.addToProject : api.removeFromProject;
  run(null, () => action(state.selectedId, groupId), e.target.checked ? "Added to project" : "Removed from project");
});

// ---------- events: projects ----------

$("#new-project").addEventListener("click", () => {
  $("#project-title").value = "";
  $("#project-dialog").open = true;
});

$("#project-create").addEventListener("click", (e) => {
  const title = $("#project-title").value.trim();
  if (!title) return;
  run(e.currentTarget, async () => {
    const group = await api.createProject(title);
    state.projectPatches[group.id] = { at: Date.now(), created: true, title };
    $("#project-dialog").open = false;
  }, `Project "${title}" created`);
});

function openProjectEditor(id) {
  const p = state.projects.find((p) => p.id === id);
  state.editingProjectId = id;
  $("#project-edit-title").value = p.title;
  $("#project-edit-snippet").value = p.snippet ?? "";
  $("#project-edit-notes").value = htmlToText(p.description);
  $("#project-edit-logo").value = "";
  const preview = $("#project-edit-preview");
  // Check the value, not preview.src: an empty src resolves to the page URL
  const logo = state.logos[logoKey(p)];
  if (logo) preview.src = logo;
  else preview.removeAttribute("src");
  preview.hidden = !logo;
  $("#project-edit-portal").href = portalGroupUrl(id);
  $("#project-edit-dialog").open = true;
}

$("#project-edit-logo").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const preview = $("#project-edit-preview");
  preview.hidden = !file;
  if (file) preview.src = URL.createObjectURL(file);
});

$("#project-edit-save").addEventListener("click", (e) => {
  const project = {
    id: state.editingProjectId,
    title: $("#project-edit-title").value.trim(),
    snippet: $("#project-edit-snippet").value.trim(),
    description: textToHtml($("#project-edit-notes").value),
    logo: $("#project-edit-logo").files[0],
  };
  run(e.currentTarget, async () => {
    await api.updateProject(project);
    state.projectPatches[project.id] = { ...state.projectPatches[project.id], at: Date.now(), title: project.title, snippet: project.snippet, description: project.description };
    // New logo: forget the cached image so it is downloaded again
    if (project.logo) Object.keys(state.logos).filter((k) => k.startsWith(`${project.id}/`)).forEach((k) => delete state.logos[k]);
    $("#project-edit-dialog").open = false;
  }, `Project "${project.title}" updated`);
});

$("#project-edit-delete").addEventListener("click", (e) => {
  const p = state.projects.find((p) => p.id === state.editingProjectId);
  if (!confirm(`Delete project "${p.title}"? Its credentials are not deleted, only unassigned.`)) return;
  run(e.currentTarget, async () => {
    await api.deleteProject(p.id);
    state.projectPatches[p.id] = { at: Date.now(), deleted: true };
    if (state.filter === p.id) state.filter = "all";
    $("#project-edit-dialog").open = false;
  }, `Project "${p.title}" deleted`);
});

// ---------- events: edit a credential ----------

// ---------- events: batch operations ----------

const BATCH = {
  revoke: { heading: "Revoke all tokens", button: "Revoke", kind: "danger", run: (c) => api.revokeAllTokens(c) },
  move: { heading: "Move to project", button: "Move", kind: "brand", run: (c, groupId) => moveToProject(c, groupId) },
  tag: { heading: "Add tags", button: "Add tags", kind: "brand", run: (c, tags) => api.updateCredentialItem(c.itemId, { title: c.item.title, tags: [...new Set([...(c.item.tags ?? []), ...tags])] }) },
  delete: { heading: "Delete credentials", button: "Delete", kind: "danger", run: (c) => api.deleteCredential(c.itemId) },
};

async function moveToProject(cred, groupId) {
  for (const p of projectsOf(cred.itemId)) if (p.id !== groupId) await api.removeFromProject(cred.itemId, p.id);
  if (!projectsOf(cred.itemId).some((p) => p.id === groupId)) await api.addToProject(cred.itemId, groupId);
}

function openBatch(mode) {
  const creds = state.selection.map(byId).filter(Boolean);
  if (!creds.length) return notify("danger", "Select at least one credential");
  const { heading, button, kind } = BATCH[mode];
  state.batchMode = mode;
  const list = `<ul>${creds.map((c) => `<li>${esc(c.item.title)}</li>`).join("")}</ul>`;
  const fields = {
    revoke: `<calcite-notice open kind="danger" icon="exclamation-mark-triangle"><div slot="message">Every active token of these credentials stops working immediately.</div></calcite-notice>`,
    move: `<calcite-label>Project<calcite-select id="batch-project">${state.projects.map((p) => `<calcite-option value="${esc(p.id)}">${esc(p.title)}</calcite-option>`).join("")}</calcite-select></calcite-label>`,
    tag: `<calcite-label>Tags<div id="batch-tags-box" class="tag-picker"></div></calcite-label>`,
    delete: `<calcite-notice open kind="danger" icon="trash"><div slot="message">Credentials are unregistered and their items deleted. This cannot be undone.</div></calcite-notice>`,
  }[mode];
  $("#batch-dialog").heading = `${heading} (${creds.length})`;
  Object.assign($("#batch-confirm"), { kind, textContent: button });
  $("#batch-body").innerHTML = `${fields}<p class="muted">Applies to:</p>${list}`;
  if (mode === "tag") renderTagPicker($("#batch-tags-box"));
  $("#batch-dialog").open = true;
}

$("#batch-confirm").addEventListener("click", (e) => {
  const mode = state.batchMode;
  const arg = { move: () => $("#batch-project").value, tag: () => tagPickerValues($("#batch-tags-box")) }[mode]?.();
  if ((mode === "move" && !arg) || (mode === "tag" && !arg.length)) return;
  const creds = state.selection.map(byId).filter(Boolean);
  run(e.currentTarget, async () => {
    const results = await api.batch(creds, (c) => BATCH[mode].run(c, arg));
    $("#batch-dialog").open = false;
    state.selection = [];
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) return notify("success", `${BATCH[mode].heading}: ${results.length} of ${results.length} done`);
    notify(failed.length === results.length ? "danger" : "warning",
      `${results.length - failed.length} of ${results.length} done. Failed: ${failed.map((r) => `${r.cred.item.title} (${r.error?.message})`).join("; ")}`);
  });
});

// ---------- events: new API key ----------

$("#new-key").addEventListener("click", () => {
  $("#key-title").value = "";
  renderTagPicker($("#key-tags-box"), state.tags);
  $("#key-referrers").value = "";
  $("#key-days").value = String(config.defaultValidityDays);
  $("#key-project").innerHTML = `<calcite-option value="">No project</calcite-option>` +
    state.projects.map((p) => `<calcite-option value="${esc(p.id)}" ${p.id === state.filter ? "selected" : ""}>${esc(p.title)}</calcite-option>`).join("");
  fillAccessFields("key");
  $("#key-dialog").open = true;
});

$("#key-create").addEventListener("click", (e) => {
  const title = $("#key-title").value.trim();
  if (!title) return notify("danger", "Give the API key a title");
  const options = {
    title,
    groupId: $("#key-project").value || undefined,
    tags: tagPickerValues($("#key-tags-box")),
    privileges: selectedValues("#key-privileges"),
    itemIds: selectedValues("#key-items"),
    httpReferrers: splitList($("#key-referrers").value, "\n"),
    expiration: expirationFromDays(Number($("#key-days").value) || config.defaultValidityDays),
  };
  run(e.currentTarget, async () => {
    const result = await api.createKey(options);
    $("#key-dialog").open = false;
    state.selectedId = result.itemId;
    showToken(result, `API key "${title}" created with a token in slot 1.`);
  });
});

function expirationFromDays(days) {
  const date = new Date(Date.now() + days * DAY);
  date.setHours(23, 59, 59, 999);
  return date;
}

// ---------- freshly generated token + viewer ----------

function showToken(result, message) {
  state.lastToken = result.token;
  $("#token-dialog").heading = `New API key ${result.slot}`;
  $("#token-info").textContent = message;
  $("#token-value").textContent = result.token;
  setTokenHidden(false);
  Object.assign($("#token-copy"), { iconStart: "copy", textContent: "Copy" });
  $("#token-dialog").open = true;
}

// Blur toggle, handy when presenting on a shared screen
function setTokenHidden(hidden) {
  $("#token-value").classList.toggle("hidden", hidden);
  Object.assign($("#token-toggle"), { icon: hidden ? "view-visible" : "view-hide", text: hidden ? "Show" : "Hide" });
}
$("#token-toggle").addEventListener("click", () => setTokenHidden(!$("#token-value").classList.contains("hidden")));

$("#token-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.lastToken);
  Object.assign($("#token-copy"), { iconStart: "check", textContent: "Copied" });
});

// The token reaches the viewer via postMessage (in memory): it never lands in the URL or the history
let viewer;
let pendingToken;
$("#token-viewer").addEventListener("click", () => {
  pendingToken = state.lastToken;
  viewer = window.open(`viewer.html${MOCK ? "?mock" : ""}`, "customer-viewer");
});

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.source !== viewer || e.data?.type !== "viewer-ready" || !pendingToken) return;
  viewer.postMessage({ type: "api-key", token: pendingToken }, location.origin);
  pendingToken = undefined;
});

// Start once the whole module is defined
boot();
