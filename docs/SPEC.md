# Credential Console for ArcGIS Location Platform

**A developer credentials dashboard built with ArcGIS REST JS.**
Audit, rotate and revoke API keys and OAuth apps, see what data each one exposes, and organize them by customer, with an owner to call when something expires.

> Status: v5, working prototype (real account and `?mock`) · Date: 2026-10-16
> Talk materials and demo script: [working-with-arcgis-rest-js-dtseu-2026](https://github.com/EsriDevEvents/working-with-arcgis-rest-js-dtseu-2026)

## Context

Credential Console was built as the **sample app for the session *Working with ArcGIS REST JS*** (Esri Developer Summit Europe, 20 October 2026). The session shows how ArcGIS REST JS lets you build tools tailored to your own workflow on top of ArcGIS. Developer credentials are a good example: the portal manages each credential from its item page and the Location Platform dashboard reports usage, while this app adds a view organized around one specific workflow (a data provider managing many customer keys), built with ArcGIS REST JS alone, in the browser.

> **Not production-ready as is.** This is an illustrative, unofficial sample, not an Esri product and not supported by Esri. It has no backend, keeps the user session in the browser's `localStorage`, has no automated tests, and works around some Calcite 5.1.2 issues (see §10). Use it as a starting point or as inspiration if you have a similar need: review security, error handling and scale (it loads every credential at once) before relying on it.

## 1. Goal

A web app to **audit, rotate and revoke developer credentials** (API keys and OAuth apps) of an **ArcGIS Location Platform** account, and to organize them by customer or project.

- **Need:** with dozens of keys, a data provider wants cross-cutting answers in one place: what expires this month and who to call, what data each key exposes, which keys belong to which customer, how to rotate without downtime, which keys have admin privileges or access to every item.
- **Target user:** a **data provider** that hosts its layers on Location Platform and gives its customers access through API keys scoped to specific items. On Location Platform *the third party is not a user, it is a credential*.
- **Technical scope:** everything runs in the browser with **ArcGIS REST JS**. It works with credentials, items, groups and the signed-in user.
- The app (UI, copy, code and comments) is in **English**.

## 2. Constraints

- No build step: `index.html` + ES modules + `config.js`. Served by any static server (port 3000, because of the redirect URI).
- REST JS logic is isolated in `src/api.js`, in short (≤ ~20 lines), commented functions.
- Calcite Components **5.1.2** and ArcGIS REST JS **4.11.0** from a CDN.
  - jsdelivr resolves `developer-credentials@4.11.0` with `request@4.10.3`; the import map remaps it to 4.11.0 so there is a single copy of `ArcGISIdentityManager`.
- No users from other organizations and no cross-organization sharing ("Cross-organization group sharing is not supported", [Location Platform help](https://location.arcgis.com/help/data-sharing-and-access/)). Internal groups only.
- No backend.
- `?mock` in the URL loads `src/mock.js` (same interface as `api.js`, fake data) to work without an account.

## 3. Data model

| Concept | Implementation |
|---|---|
| Credential | `type: "Application"` item with the `Registered App` typeKeyword. All of them have `appType: "multiple"` |
| API key vs OAuth app | API keys carry the **`APIToken`** typeKeyword; OAuth apps don't |
| Tokens | Two slots. `apiToken1Active` / `apiToken2Active` in `getApiKey` |
| Expiration | `getApiKey().item.apiToken{1,2}ExpirationDate` (`-1` = no date), and in bulk from `portals/self/apiTokens`. **Not** returned by `searchItems` |
| Partial API key | **Computed**: `AT<slot>_` + last 8 characters of the `client_id` (same approach as [arcgis-api-key-manager-toolkit](https://github.com/hhkaos/arcgis-api-key-manager-toolkit)). Both slots share the suffix |
| Item access | Just another privilege: **`portal:app:access:item:<itemId>`** (max. 100 items) |
| Privileges | Readable names and sections (Location services, Personal ·…, Admin ·…) in `src/privileges.js`, from the [privileges reference](https://developers.arcgis.com/documentation/security-and-authentication/reference/privileges/location-platform/) |
| Project / customer | Private group tagged `project`; credentials are shared with it. `snippet` = summary, `description` = contacts and notes |
| Data tier | `tier:open` / `tier:premium` / `tier:restricted` tag on each data item (set by the seed) |
| Credential tags | `family:value` taxonomy: `env:` (prod/staging/trial/internal), `customer:`, `team:`, `status:legacy`, `review:`. `cm-seed` marks what the seed created (hidden). Empty tags (`""`) are ignored |
| Credential summary | `item.snippet` (≤ 250 characters) |
| Credential notes | `item.description` (HTML in ArcGIS; the app edits it as plain text) |
| Owner | `item.properties.credentialManager = { owner, contact, deployedIn, link }`. Other keys in `properties` are preserved |

## 4. Verified behavior (test account, 2026-10-16)

| Test | Result |
|---|---|
| Token with access to an item → that item | OK |
| Same token → an item not included | `GWM_0003` no permission |
| `updateApiKey({ generateToken2 })` with a user session | Token 2 created; token 1 keeps working |
| `invalidateApiKey({ apiKey: 1 })` | Token 1 returns `498 Invalid token` within ≤ 1 s; token 2 still OK |
| **Changing `privileges` (including item access)** | **Invalidates both tokens.** Matches the docs |
| **Changing `httpReferrers`** | **Also invalidates the tokens** (`apiToken1Active: false`, 498) |
| `updateApiKey({ privileges, httpReferrers, generateToken1 })` in one call | OK: applies the new access and issues the new token |
| An expiration date can't be extended without changing the token | Renewing = generating again |
| Title, tags and project | Safe changes (tokens untouched) |
| Item `snippet`, `description`, `properties` | **To verify on a real account** that they don't invalidate tokens (they are item fields, like title and tags) |
| Sharing the key with a group + `getGroupContent` | OK |
| OAuth popup login + PKCE from `localhost:3000` | OK |
| `premium:user:geocode:stored` on an API key | `Invalid Privileges` (not supported on Location Platform) |
| `features:user:edit` / `fullEdit` / `portal:user:viewOrgItems` on an API key | Accepted |
| Group logo: `updateGroup({ params: { thumbnail: File } })` | OK (multipart). On a private group the thumbnail returns 403 without a token → downloaded with `fetch` and the `X-Esri-Authorization` header |
| Search index | Eventually consistent: `searchGroups` takes 10-20 s to reflect a change and a just-deleted item can still show up → `loadCredentials` uses `allSettled` and the UI applies recent project changes locally |
| `registerApp` fails inside `createApiKey` | Leaves an orphan `Application` item that must be deleted |
| REST JS error with a username/password session | The error carries the `ArcGISIdentityManager` **with the password in clear text**: never `console.log(error)` in scripts |

## 5. User interface

### Layout
- **Sign-in:** "Sign in with ArcGIS" (OAuth popup + PKCE; session serialized to `localStorage`).
- **Header:** app name and user menu (`getSelf`): My portal, Location Platform dashboard, Account settings, Sign out.
- **Left panel, projects:** All / each `project` group (with logo) / No project ("needs triage"). The edit pencil shows on hover. "New project" → `createGroup`. "Edit project" dialog: name, summary, contacts and notes (with a visibility notice), logo, delete, link to the group.
- **Center:** list **or** detail. Navigation uses browser history (`#credential/<itemId>`, deep links and the back button).

### List
- **KPIs**, compact and clickable (they filter): API keys, OAuth apps, tokens expiring in ≤ 30 days, credentials with critical issues.
- **Hybrid search** (combobox): free text (name, summary, owner, tags, projects, referrers, redirect URIs) with highlighting, plus suggested tags grouped by family with counts. Several filters = AND.
- **Table:** credential (type icon, name, summary, 2 tags + `+N` colored by family), project (only in "All"), tokens (one chip per slot with days left), number of privileges, items per tier with counts, audit level. The whole row opens the detail.
- **Batch actions** (multiple selection): revoke tokens, move to project, add tags, delete. Results report partial failures ("7 of 8 done. Failed: …").

### Detail
- **Header:** name and summary (pencil on hover, edited in place), metadata with icons (type, registered, modified), Usage and Portal item buttons, tags as colored chips with "Edit tags".
- **Left column:** Audit, Exposed items (grouped by tier), Privileges (grouped by section, readable names, Admin / All your items / Outside policy badges), Referrers. OAuth apps: Client ID and Redirect URIs.
- **Right column:** API keys, Ownership, Notes, Projects (checkbox → `shareItemWithGroup` / `unshareItemWithGroup`).
- **API keys** (like the portal item page): one row per slot with status (Active / Expired / Not generated), "Show partial API key", expiration and Generate / Regenerate / Invalidate actions. Regenerate and Invalidate ask for confirmation; Generate in the free slot enables zero-downtime rotation.
- **In-place access editing:** each card (items, privileges, referrers) is edited where it is, with the note "Saving issues a new token". Saving opens a confirmation with the diff and the tokens that will stop working; button "Revoke and generate token".
- **Ownership:** Owner, Contact, Deployed in, Link. When empty, shows its projects' notes ("From project …").
- **Notes:** free text; URLs become links.
- **Visibility notices** on every context form: who can read it (private vs shared credential, group) and "don't store secrets; keep personal data to what you need".

### Dialogs
- **New API key:** title, project, tags (combobox with `getUserTags` suggestions, new-family warning with "Use …" / "Keep"), privileges (every documented one, grouped), item access, referrers, validity in days.
- **New token:** full key with Copy inside the box, hide/show (for shared screens), "ArcGIS never shows this API key again" notice, next rotation step, "Test in viewer".

### Viewer (`viewer.html`, "Customer app")
- Receives the key through **`postMessage`** (it never lands in the URL or the history) and keeps it in that tab's `sessionStorage`.
- Checks `portals/self` every 3 s: green = valid, red = 498.

## 6. Audit rules (`src/audit.js`)

| Level | Rule |
|---|---|
| Warning | Not assigned to a project |
| Warning | No owner: no owner/contact on the credential and no notes on its projects |
| Warning | No active tokens (unused credential) |
| Warning | Two active tokens (unfinished rotation) |
| Critical / Warning | Token expired / expires in ≤ 30 days (includes the contact when there is one) |
| Warning | No referrers |
| Critical | `portal:admin:*` privileges |
| Critical | Privileges with global access to every item (`features:user:edit`, `features:user:fullEdit`) |
| Warning | Privileges outside the `config.js` policy |
| Warning | Access to items that no longer exist |
| Critical | `tier:restricted` items exposed by a key without referrers |
| Warning | Key tagged `env:trial` exposing `premium` or `restricted` data |
| Critical | Global access privilege while the account has `restricted` data |
| Info | Exposed items without a tier |
| Critical | OAuth app with an `http://` redirect URI that is not localhost |

## 7. API (`src/api.js`)

| Area | Calls |
|---|---|
| Auth | `ArcGISIdentityManager.beginOAuth2` / `completeOAuth2` / `deserialize` / `signOut` |
| User | `getSelf`, `getUserTags` (tag suggestions with counts) |
| Items | `searchItems` + `SearchQueryBuilder` + `nextPage()`, `updateItem` (title, summary, notes, tags, `properties`) |
| Credentials | `getApiKey`, `getOAuthApp`, and **`request()` to `portals/self/apiTokens`** (no REST JS function for it) |
| Projects | `searchGroups`, `getGroupContent`, `createGroup`, `updateGroup` (with logo), `removeGroup`, `shareItemWithGroup`, `unshareItemWithGroup` |
| Lifecycle | `createApiKey`, `updateApiKey` (`generateToken(key, slot)`, `reconfigureKey`), `invalidateApiKey`, `unregisterApp` + `removeItem` |

## 8. Files

```
index.html        Calcite layout + import map + styles
callback.html     completeOAuth2 (popup)
viewer.html       "customer app" that uses the key
config.js         clientId, project tag, privilege policy, days
src/api.js        every REST JS call
src/audit.js      pure rules + ownerOf()
src/privileges.js privilege names and sections
src/main.js       UI
src/mock.js       same interface as api.js with fake data (?mock)
scripts/seed.mjs  demo data (npm run seed)
scripts/logo.mjs  project logos
```

Demo account credentials: `.env` (in `.gitignore`), for scripts only.
OAuth app in the account: "Credential Manager demo (localhost)" (to be renamed "Credential Console (localhost)"), client ID `wfut15HeFKozbRpB`, redirect `http://localhost:3000/callback.html`.

## 9. Demo data (`npm run seed`)

`scripts/seed.mjs` is idempotent: it deletes everything tagged `cm-seed` and recreates it, with expirations relative to today.

- **Scenario:** GeoDataProvider GmbH (Frankfurt) sells urban data. Fictional customers with `.example` domains.
- **Projects:** Mainhausen Urban Planning Office (customer), RheinMain PropTech GmbH (customer), Velora Micromobility (trial), GeoDataProvider · Website & catalogue (internal), Legacy & sandbox.
- **16 data items** renamed with catalogue titles (IDs don't change).
- **10 existing credentials:** only title, tags and project change. Privileges and tokens are left untouched.
- **8 new API keys**, each in a different audit state:

| Key | State |
|---|---|
| Mainhausen · Land-use viewer (prod) | OK |
| Mainhausen · Field inspections app (prod) | Two tokens (rotation in progress), T1 expires in 12 d |
| RheinMain PropTech · Property portal (prod) | Expires in 20 d |
| RheinMain PropTech · Property portal (staging) | No referrers |
| Velora · Mobility data trial (14 days) | Trial; routing outside the policy |
| Website · Catalogue map previews | OK |
| Drone imagery · Partner download portal | OK |
| Sales · Demo laptop key (do not share) | Critical: `features:user:edit`, no referrer, no project |

To do: have the seed fill in summary, owner and project notes for some credentials (the mock already does).

## 10. To do

- [ ] Test on a real account: generate / regenerate / invalidate per slot from the UI with the viewer; user menu (dashboard and Account settings URLs); Sign out.
- [ ] Verify on a real account that `snippet`, `description` and `properties` don't invalidate tokens.
- [ ] Check the computed partial key against the one arcgis.com shows.
- [ ] Reassign project(s) from the Project cell in the table.
- [ ] OAuth app detail: edit redirect URIs.
- [ ] Audit card with no findings → badge in the header.
- [ ] `Cannot read properties of null (reading 'disconnect')` errors in the console (Calcite 5.1.2 internals when re-rendering with `innerHTML`; no visible effect).
- [ ] Calcite 5.1.2: the combobox doesn't index items added after it renders (it is rebuilt every time) and `filterProps` empties the filter (not used).
- [ ] Dark mode and narrow screens for the detail view.
- [ ] Copy: "Add tag" (batch bar) vs "Add tags" (dialog).
- [ ] Viewer: a real map (Maps SDK) with the exposed layer?
- [ ] Optional: `ArcGISIdentityManager` with `refreshToken` for long sessions.

## 11. Appendix: usage data

Usage per credential is available in the Location Platform dashboard. The app links to it (the "Usage" button in the detail view) instead of duplicating it.
