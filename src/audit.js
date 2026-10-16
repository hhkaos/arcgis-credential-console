// Audit rules. Pure functions: they get data that is already loaded and never call the API.
import config from "../config.js";

const DAY = 86_400_000;
const LEVELS = ["ok", "info", "warning", "danger"];
const ITEM_ACCESS = "portal:app:access:item:";

// Split privileges into item access (item ids) and everything else
export function splitPrivileges(privileges = []) {
  return {
    itemIds: privileges.filter((p) => p.startsWith(ITEM_ACCESS)).map((p) => p.slice(ITEM_ACCESS.length)),
    privileges: privileges.filter((p) => !p.startsWith(ITEM_ACCESS)),
  };
}

// Active tokens of an API key with their expiration date
export function tokenSlots(cred, expirations) {
  return [1, 2]
    .filter((slot) => cred[`apiToken${slot}Active`])
    .map((slot) => ({
      slot,
      expires:
        expirations.find((e) => e.itemId === cred.itemId && Number(e.apiToken) === slot)?.expirationDate ??
        positive(cred.item?.[`apiToken${slot}ExpirationDate`]),
    }));
}

const positive = (n) => (n > 0 ? n : undefined);

// Data tier of an item, from its "tier:" tag
export function tierOf(item) {
  const tag = item?.tags?.find((t) => t.startsWith("tier:"));
  return tag ? tag.slice("tier:".length) : undefined;
}

// Ownership is stored in the item's free `properties` JSON, under our own key so other apps' properties survive
export const OWNER_KEY = "credentialManager";
export const ownerOf = (cred) => cred.item?.properties?.[OWNER_KEY] ?? {};

export function auditCredential(cred, { expirations, projects, items, now = Date.now() }) {
  const findings = [];
  const add = (level, text) => findings.push({ level, text });

  const own = projects.filter((p) => p.itemIds.includes(cred.itemId));
  if (!own.length) add("warning", "Not assigned to a project");

  // Someone has to act when a token expires: the credential's owner, or at least notes on its project
  const owner = ownerOf(cred);
  if (!owner.owner && !owner.contact && !own.some((p) => p.description?.trim())) {
    add("warning", "No owner: nobody to contact when it expires or breaks");
  }
  const contact = owner.contact || owner.owner;
  const who = contact ? ` · contact ${contact}` : "";

  if (cred.kind === "oauth") {
    const insecure = cred.redirect_uris.filter(
      (uri) => uri.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(uri)
    );
    if (insecure.length) add("danger", `Redirect URI without HTTPS: ${insecure.join(", ")}`);
    return findings;
  }

  const slots = tokenSlots(cred, expirations);
  if (!slots.length) add("warning", "No active tokens (unused credential)");
  if (slots.length === 2) add("warning", "Two active tokens: unfinished rotation?");

  for (const { slot, expires } of slots) {
    if (!expires) continue;
    const days = Math.floor((expires - now) / DAY);
    if (days < 0) add("danger", `Token ${slot} expired${who}`);
    else if (days <= config.expiringSoonDays) add("warning", `Token ${slot} expires in ${days} days${who}`);
  }

  if (!cred.httpReferrers?.length) {
    add("warning", "No referrers: the key works from any website");
  }

  const { itemIds, privileges } = splitPrivileges(cred.privileges);

  const admin = privileges.filter((p) => p.startsWith("portal:admin:"));
  if (admin.length) add("danger", `Administrative privileges: ${admin.join(", ")}`);

  const global = privileges.filter((p) => config.globalAccessPrivileges.includes(p));
  if (global.length) add("danger", `Access to ALL your items: ${global.join(", ")}`);

  const outOfPolicy = privileges.filter(
    (p) => !config.allowedPrivileges.includes(p) && !admin.includes(p) && !global.includes(p)
  );
  if (outOfPolicy.length) add("warning", `Privileges outside policy: ${outOfPolicy.join(", ")}`);

  const missing = itemIds.filter((id) => !items.some((i) => i.id === id));
  if (missing.length) add("warning", `Access to ${missing.length} item(s) that no longer exist`);

  // Cross-check with the data catalogue: what tier of data does this key expose?
  const exposed = itemIds.map((id) => items.find((i) => i.id === id)).filter(Boolean);
  const restricted = exposed.filter((i) => tierOf(i) === "restricted");
  const premium = exposed.filter((i) => tierOf(i) === "premium");
  const unclassified = exposed.filter((i) => !tierOf(i));
  const tags = cred.item?.tags ?? [];

  if (restricted.length && !cred.httpReferrers?.length) {
    add("danger", `Restricted data exposed without referrers: ${restricted.map((i) => i.title).join(", ")}`);
  }
  if (tags.includes("env:trial") && (restricted.length || premium.length)) {
    add("warning", `Trial key exposes ${restricted.length ? "restricted" : "premium"} data`);
  }
  if (global.length && items.some((i) => tierOf(i) === "restricted")) {
    add("danger", "Global item access includes restricted data");
  }
  if (unclassified.length) add("info", `${unclassified.length} exposed item(s) without a data tier`);

  return findings;
}

export function worstLevel(findings) {
  return findings.reduce(
    (worst, f) => (LEVELS.indexOf(f.level) > LEVELS.indexOf(worst) ? f.level : worst),
    "ok"
  );
}
