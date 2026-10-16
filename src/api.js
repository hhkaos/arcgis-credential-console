// Every ArcGIS REST JS call in the demo lives here. This is the file shown during the talk.
import { ArcGISIdentityManager, request } from "@esri/arcgis-rest-request";
import {
  getSelf,
  searchItems,
  updateItem,
  removeItem,
  searchGroups,
  createGroup,
  updateGroup,
  removeGroup,
  getGroupContent,
  getUserTags,
  shareItemWithGroup,
  unshareItemWithGroup,
  SearchQueryBuilder,
} from "@esri/arcgis-rest-portal";
import {
  getApiKey,
  getOAuthApp,
  createApiKey,
  updateApiKey,
  invalidateApiKey,
  unregisterApp,
} from "@esri/arcgis-rest-developer-credentials";
import config from "../config.js";

const SESSION_KEY = "credential-console-session";
const DAY = 86_400_000;
let authentication;
let username;

// ---------- 1. Authentication ----------

export async function restoreSession() {
  const saved = readStorage(SESSION_KEY);
  if (!saved) return null;
  authentication = ArcGISIdentityManager.deserialize(saved);
  return loadProfile();
}

export async function signIn() {
  authentication = await ArcGISIdentityManager.beginOAuth2({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    portal: config.portal,
    popup: true,
  });
  writeStorage(SESSION_KEY, authentication.serialize());
  return loadProfile();
}

export async function signOut() {
  writeStorage(SESSION_KEY, null);
  await authentication?.signOut().catch(() => {});
  authentication = undefined;
}

// ---------- 2. User ----------

export async function loadProfile() {
  const portal = await getSelf({ authentication });
  username = portal.user.username;
  // The organization's own portal URL, used to link to items and groups
  const portalHome = `https://${portal.urlKey}.${portal.customBaseUrl}`;
  return { ...portal.user, portalHome };
}

// ---------- 3. Items ----------

// Every item the user owns (all pages)
export async function loadItems() {
  const q = new SearchQueryBuilder().match(username).in("owner");
  let page = await searchItems({ q, num: 100, authentication });
  const items = [...page.results];
  while (page.nextPage) {
    page = await page.nextPage();
    items.push(...page.results);
  }
  return items;
}

// Every tag the user has used on any item, with how many items carry it (feeds the tag autocomplete)
export async function loadUserTags() {
  const { tags } = await getUserTags({ username, authentication });
  return tags; // [{ tag, count }]
}

// Title, summary (snippet), notes (description), tags and properties are item fields:
// changing them never touches the tokens. Only the fields passed are updated.
// `properties` is a free JSON object on the item; REST JS serializes it for us.
export const updateCredentialItem = (itemId, fields) =>
  updateItem({ item: { id: itemId, ...fields }, authentication });

// ---------- 4. Developer credentials ----------

// Credentials are "Application" items with the "Registered App" keyword.
// API keys also carry the "APIToken" keyword; OAuth apps don't.
// The search index is eventually consistent: a credential deleted seconds ago can still
// show up in the results, so one failed lookup must not break the whole list (allSettled).
export async function loadCredentials(items) {
  const apps = items.filter((i) => i.type === "Application" && i.typeKeywords.includes("Registered App"));
  const results = await Promise.allSettled(
    apps.map(async (item) => {
      if (item.typeKeywords.includes("APIToken")) {
        const key = await getApiKey({ itemId: item.id, authentication });
        return { kind: "apiKey", ...key };
      }
      const app = await getOAuthApp({ itemId: item.id, authentication });
      return { kind: "oauth", ...app };
    })
  );
  return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
}

// Expiration of every token (slot 1 and 2). No REST JS function for it → request() with the same session.
export async function loadTokenExpirations() {
  const { items = [] } = await request(`${config.portal}/portals/self/apiTokens`, {
    authentication,
    params: {
      num: 100,
      startExpirationDate: new Date(Date.now() - 365 * DAY),
      endExpirationDate: new Date(Date.now() + 400 * DAY),
    },
  });
  return items; // [{ itemId, apiToken: 1 | 2, expirationDate, title, owner, ... }]
}

// There is no deleteApiKey(): unregister the app, then remove its item
export async function deleteCredential(itemId) {
  await unregisterApp({ itemId, authentication });
  await removeItem({ id: itemId, authentication });
}

// ---------- 5. Projects (groups) ----------

export async function loadProjects() {
  const { results } = await searchGroups({
    q: `tags:${config.projectTag} AND owner:${username}`,
    num: 100,
    authentication,
  });
  return Promise.all(
    results.map(async (group) => {
      const { items } = await getGroupContent(group.id, {
        paging: { start: 1, num: 100 },
        authentication,
      });
      const { id, title, snippet, description, thumbnail } = group;
      return { id, title, snippet, description, thumbnail, itemIds: items.map((i) => i.id) };
    })
  );
}

export async function createProject(title) {
  const { group } = await createGroup({
    group: { title, tags: [config.projectTag], access: "private" },
    authentication,
  });
  return group;
}

// The logo is the group thumbnail: a file upload, sent as multipart by REST JS
export const updateProject = ({ id, title, snippet, description, logo }) =>
  updateGroup({ group: { id, title, snippet, description }, params: logo ? { thumbnail: logo } : {}, authentication });

export const deleteProject = (id) => removeGroup({ id, authentication });

// Private group → the thumbnail needs a token. Send it in a header, never in the <img> URL.
export async function loadProjectLogo({ id, thumbnail }) {
  if (!thumbnail) return null;
  const token = await authentication.getToken(config.portal);
  const response = await fetch(`${config.portal}/community/groups/${id}/info/${thumbnail}`, {
    headers: { "X-Esri-Authorization": `Bearer ${token}` },
  });
  return response.ok ? URL.createObjectURL(await response.blob()) : null;
}

export const addToProject = (itemId, groupId) =>
  shareItemWithGroup({ id: itemId, groupId, authentication });

export const removeFromProject = (itemId, groupId) =>
  unshareItemWithGroup({ id: itemId, groupId, authentication });

// ---------- 6. API key lifecycle ----------

// Item access is just another privilege: "portal:app:access:item:<itemId>"
export const itemAccessPrivilege = (itemId) => `portal:app:access:item:${itemId}`;

export async function createKey({ title, tags, privileges, itemIds, httpReferrers, expiration, groupId }) {
  const key = await createApiKey({
    title,
    tags,
    privileges: [...privileges, ...itemIds.map(itemAccessPrivilege)],
    httpReferrers,
    generateToken1: true,
    apiToken1ExpirationDate: expiration,
    authentication,
  });
  if (groupId) await addToProject(key.itemId, groupId);
  return { itemId: key.itemId, slot: 1, token: key.accessToken1 };
}

// Generates a new token in slot 1 or 2. If the slot already had a token, that token stops working.
// Zero-downtime rotation = generate in the free slot, update the app, then invalidateSlot() the old one.
export async function generateToken(key, slot, expiration) {
  const result = await updateApiKey({
    itemId: key.itemId,
    generateToken1: slot === 1,
    generateToken2: slot === 2,
    apiToken1ExpirationDate: slot === 1 ? expiration : undefined,
    apiToken2ExpirationDate: slot === 2 ? expiration : undefined,
    authentication,
  });
  return { itemId: key.itemId, slot, token: slot === 1 ? result.accessToken1 : result.accessToken2 };
}

// Changing privileges, item access or referrers invalidates BOTH tokens,
// so we save the new access and issue a fresh token in slot 1 in the same call.
export async function reconfigureKey(key, { privileges, itemIds, httpReferrers, expiration }) {
  const result = await updateApiKey({
    itemId: key.itemId,
    privileges: [...privileges, ...itemIds.map(itemAccessPrivilege)],
    httpReferrers,
    generateToken1: true,
    apiToken1ExpirationDate: expiration,
    authentication,
  });
  return { itemId: key.itemId, slot: 1, token: result.accessToken1 };
}

// Revoke one token (slot 1 or 2). Takes effect in about a second.
export const invalidateSlot = (itemId, slot) =>
  invalidateApiKey({ itemId, apiKey: slot, authentication });

// ---------- 7. Batch operations ----------

// Runs one operation per credential in parallel. A failure never stops the rest:
// Promise.allSettled tells us which ones worked and which ones didn't.
export async function batch(creds, operation) {
  const results = await Promise.allSettled(creds.map(operation));
  return results.map((result, i) => ({ cred: creds[i], ok: result.status === "fulfilled", error: result.reason }));
}

export async function revokeAllTokens(cred) {
  for (const slot of [1, 2]) {
    if (cred[`apiToken${slot}Active`]) await invalidateSlot(cred.itemId, slot);
  }
}

// ---------- util ----------

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* no storage: the session is not remembered */ }
}
