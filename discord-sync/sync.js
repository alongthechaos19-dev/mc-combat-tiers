// ============================================================
//  MC Combat Tiers — Discord sync
//  Reads everyone's tier roles (like "T2 - Sword") from your
//  Discord server and rewrites ../website/players.js.
//
//  Run it with sync-players.bat (or: node sync.js)
//  Needs Node 18+ — no npm install required.
// ============================================================

const fs = require("fs");
const path = require("path");

const API = "https://discord.com/api/v10";
const CONFIG_FILE = path.join(__dirname, "config.json");
const NAMES_FILE = path.join(__dirname, "names.json");
const PLAYERS_FILE = path.join(__dirname, "..", "website", "players.js");

const { MODE_ORDER, parseTierRole, parseRegionRole } = require("./roles");

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
    players.push({ name: name.trim(), region, tiers: sorted });
  }
  players.sort((a, b) => a.name.localeCompare(b.name));
  return { players, tierRoleCount: tierRoles.size, unknown };
}

function writePlayersFile(players) {
  const lines = players.map((p) => {
    const tiers = Object.entries(p.tiers).map(([k, v]) => `${k}: ${v}`).join(", ");
    const region = p.region ? `region: ${JSON.stringify(p.region)}, ` : "";
    return `  { name: ${JSON.stringify(p.name)}, ${region}tiers: { ${tiers} } },`;
  });
  const out = `// ============================================================
//  MC Combat Tiers — player list
//  AUTO-GENERATED from Discord by discord-sync/sync.js
//  Last synced: ${new Date().toLocaleString()}
//
//  Manual edits here get overwritten next time you sync.
//  To fix someone's Minecraft name, use discord-sync/names.json.
// ============================================================

const PLAYERS = [
${lines.join("\n")}
];
`;
  // Skip the write when only the timestamp would change, so GitHub doesn't commit every run
  const strip = (s) => s.replace(/^\/\/  Last synced:.*$/m, "");
  let current = "";
  try { current = fs.readFileSync(PLAYERS_FILE, "utf8"); } catch {}
  if (strip(current) === strip(out)) return false;
  fs.writeFileSync(PLAYERS_FILE, out);
  return true;
}

/* ---------- Discord API ---------- */
async function discord(route, token) {
  for (;;) {
    const res = await fetch(API + route, { headers: { Authorization: `Bot ${token}` } });
    if (res.status === 429) {
      const body = await res.json();
      await new Promise((r) => setTimeout(r, (body.retry_after || 1) * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) throw new Error("Discord rejected the bot token. Reset it in the Developer Portal and run again to paste the new one (if it still fails, set \"token\" to \"\" in config.json).");
      if (res.status === 403) throw new Error("The bot can't see that server. Make sure it's invited and \"Server Members Intent\" is ON in the Developer Portal.");
      if (res.status === 404) throw new Error("Server not found. Check \"serverId\" in config.json.");
      throw new Error(`Discord error ${res.status}: ${text}`);
    }
    return res.json();
  }
}

async function fetchAllMembers(guildId, token) {
  const all = [];
  let after = "0";
  for (;;) {
    const page = await discord(`/guilds/${guildId}/members?limit=1000&after=${after}`, token);
    all.push(...page);
    if (page.length < 1000) return all;
    after = page[page.length - 1].user.id;
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`${path.basename(file)} isn't valid JSON: ${e.message}`);
  }
}

const isBlank = (v) => !v || String(v).includes("PASTE");

function ask(question) {
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

// First run: ask for the token, then find the server the bot is in. Both get saved to config.json.
// On GitHub they come from the DISCORD_TOKEN secret and DISCORD_SERVER_ID instead.
async function loadConfig() {
  if (process.env.DISCORD_TOKEN) {
    if (!process.env.DISCORD_SERVER_ID) throw new Error("DISCORD_SERVER_ID is not set.");
    return { token: process.env.DISCORD_TOKEN.trim(), serverId: process.env.DISCORD_SERVER_ID.trim() };
  }
  if (process.env.CI) throw new Error("DISCORD_TOKEN secret is missing. Add it in GitHub: Settings -> Secrets and variables -> Actions.");

  const config = readJson(CONFIG_FILE, {}) || {};
  let changed = false;

  if (isBlank(config.token)) {
    console.log("No bot token saved yet.");
    console.log("Get it from discord.com/developers -> your app -> Bot -> Reset Token -> Copy.\n");
    config.token = (await ask("Paste your bot token here (right-click to paste), then press Enter: ")).replace(/^Bot\s+/i, "");
    if (!config.token) throw new Error("No token entered.");
    changed = true;
  }

  if (isBlank(config.serverId)) {
    const guilds = await discord("/users/@me/guilds", config.token);
    if (!guilds.length) throw new Error("The bot isn't in any server yet. Invite it first (see SETUP.md step 2).");
    if (guilds.length > 1) {
      throw new Error("The bot is in more than one server. Put the right one's ID in config.json as \"serverId\":\n" +
        guilds.map((g) => `  ${g.id}  ${g.name}`).join("\n"));
    }
    config.serverId = guilds[0].id;
    console.log(`Found server: ${guilds[0].name}`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
    console.log("Saved to config.json — you won't be asked again.\n");
  }
  return config;
}

async function main() {
  const config = await loadConfig();
  const names = readJson(NAMES_FILE, {});
  delete names._comment;

  console.log("Fetching roles...");
  const roles = await discord(`/guilds/${config.serverId}/roles`, config.token);
  console.log("Fetching members...");
  const members = await fetchAllMembers(config.serverId, config.token);

  const { players, tierRoleCount, unknown } = buildPlayers(roles, members, names);
  if (!tierRoleCount) throw new Error('No tier roles found. Roles should look like "T2 - Sword".');

  const changed = writePlayersFile(players);
  console.log(`\nDone! Found ${tierRoleCount} tier roles and ${players.length} ranked players.`);
  console.log(changed ? "players.js updated — refresh the website to see changes." : "No tier changes since last sync.");
  if (unknown.length) console.log(`\nSkipped roles with a gamemode I don't recognise: ${unknown.join(", ")}`);
}

if (require.main === module) {
  main().catch((e) => { console.error("\nERROR: " + e.message); process.exitCode = 1; });
}

module.exports = { parseTierRole, buildPlayers };
