// Shared by sync.js (website) and the /tier bot, so both read role names the same way.

// Role gamemode text -> site gamemode key. Spaces, dashes and case are ignored.
const MODE_ALIASES = {
  vanilla: "vanilla", crystal: "vanilla", cpvp: "vanilla",
  uhc: "uhc",
  pot: "pot", potion: "pot", diamondpot: "pot", diapot: "pot",
  nethop: "nethop", netherop: "nethop", netheriteop: "nethop", nethpot: "nethop", netheritepot: "nethop", netherpot: "nethop",
  smp: "smp",
  sword: "sword",
  axe: "axe",
  mace: "mace",
  spearmace: "spearmace", spear: "spearmace",
  diamondsmp: "diamondsmp", diasmp: "diamondsmp", dsmp: "diamondsmp",
  cart: "cart", minecart: "cart", cartpvp: "cart",
};

// Region role name (spaces/case ignored) -> tag shown on the site
const REGIONS = {
  nae: "NAE", naeast: "NAE", eastna: "NAE",
  nac: "NAC", nacentral: "NAC", centralna: "NAC",
  naw: "NAW", nawest: "NAW", westna: "NAW",
  na: "NA", eu: "EU", as: "AS", au: "AU", sa: "SA", me: "ME", af: "AF",
};

const MODE_ORDER = ["vanilla", "uhc", "pot", "nethop", "smp", "sword", "axe", "mace", "spearmace", "diamondsmp", "cart"];

const MODE_NAMES = {
  vanilla: "Vanilla", uhc: "UHC", pot: "Pot", nethop: "NethOP", smp: "SMP",
  sword: "Sword", axe: "Axe", mace: "Mace", spearmace: "Spear Mace", diamondsmp: "Diamond SMP", cart: "Cart",
};

// Keep these in sync with TIER_POINTS / TITLES in website/script.js
const TIER_POINTS = { 1: 60, 2: 30, 3: 15, 4: 6, 5: 2 };
const TITLES = [
  { min: 450, name: "Combat Grandmaster" },
  { min: 300, name: "Combat Master" },
  { min: 250, name: "Combat Ace" },
  { min: 125, name: "Combat Specialist" },
  { min: 50,  name: "Combat Cadet" },
  { min: 20,  name: "Combat Novice" },
  { min: 0,   name: "Combat Rookie" },
];
const points = (tiers) => Object.values(tiers).reduce((sum, t) => sum + (TIER_POINTS[t] || 0), 0);
const titleFor = (pts) => TITLES.find((t) => pts >= t.min).name;

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// "Netherite Pot" -> "nethop"
function parseMode(text) {
  return MODE_ALIASES[squash(text)] || null;
}

// "T5 - Sword" -> { tier: 5, mode: "sword" }   (also accepts –, —, :, | or no separator)
function parseTierRole(roleName) {
  const m = roleName.trim().match(/^T\s*([1-5])\s*[-–—:|]?\s*(.+)$/i);
  if (!m) return null;
  const mode = parseMode(m[2]);
  return mode ? { tier: Number(m[1]), mode } : null;
}

function parseRegionRole(roleName) {
  return REGIONS[squash(roleName)] || null;
}

// Turn the raw Discord roles + members into the site's player list
function buildPlayers(roles, members, nameOverrides = {}) {
  const tierRoles = new Map();
  const regionRoles = new Map();
  const unknown = [];
  for (const role of roles) {
    const t = parseTierRole(role.name);
    if (t) tierRoles.set(role.id, t);
    else if (/^T\s*[1-5]\s*[-–—:|]?\s*[a-z]/i.test(role.name.trim())) unknown.push(role.name);
    const r = parseRegionRole(role.name);
    if (r) regionRoles.set(role.id, r);
  }

  const players = [];
  for (const mem of members) {
    if (mem.user.bot) continue;
    const tiers = {};
    let region = null;
    for (const id of mem.roles) {
      const t = tierRoles.get(id);
      // If someone has two roles for the same mode, keep the better (lower) tier
      if (t && (!tiers[t.mode] || t.tier < tiers[t.mode])) tiers[t.mode] = t.tier;
      if (regionRoles.has(id)) region = regionRoles.get(id);
    }
    if (!Object.keys(tiers).length) continue;

    // names.json can be keyed by user ID, Discord username, server nickname or display name
    const discordName = mem.nick || mem.user.global_name || mem.user.username;
    const name =
      nameOverrides[mem.user.id] ||
      nameOverrides[mem.user.username] ||
      (mem.nick && nameOverrides[mem.nick]) ||
      (mem.user.global_name && nameOverrides[mem.user.global_name]) ||
      discordName;

    const sorted = {};
    for (const k of MODE_ORDER) if (tiers[k]) sorted[k] = tiers[k];
    players.push({ id: mem.user.id, name: name.trim(), region, tiers: sorted });
  }
  players.sort((a, b) => a.name.localeCompare(b.name));
  return { players, tierRoleCount: tierRoles.size, unknown };
}

module.exports = { MODE_ORDER, MODE_NAMES, TIER_POINTS, points, titleFor, parseMode, parseTierRole, parseRegionRole, buildPlayers };

