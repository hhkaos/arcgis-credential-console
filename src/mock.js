// Fake implementation of api.js with in-memory data. Enabled with ?mock in the URL.
// Lets you try the UI without an account. Valid tokens are shared with viewer.html via localStorage.
const DAY = 86_400_000;
const now = Date.now();
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const id = () => Math.random().toString(16).slice(2, 10).padEnd(32, "0");
const fakeToken = (slot) => `AAPTxy8BH1VEsoebNVZXo8HurEOF051kAEKlHkHBaNT${id()}${slot}AT${slot}_${id().slice(0, 8)}`;
const access = (itemId) => `portal:app:access:item:${itemId}`;
const clientId = () => Array.from({ length: 16 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

const user = { username: "geodata_provider", fullName: "GeoData Provider GmbH", description: "", portalHome: "https://example.maps.arcgis.com" };

const dataItems = [
  { id: "d-buildings", title: "Buildings & Land Use (vector tiles)", type: "Vector Tile Service", tags: ["tier:open"] },
  { id: "d-mobility", title: "Transport & Mobility Network", type: "Feature Service", tags: ["tier:premium"] },
  { id: "d-furniture", title: "Street Furniture", type: "Feature Service", tags: ["tier:open"] },
  { id: "d-webmap", title: "Building Inspections (field view)", type: "Feature Service", tags: ["tier:restricted"] },
];

const projects = [
  { id: "g-city", title: "Mainhausen Urban Planning Office", itemIds: ["k-city", "k-rot"],
    description: "Customer contact: Dr. Jana Weber, GIS lead (gis@mainhausen.example)<br>Account manager: Tom Becker<br>Framework contract until 31 Dec 2027" },
  { id: "g-logi", title: "Velora Micromobility", itemIds: ["k-logi", "o-portal"],
    description: "Trial customer. Account manager: Lena Hoffmann (sales@geodata.example)<br>CRM: https://crm.example/accounts/velora" },
];

const creds = [
  apiKey("k-city", "Mainhausen · Land-use viewer (prod)", {
    tags: ["env:prod", "customer:mainhausen"],
    privileges: ["premium:user:basemaps", "premium:user:geocode:temporary", access("d-mobility"), access("d-buildings")],
    httpReferrers: ["https://maps.frankfurt.example/*"],
    slots: { 1: now + 200 * DAY },
    snippet: "Public land-use viewer on the city's planning portal",
    description: "Referrers limited to the planning portal domain.<br>Renewal agreed with the customer every May.",
    owner: { owner: "Web team · Mainhausen", contact: "web-team@mainhausen.example", deployedIn: "mainhausen/landuse-viewer · VITE_ARCGIS_KEY", link: "https://crm.example/opportunities/1042" },
  }),
  apiKey("k-logi", "Velora · Mobility data trial (14 days)", {
    tags: ["env:trial", "customer:velora"],
    privileges: ["premium:user:basemaps", "premium:user:networkanalysis:routing", access("d-mobility")],
    httpReferrers: [],
    slots: { 1: now + 6 * DAY },
  }),
  apiKey("k-rot", "Mainhausen · Field inspections app (prod)", {
    tags: ["env:prod", "customer:mainhausen"],
    privileges: ["premium:user:basemaps", access("d-webmap")],
    httpReferrers: [],
    slots: { 1: now + 3 * DAY, 2: now + 90 * DAY },
    snippet: "Inspectors' tablet app (Android), production build",
  }),
  apiKey("k-admin", "Ops · Automation master key", {
    tags: ["env:internal", "team:ops", "status:legacy"],
    privileges: ["portal:admin:viewItems", "portal:admin:updateItems", "features:user:edit", access("d-deleted")],
    httpReferrers: [],
    slots: { 1: now - 10 * DAY },
  }),
  apiKey("k-unused", "Sales · Generic basemap demo key", { tags: ["env:internal", "team:sales", "status:legacy"], privileges: ["premium:user:places"], httpReferrers: [], slots: {} }),
  oauthApp("o-manager", "Credential Console (localhost)", ["http://localhost:3000/callback.html"], ["env:internal", "team:ops"]),
  oauthApp("o-portal", "Customer portal (staging)", ["http://staging.example.com/callback"], ["env:staging", "team:data"]),
];

let expirations = creds.flatMap((c) =>
  Object.entries(c._slots ?? {}).map(([slot, expirationDate]) => ({
    itemId: c.itemId, apiToken: Number(slot), expirationDate, title: c.item.title, owner: user.username,
  }))
);

function apiKey(itemId, title, { tags = [], privileges, httpReferrers, slots, snippet = "", description = "", owner }) {
  return {
    kind: "apiKey", itemId, client_id: clientId(), privileges, httpReferrers,
    apiToken1Active: 1 in slots, apiToken2Active: 2 in slots,
    registered: new Date(now - 120 * DAY), modified: new Date(now - 5 * DAY),
    item: {
      id: itemId, title, tags, snippet, description, access: "private", type: "Application", owner: user.username,
      typeKeywords: ["Application", "Registered App", "APIToken"], properties: owner ? { credentialManager: owner } : null,
    },
    _slots: slots,
  };
}

function oauthApp(itemId, title, redirect_uris, tags = []) {
  return {
    kind: "oauth", itemId, client_id: clientId(), redirect_uris,
    registered: new Date(now - 300 * DAY), modified: new Date(now - 30 * DAY),
    item: { id: itemId, title, tags, snippet: "", description: "", access: "private", type: "Application", owner: user.username, typeKeywords: ["Application", "Registered App"] },
  };
}

// --- valid tokens shared with viewer.html ---
const VALID = "mock-valid-tokens";
const readValid = () => { try { return JSON.parse(localStorage.getItem(VALID)) ?? {}; } catch { return {}; } };
const writeValid = (v) => { try { localStorage.setItem(VALID, JSON.stringify(v)); } catch {} };
function issue(itemId, slot) {
  const token = fakeToken(slot);
  writeValid({ ...readValid(), [`${itemId}:${slot}`]: token });
  return token;
}
function revoke(itemId, slot) {
  const valid = readValid();
  delete valid[`${itemId}:${slot}`];
  writeValid(valid);
}

// --- same interface as api.js ---
export async function restoreSession() { await wait(); return user; }
export async function signIn() { await wait(); return user; }
export async function signOut() {}
export async function loadProfile() { return user; }
export async function loadItems() { await wait(); return structuredClone([...dataItems, ...creds.map((c) => c.item)]); }
export async function loadCredentials() { await wait(); return structuredClone(creds); }
export async function loadTokenExpirations() { return structuredClone(expirations); }
export async function loadUserTags() {
  const counts = {};
  [...dataItems, ...creds.map((c) => c.item)].flatMap((i) => i.tags ?? []).forEach((t) => (counts[t] = (counts[t] ?? 0) + 1));
  // Like ArcGIS: some items carry an empty tag
  return [...Object.entries(counts).map(([tag, count]) => ({ tag, count })), { tag: "", count: 7 }];
}
export async function loadProjects() { await wait(); return structuredClone(projects); }
export const itemAccessPrivilege = access;

export async function createProject(title) {
  await wait();
  const group = { id: `g-${id()}`, title, itemIds: [] };
  projects.push(group);
  return group;
}

export async function addToProject(itemId, groupId) {
  await wait();
  const p = projects.find((p) => p.id === groupId);
  if (!p.itemIds.includes(itemId)) p.itemIds.push(itemId);
}

export async function removeFromProject(itemId, groupId) {
  await wait();
  const p = projects.find((p) => p.id === groupId);
  p.itemIds = p.itemIds.filter((i) => i !== itemId);
}

export async function createKey({ title, tags, privileges, itemIds, httpReferrers, expiration, groupId }) {
  await wait(500);
  const itemId = `k-${id()}`;
  creds.push(apiKey(itemId, title, {
    tags, privileges: [...privileges, ...itemIds.map(access)], httpReferrers, slots: { 1: expiration.getTime() },
  }));
  expirations.push({ itemId, apiToken: 1, expirationDate: expiration.getTime() });
  if (groupId) await addToProject(itemId, groupId);
  return { itemId, slot: 1, token: issue(itemId, 1) };
}

export async function generateToken(key, slot, expiration) {
  await wait(500);
  creds.find((c) => c.itemId === key.itemId)[`apiToken${slot}Active`] = true;
  expirations = expirations.filter((e) => !(e.itemId === key.itemId && e.apiToken === slot));
  expirations.push({ itemId: key.itemId, apiToken: slot, expirationDate: expiration.getTime() });
  return { itemId: key.itemId, slot, token: issue(key.itemId, slot) };
}

export async function invalidateSlot(itemId, slot) {
  await wait(400);
  creds.find((c) => c.itemId === itemId)[`apiToken${slot}Active`] = false;
  expirations = expirations.filter((e) => !(e.itemId === itemId && e.apiToken === slot));
  revoke(itemId, slot);
  return { success: true };
}

export async function updateCredentialItem(itemId, fields) {
  await wait();
  Object.assign(creds.find((c) => c.itemId === itemId).item, fields);
}

export async function updateRedirectUris(itemId, redirect_uris) {
  await wait();
  const c = creds.find((c) => c.itemId === itemId);
  c.redirect_uris = [...redirect_uris];
  c.modified = new Date();
  return structuredClone(c);
}

export async function deleteCredential(itemId) {
  await wait();
  creds.splice(creds.findIndex((c) => c.itemId === itemId), 1);
  projects.forEach((p) => (p.itemIds = p.itemIds.filter((i) => i !== itemId)));
}

export async function updateProject({ id, title, snippet, description }) {
  await wait();
  Object.assign(projects.find((p) => p.id === id), { title, snippet, description });
}

export async function deleteProject(id) {
  await wait();
  projects.splice(projects.findIndex((p) => p.id === id), 1);
}

export async function loadProjectLogo() { return null; }

export async function reconfigureKey(key, { privileges, itemIds, httpReferrers, expiration }) {
  await wait(500);
  const c = creds.find((c) => c.itemId === key.itemId);
  Object.assign(c, { privileges: [...privileges, ...itemIds.map(access)], httpReferrers, apiToken1Active: true, apiToken2Active: false });
  [1, 2].forEach((slot) => revoke(key.itemId, slot));
  expirations = expirations.filter((e) => e.itemId !== key.itemId);
  expirations.push({ itemId: key.itemId, apiToken: 1, expirationDate: expiration.getTime() });
  return { itemId: key.itemId, slot: 1, token: issue(key.itemId, 1) };
}

export async function batch(list, operation) {
  const results = await Promise.allSettled(list.map(operation));
  return results.map((result, i) => ({ cred: list[i], ok: result.status === "fulfilled", error: result.reason }));
}

export async function revokeAllTokens(cred) {
  for (const slot of [1, 2]) if (cred[`apiToken${slot}Active`]) await invalidateSlot(cred.itemId, slot);
}
