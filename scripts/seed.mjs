// Seeds the demo account with a realistic data-provider setup.
// Idempotent: everything it creates is tagged "cm-seed" and is deleted and re-created on every run.
// Expiration dates are relative to today, so run it the day before the talk.
//
//   npm run seed          (reads ARCGIS_USERNAME / ARCGIS_PASSWORD from .env)
//
// Generated tokens are discarded: they are never printed or stored.
import { ArcGISIdentityManager } from "@esri/arcgis-rest-request";
import {
  getItem,
  searchItems,
  searchGroups,
  updateGroup,
  updateItem,
  removeItem,
  createGroup,
  removeGroup,
  shareItemWithGroup,
} from "@esri/arcgis-rest-portal";
import { createApiKey, updateApiKey, unregisterApp } from "@esri/arcgis-rest-developer-credentials";
import { logoPng } from "./logo.mjs";

const SEED_TAG = "cm-seed";
const PROJECT_TAG = "project";
const DAY = 86_400_000;

// ---------- existing items in the demo account ----------

const ITEMS = {
  droneMap: "5803d8b90ba7487db96d3b02bd2dd6d1",
  droneTpk: "fc07523962984dac9ef47808b4d17774",
  buildingsFs: "6eda86b25db7473480b7c4a2223ae246",
  furnitureFs: "ef58837655fd413c8990f8debca4b9cb",
  mobilityFs: "e19b42b64fdf4de3a96529210305a61a",
  frankfurtFs: "460b31ee61d544d7b4ab4db001f498ae",
  buildingsVtl: "75bc7746cbb74350824d2f6da7f0d7b4",
  frankfurtVtl: "d59acb6bb8844d138ff05041eb59506f",
  furnitureVtl: "6a3c8c0c041c4c7684c2b7c019096a1e",
  inspectionsMap: "f57cc2edd5174f6794da7689e99b028c",
  tasksMap: "f75f31a5b4c04b11963abb1c3bf90144",
  frankfurtView: "fa93189890714efe8ec4ddab9097ddf9",
  inspectionsView: "0d76c15d4b514b92be6050751496227d",
  mobilityGpkg: "96038ddbb42743098728debab10d8292",
  frankfurtGpkg: "fdb59acd69a24c8ebd7324203586a969",
  sandboxFs: "735d7d5b56d24acb86355498670bdb8b",
};

// Catalogue titles for the data items (ids and URLs don't change)
const ITEM_TITLES = {
  [ITEMS.droneMap]: "Drone Orthophoto · Botanical Garden 2025",
  [ITEMS.droneTpk]: "Drone Orthophoto · Botanical Garden 2025 (tile package)",
  [ITEMS.buildingsFs]: "Buildings & Land Use",
  [ITEMS.furnitureFs]: "Street Furniture",
  [ITEMS.mobilityFs]: "Transport & Mobility Network",
  [ITEMS.frankfurtFs]: "Frankfurt Buildings & Land Use",
  [ITEMS.buildingsVtl]: "Buildings & Land Use (vector tiles)",
  [ITEMS.frankfurtVtl]: "Frankfurt Buildings & Land Use (vector tiles)",
  [ITEMS.furnitureVtl]: "Street Furniture (vector tiles)",
  [ITEMS.inspectionsMap]: "Mainhausen · Building Inspections Map",
  [ITEMS.tasksMap]: "Mainhausen · Inspection Tasks Map",
  [ITEMS.frankfurtView]: "Frankfurt Buildings & Land Use (customer view)",
  [ITEMS.inspectionsView]: "Building Inspections (field view)",
  [ITEMS.mobilityGpkg]: "Transport & Mobility Network (GeoPackage export)",
  [ITEMS.frankfurtGpkg]: "Frankfurt Buildings & Land Use (GeoPackage export)",
  [ITEMS.sandboxFs]: "Sandbox · Service created with REST JS",
};

// Data tier of each item (tag "tier:<value>"), used by the cross-audit rules
const ITEM_TIERS = {
  open: [ITEMS.furnitureFs, ITEMS.furnitureVtl, ITEMS.buildingsVtl],
  premium: [ITEMS.buildingsFs, ITEMS.mobilityFs, ITEMS.frankfurtFs, ITEMS.frankfurtVtl, ITEMS.droneMap, ITEMS.droneTpk, ITEMS.mobilityGpkg, ITEMS.frankfurtGpkg],
  restricted: [ITEMS.inspectionsView, ITEMS.inspectionsMap, ITEMS.tasksMap, ITEMS.frankfurtView],
};

// ---------- projects (groups) ----------

const PROJECTS = {
  mainhausen: { title: "Mainhausen Urban Planning Office", snippet: "Customer · municipality", logo: ["#1f5fa8", "circle"] },
  rheinmain: { title: "RheinMain PropTech GmbH", snippet: "Customer · real-estate portal", logo: ["#2e8b57", "diamond"] },
  velora: { title: "Velora Micromobility", snippet: "Trial · e-scooter sharing", logo: ["#e07b1a", "stripes"] },
  website: { title: "GeoDataProvider · Website & catalogue", snippet: "Internal", logo: ["#6a3fb5", "ring"] },
  legacy: { title: "Legacy & sandbox", snippet: "Old credentials pending clean-up", logo: ["#6b7280", "triangle"] },
};

// ---------- existing credentials: new title and tags only ----------
// Changing titles/tags does not touch tokens. Privileges are left as they are.

const EXISTING = [
  { id: "a7fe84b5b3fa42329e98ef1091327e83", project: "mainhausen", title: "Mainhausen · Inspection tasks app (v1)", tags: ["env:prod", "customer:mainhausen", "status:legacy"] },
  { id: "b58a74aadb3f44c39f330d0192c14f40", project: "mainhausen", title: "Mainhausen · Field inspections sync (v1)", tags: ["env:prod", "customer:mainhausen", "status:legacy"] },
  { id: "9589df33a83c459ba71d416056e442b1", project: "website", title: "Website · Frankfurt showcase map (old)", tags: ["env:internal", "team:web", "status:legacy"] },
  { id: "8d30689708864b9b9e89f5a36e53c30e", project: "legacy", title: "Sales · Conference demo key 2025", tags: ["env:internal", "team:sales", "status:legacy"] },
  { id: "ba4bd2dbc0d245e8a7c2c5a673258720", project: "legacy", title: "Sales · Generic basemap demo key", tags: ["env:internal", "team:sales", "status:legacy"] },
  { id: "21f0ab9b6abc4d10a5a8ae44990924f8", project: null, title: "Ops · Automation master key", tags: ["env:internal", "team:ops", "status:legacy"] },
  { id: "e0b72488ea804c529fdd752eae2fd869", project: "legacy", title: "Data team · ETL publishing key", tags: ["env:internal", "team:data", "status:legacy"] },
  { id: "08d29160bf924bad8f1f1d2109e4d318", project: null, title: "Data team · Admin tools (OAuth)", tags: ["env:internal", "team:data"] },
  { id: "26b16ba1806041b48f2ce2b1f909cbed", project: "legacy", title: "Data team · Upload portal (OAuth)", tags: ["env:internal", "team:data", "status:legacy"] },
  { id: "d98b6c2848a6426eb0828361f3005e34", project: null, title: "Credential Console (localhost)", tags: ["env:internal", "team:ops"] },
];

// ---------- new API keys (re-created on every run) ----------

const access = (...ids) => ids.map((id) => `portal:app:access:item:${id}`);

const NEW_KEYS = [
  {
    title: "Mainhausen · Land-use viewer (prod)",
    project: "mainhausen",
    tags: ["env:prod", "customer:mainhausen"],
    privileges: ["premium:user:basemaps", ...access(ITEMS.frankfurtVtl, ITEMS.frankfurtView)],
    httpReferrers: ["https://planning.mainhausen.example/*"],
    token1Days: 180,
  },
  {
    title: "Mainhausen · Field inspections app (prod)",
    project: "mainhausen",
    tags: ["env:prod", "customer:mainhausen"],
    privileges: ["premium:user:basemaps", "premium:user:staticbasemaptiles", ...access(ITEMS.inspectionsView, ITEMS.inspectionsMap)],
    httpReferrers: ["https://inspections.mainhausen.example/*"],
    token1Days: 12,
    token2Days: 365, // rotation in progress: both tokens active
  },
  {
    title: "RheinMain PropTech · Property portal (prod)",
    project: "rheinmain",
    tags: ["env:prod", "customer:rheinmain-proptech"],
    privileges: ["premium:user:basemaps", "premium:user:geocode:temporary", ...access(ITEMS.buildingsVtl)],
    httpReferrers: ["https://www.rheinmain-proptech.example/*"],
    token1Days: 20, // renewal due soon
  },
  {
    title: "RheinMain PropTech · Property portal (staging)",
    project: "rheinmain",
    tags: ["env:staging", "customer:rheinmain-proptech"],
    privileges: ["premium:user:basemaps", "premium:user:geocode:temporary", ...access(ITEMS.buildingsVtl)],
    httpReferrers: [], // missing referrers
    token1Days: 90,
  },
  {
    title: "Velora · Mobility data trial (14 days)",
    project: "velora",
    tags: ["env:trial", "customer:velora"],
    privileges: ["premium:user:basemaps", "premium:user:networkanalysis:routing", ...access(ITEMS.mobilityFs)],
    httpReferrers: ["https://app.velora.example/*"],
    token1Days: 14,
  },
  {
    title: "Website · Catalogue map previews",
    project: "website",
    tags: ["env:internal", "team:web"],
    privileges: ["premium:user:basemaps", "premium:user:staticbasemaptiles", ...access(ITEMS.buildingsVtl, ITEMS.frankfurtVtl, ITEMS.furnitureVtl)],
    httpReferrers: ["https://www.geodataprovider.example/*"],
    token1Days: 365,
  },
  {
    title: "Drone imagery · Partner download portal",
    project: "website",
    tags: ["env:prod", "team:web"],
    privileges: ["premium:user:basemaps", ...access(ITEMS.droneMap)],
    httpReferrers: ["https://partners.geodataprovider.example/*"],
    token1Days: 60,
  },
  {
    title: "Sales · Demo laptop key (do not share)",
    project: null,
    tags: ["env:internal", "team:sales"],
    privileges: ["premium:user:basemaps", "premium:user:places", "portal:user:viewOrgItems", "features:user:edit"],
    httpReferrers: [],
    token1Days: 365,
  },
];

// Test key left over from the first UI test
const LEFTOVER_TITLES = ["Demo test · Customer viewer (delete me)"];

// ---------- run ----------

// Print only the message on failure: REST JS errors include the request options,
// and with username/password sign-in that means the password in clear text.
process.on("uncaughtException", (error) => {
  console.error(`\nSeed failed: ${error.message}`, error.response?.error?.details ?? "");
  process.exit(1);
});

const authentication = await ArcGISIdentityManager.signIn({
  username: process.env.ARCGIS_USERNAME,
  password: process.env.ARCGIS_PASSWORD,
});
const owner = authentication.username;
const inDays = (days) => {
  const date = new Date(Date.now() + days * DAY);
  date.setHours(23, 59, 59, 999);
  return date;
};

async function deleteCredential(item) {
  await unregisterApp({ itemId: item.id, authentication }).catch(() => {});
  await removeItem({ id: item.id, authentication });
  console.log(`  - deleted "${item.title}"`);
}

console.log("1. Cleaning up previous seed");
const { results: myItems } = await searchItems({ q: `owner:${owner}`, num: 100, authentication });
for (const item of myItems) {
  if (item.type === "Application" && (item.tags.includes(SEED_TAG) || item.tags.includes("cm-probe") || LEFTOVER_TITLES.includes(item.title))) {
    await deleteCredential(item);
  }
}
const { results: oldGroups } = await searchGroups({ q: `tags:${SEED_TAG} AND owner:${owner}`, num: 100, authentication });
for (const group of oldGroups) {
  await removeGroup({ id: group.id, authentication });
  console.log(`  - deleted group "${group.title}"`);
}

console.log("2. Renaming and classifying data items");
for (const [id, title] of Object.entries(ITEM_TITLES)) {
  const tier = Object.keys(ITEM_TIERS).find((t) => ITEM_TIERS[t].includes(id));
  const { tags = [] } = await getItem(id, { authentication });
  const newTags = [...tags.filter((t) => !t.startsWith("tier:")), ...(tier ? [`tier:${tier}`] : [])];
  await updateItem({ item: { id, title, tags: newTags }, authentication });
  console.log(`  - ${title}${tier ? ` [${tier}]` : ""}`);
}

console.log("3. Creating projects");
const groupIds = {};
for (const [key, { title, snippet, logo }] of Object.entries(PROJECTS)) {
  const { group } = await createGroup({
    group: { title, snippet, tags: [PROJECT_TAG, SEED_TAG], access: "private" },
    authentication,
  });
  groupIds[key] = group.id;
  const thumbnail = new File([logoPng(...logo)], `${key}.png`, { type: "image/png" });
  await updateGroup({ group: { id: group.id }, params: { thumbnail }, authentication });
  console.log(`  - ${title}`);
}

console.log("4. Updating existing credentials (title + tags)");
for (const { id, project, title, tags } of EXISTING) {
  await updateItem({ item: { id, title, tags }, authentication });
  if (project) await shareItemWithGroup({ id, groupId: groupIds[project], authentication });
  console.log(`  - ${title}`);
}

console.log("5. Creating API keys");
for (const key of NEW_KEYS) {
  const created = await createApiKey({
    title: key.title,
    tags: [...key.tags, SEED_TAG],
    privileges: key.privileges,
    httpReferrers: key.httpReferrers,
    generateToken1: true,
    apiToken1ExpirationDate: inDays(key.token1Days),
    authentication,
  });
  if (key.token2Days) {
    await updateApiKey({
      itemId: created.itemId,
      generateToken2: true,
      apiToken2ExpirationDate: inDays(key.token2Days),
      authentication,
    });
  }
  if (key.project) await shareItemWithGroup({ id: created.itemId, groupId: groupIds[key.project], authentication });
  console.log(`  - ${key.title}`);
}

console.log("Done.");
