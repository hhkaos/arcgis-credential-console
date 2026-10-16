# CLAUDE.md

Guidance for working on **Credential Console for ArcGIS Location Platform**: a no-build browser app (Calcite 5.1.2 + ArcGIS REST JS 4.11.0 from CDN) to audit, rotate and revoke developer credentials. Product spec: `docs/SPEC.md` (keep it updated when behavior changes). User-facing intro: `README.md`.

## Run and check

- `npm start` → <http://localhost:3000>. Port 3000 matters: the OAuth redirect URI is `http://localhost:3000/callback.html`.
- `?mock` (e.g. <http://localhost:3000/?mock>) swaps `src/api.js` for `src/mock.js`. Use it for every UI change; it needs no account.
- `npm run seed` writes demo data to the **real** account in `.env` (`ARCGIS_USERNAME` / `ARCGIS_PASSWORD`). Never print, log or commit `.env`.
- There are no tests. Verify UI changes in a browser in mock mode and look at the result (screenshots), in light and dark mode when styles change. A headless Playwright script works well; the Playwright MCP browser can be locked by another session.
- `Cannot read properties of null (reading 'disconnect')` in the console comes from Calcite when re-rendering with `innerHTML`. It is harmless and pre-existing; don't chase it unless asked.

## Architecture

- `src/api.js`: the **only** file that calls ArcGIS. Short functions (≤ ~20 lines), commented, readable on a slide: it is shown in the talk. Anything new must also be added to `src/mock.js` with the same signature.
- `src/audit.js`: pure rules, plus `ownerOf()` / `OWNER_KEY`.
- `src/privileges.js`: readable names and sections for every documented privilege.
- `src/main.js`: all UI. A single `state` object, `render*()` functions that write HTML strings with `innerHTML`, and delegated listeners on `document` (`data-*` attributes such as `data-open`, `data-edit-section`).
- Always escape interpolated values with `esc()`. Use `highlight()` for search matches and `linkify()` for user notes.
- Navigation: list ⇄ detail in the centre, with `#credential/<itemId>` and `history.pushState`. Use `openDetail()` / `closeDetail()`, never set `state.selectedId` directly.
- `run(button, action, message)` wraps every write: spinner, `refresh()`, toast, error handling.
- Styles live in `index.html`. Colors come from Calcite tokens (`--calcite-color-*`) so dark mode works.
- The app (UI copy, code, comments) is in English.

## ArcGIS facts learned (verified unless marked)

- A credential is an `Application` item with typeKeyword `Registered App`; API keys also have `APIToken`.
- `getApiKey` returns the full item (via `getItem`) including `snippet`, `description`, `properties` and `client_id`.
- Token expirations come from `request()` to `portals/self/apiTokens` (no REST JS function), not from `searchItems`.
- Item access is a privilege: `portal:app:access:item:<itemId>`.
- **Changing privileges, item access or `httpReferrers` invalidates both tokens.** Title, tags and project don't. Not yet verified for `snippet`, `description`, `properties`.
- Expiration can't be extended: renewing means generating a new token. `generateToken(key, slot)` replaces that slot's token; generating in the free slot gives zero-downtime rotation.
- Partial API key = `AT<slot>_` + last 8 characters of `client_id` (same as [arcgis-api-key-manager-toolkit](https://github.com/hhkaos/arcgis-api-key-manager-toolkit)). It is computed, not returned.
- `getUserTags` can return an empty tag (`""`). `isShownTag()` filters it out, together with hidden tags.
- Ownership is stored in `item.properties.credentialManager`. Merge it into the existing `properties`, never replace the whole object.
- Item and group `description` are HTML. The app edits them as plain text (`htmlToText` / `textToHtml`), which drops portal formatting.
- `updateItem` / `request()` serialize object params (such as `properties`) to JSON.
- The search index is eventually consistent (10-20 s for groups); recent project changes are patched locally (`projectPatches`).
- A REST JS error from a username/password session carries the password in clear text: never `console.log(error)` in scripts.

## Calcite 5.1.2 gotchas

- `calcite-combobox` does not index items added after it renders: rebuild the whole element (see `renderTags()` and `renderTagPicker()`).
- Setting `filterProps` breaks filtering. The default filter also matches `description`, so put counts and badges in `<span slot="content-end">`, not in the description.
- Right after rebuilding a combobox, `selectedItems` is not ready yet: pass values explicitly (see `commitTagPicker(box, values)`).
- In dialogs and cards, use `overlay-positioning="fixed"` and `max-items` so dropdowns don't break the layout.
- Combobox chips can't be styled per item: show our own `.tag` chips and only show the combobox while editing.
- `calcite-dropdown` ignores `width`; use `--calcite-dropdown-width`.
- Softer field borders: `--calcite-combobox-input-border-color` (combobox). The equivalent input/textarea/select variables are set but not verified.
- After `await`, `event.currentTarget` is `null`: grab the element before awaiting.
- `img.src = ""` resolves to the page URL: remove the attribute instead.

## UX decisions already made (keep them consistent)

- Tags are `family:value`. Chips show the readable value, colored by family (`TAG_FAMILIES`), with the raw tag in the tooltip. In the table: 2 chips + `+N`.
- Detail in the centre, two columns. Edit in place where the data is shown. Edit pencils appear on hover or focus (always visible on touch screens).
- Destructive actions (anything that invalidates tokens) get a subtle inline note while editing and a confirmation with the diff only when saving.
- Forms that store context (ownership, notes, project notes) show a visibility notice: who can read it, no secrets, minimal personal data.
- Don't add explanatory copy to success messages ("tokens untouched" was removed on purpose).

## Tone for docs and copy

This is a public sample presented at an Esri event. Present it as **complementary** to ArcGIS: the portal manages each credential and the Location Platform dashboard reports usage; this app shows how ArcGIS REST JS lets you build a view tailored to one workflow. Don't describe ArcGIS products as lacking, broken or buggy in this repo. Product feedback goes through internal channels, not here.

## Don't

- Don't commit `.env`, tokens, or screenshots that show a full API key.
- Don't rename the `credential-manager-demo` tag in `config.js` (`hiddenTags`): real items carry it.
- Don't call ArcGIS from `main.js`; go through `api.js` (and `mock.js`).
