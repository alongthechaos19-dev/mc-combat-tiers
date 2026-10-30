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

const MODE_ORDER = ["vanilla", "uhc", "pot", "nethop", "smp", "sword", "axe", "mace", "diamondsmp", "cart"];

const MODE_NAMES = {
  vanilla: "Vanilla", uhc: "UHC", pot: "Pot", nethop: "NethOP", smp: "SMP",
  sword: "Sword", axe: "Axe", mace: "Mace", diamondsmp: "Diamond SMP", cart: "Cart",
};

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

module.exports = { MODE_ORDER, MODE_NAMES, parseMode, parseTierRole, parseRegionRole };
