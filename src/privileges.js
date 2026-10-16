// Readable names for API key privileges, grouped as in the docs:
// https://developers.arcgis.com/documentation/security-and-authentication/reference/privileges/location-platform/

const SECTIONS = {
  "Location services": {
    "premium:user:basemaps": "Basemap styles",
    "premium:user:staticbasemaptiles": "Static basemap tiles",
    "premium:user:staticMaps": "Static maps (beta)",
    "premium:user:places": "Places",
    "premium:user:geocode:stored": "Geocoding (stored results)",
    "premium:user:geocode:temporary": "Geocoding (not stored)",
    "premium:user:networkanalysis:routing": "Routing",
    "premium:user:networkanalysis:closestfacility": "Closest facility",
    "premium:user:networkanalysis:locationallocation": "Location-allocation",
    "premium:user:networkanalysis:optimizedrouting": "Optimized routing",
    "premium:user:networkanalysis:origindestinationcostmatrix": "Origin-destination cost matrix",
    "premium:user:networkanalysis:servicearea": "Service areas",
    "premium:user:networkanalysis:vehiclerouting": "Multi-vehicle routing",
    "premium:user:networkanalysis:lastmiledelivery": "Last mile delivery",
    "premium:user:networkanalysis:snaptoroads": "Snap to roads",
    "premium:user:geoenrichment": "GeoEnrichment",
    "premium:user:elevation": "Elevation",
  },
  "Personal · Content": {
    "portal:user:createItem": "Create, update and delete own content",
    "portal:user:viewOrgItems": "View content shared with the organization",
    "portal:user:viewHostedFeatureServices": "View hosted feature services",
    "portal:user:viewHostedTileServices": "View hosted tile services",
    "portal:user:viewTracks": "View location tracks",
    "portal:user:reassignItems": "Reassign own content",
    "portal:user:receiveItems": "Receive content",
    "portal:user:categorizeItems": "Categorize own items",
    "portal:publisher:publishFeatures": "Publish hosted feature layers",
    "portal:publisher:publishTiles": "Publish hosted tile layers",
    "portal:publisher:publishScenes": "Publish hosted scene layers",
    "portal:publisher:publishTiledImagery": "Publish hosted tiled imagery",
    "portal:publisher:createDataPipelines": "Create and run data pipelines",
  },
  "Personal · Features": {
    "features:user:edit": "Edit features (all your editable layers)",
    "features:user:fullEdit": "Edit features with full control (all your layers)",
  },
  "Personal · Sharing": {
    "portal:user:shareToGroup": "Share with groups",
    "portal:user:shareToOrg": "Share with the organization",
    "portal:user:shareToPublic": "Share with the public",
    "portal:user:shareGroupToOrg": "Make groups visible to the organization",
    "portal:user:shareGroupToPublic": "Make groups visible to the public",
    "opendata:user:designateGroup": "Make groups available to Open Data",
  },
  "Personal · Members and groups": {
    "portal:user:viewOrgUsers": "View organization members",
    "portal:user:joinGroup": "Join organization groups",
    "portal:user:joinNonOrgGroup": "Join external groups",
    "portal:user:viewOrgGroups": "View groups shared with the organization",
  },
  "Personal · Apps": {
    "portal:user:useAIAssistants": "Use AI assistants",
    "portal:user:allowBetaAccess": "Beta apps and capabilities",
    "portal:user:arcgispro:takeLicenseOffline": "Take ArcGIS Pro license offline",
  },
  "Admin · Groups": {
    "portal:admin:viewGroups": "View all groups",
    "portal:admin:updateGroups": "Update groups",
    "portal:admin:deleteGroups": "Delete groups",
    "portal:admin:reassignGroups": "Reassign group ownership",
    "portal:admin:assignToGroups": "Assign members to groups",
    "portal:admin:createUpdateCapableGroup": "Create groups with update capabilities",
    "portal:admin:createLeavingDisallowedGroup": "Create groups members can't leave",
  },
  "Admin · Content": {
    "portal:admin:viewItems": "View all content",
    "portal:admin:updateItems": "Update all content",
    "portal:admin:deleteItems": "Delete any content",
    "portal:admin:reassignItems": "Reassign item ownership",
    "portal:admin:categorizeItems": "Categorize any item",
    "portal:admin:updateItemCategorySchema": "Manage content categories",
    "portal:admin:shareToOrg": "Share member content with the organization",
    "portal:admin:createReports": "Create administrative reports",
    "portal:publisher:publishServerGPServices": "Publish web tools",
  },
  "Admin · Organization": {
    "portal:admin:manageSecurity": "Security and infrastructure",
    "portal:admin:manageWebsite": "Organization website",
    "portal:admin:manageCollaborations": "Collaborations",
    "portal:admin:manageCredits": "Credits",
    "portal:admin:manageUtilityServices": "Utility services",
  },
};

const ORDER = [...Object.keys(SECTIONS), "Other"];
const LOOKUP = Object.fromEntries(
  Object.entries(SECTIONS).flatMap(([group, names]) => Object.entries(names).map(([p, name]) => [p, { group, name }]))
);

// Every privilege in the docs, in display order (feeds the privileges editor)
export const ALL_PRIVILEGES = Object.keys(LOOKUP);

// Unknown codes (e.g. a newer admin privilege) get a name derived from the code
export function describePrivilege(privilege) {
  if (LOOKUP[privilege]) return LOOKUP[privilege];
  const last = privilege.split(":").pop();
  const name = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  return { group: privilege.startsWith("portal:admin:") ? "Admin · Other" : "Other", name };
}

// [[group, [{ privilege, name }]]] in docs order
export function groupPrivileges(privileges) {
  const groups = Object.groupBy(privileges.map((privilege) => ({ privilege, ...describePrivilege(privilege) })), (p) => p.group);
  const order = [...ORDER, "Admin · Other"];
  return order.filter((g) => groups[g]).map((g) => [g, groups[g]]);
}
