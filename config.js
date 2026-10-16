// Demo configuration. Paste the client ID of the OAuth credentials registered in your account.
export default {
  clientId: "wfut15HeFKozbRpB", // OAuth app "Credential Manager demo (localhost)" in the demo account (rename it to "Credential Console (localhost)")
  portal: "https://www.arcgis.com/sharing/rest",
  redirectUri: new URL("callback.html", location.href).href,

  // Groups with this tag = projects / customers
  projectTag: "project",

  // Data items are classified with a "tier:" tag: open, premium or restricted
  tiers: ["open", "premium", "restricted"],

  // Links to the Location Platform dashboard instead of rebuilding usage reports
  dashboardUrl: "https://location.arcgis.com",

  // Tags hidden in the UI (internal markers)
  hiddenTags: ["cm-seed", "credential-manager-demo"],

  // Audit
  expiringSoonDays: 30,
  defaultValidityDays: 30,

  // Policy: privileges allowed in API keys (item access privileges are checked separately)
  allowedPrivileges: [
    "premium:user:basemaps",
    "premium:user:staticbasemaptiles",
    "premium:user:geocode:temporary",
    "premium:user:places",
    "premium:user:elevation",
  ],

  // Privileges that grant access to ALL items in the account (see docs: "Item access privileges")
  globalAccessPrivileges: ["features:user:edit", "features:user:fullEdit"],

};
