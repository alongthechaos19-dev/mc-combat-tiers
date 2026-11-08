// Creates the rank roles (Combat Rookie ... Combat Grandmaster) in your server if they're missing.
// Safe to run again: roles that already exist are left alone.
// Uses the token + server ID saved in ../discord-sync/config.json.

const fs = require("fs");
const path = require("path");
const { TITLES } = require("../discord-sync/roles");

const API = "https://discord.com/api/v10";
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "discord-sync", "config.json"), "utf8"));

// Same colors the website uses for each title
const COLORS = {
  "Combat Grandmaster": 0xf5c542, "Combat Master": 0xfb923c, "Combat Ace": 0xc084fc,
  "Combat Specialist": 0x38bdf8, "Combat Cadet": 0x34d399, "Combat Novice": 0x9fb7d9, "Combat Rookie": 0x8a90a6,
};

async function discord(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { Authorization: `Bot ${config.token}`, "Content-Type": "application/json", "X-Audit-Log-Reason": "MC Combat Tiers rank roles" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord error ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  const roles = await discord("GET", `/guilds/${config.serverId}/roles`);
  // Lowest rank first, so Grandmaster ends up on top
  for (const t of [...TITLES].reverse()) {
    if (roles.some((r) => r.name === t.name)) { console.log(`exists   ${t.name}`); continue; }
    await discord("POST", `/guilds/${config.serverId}/roles`, { name: t.name, color: COLORS[t.name], hoist: false, mentionable: false, permissions: "0" });
    console.log(`created  ${t.name}`);
  }
})().catch((e) => { console.error("ERROR: " + e.message); process.exitCode = 1; });
