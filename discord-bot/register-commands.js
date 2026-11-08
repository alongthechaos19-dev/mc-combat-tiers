// Tells Discord about the /tier command (only needs running once, or after changing it).
// Uses the token + server ID saved in ../discord-sync/config.json.
// Also writes the bot's public key into wrangler.toml.

const fs = require("fs");
const path = require("path");
const { MODE_ORDER, MODE_NAMES } = require("../discord-sync/roles");

const API = "https://discord.com/api/v10";
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "discord-sync", "config.json"), "utf8"));

const COMMANDS = [
  {
    name: "tier",
    description: "Set the tier a player got in a gamemode",
    contexts: [0], // servers only
    options: [
      { type: 6, name: "player", description: "The player you tested", required: true },
      {
        type: 3, name: "gamemode", description: "Gamemode they were tested in", required: true,
        choices: MODE_ORDER.map((k) => ({ name: MODE_NAMES[k], value: k })),
      },
      {
        type: 4, name: "tier", description: "Their new tier", required: true,
        choices: [1, 2, 3, 4, 5].map((n) => ({ name: `Tier ${n}`, value: n }))
          .concat({ name: "Remove tier", value: 0 }),
      },
      { type: 5, name: "ignore_cooldown", description: "Staff/Owner only: retest before the cooldown is over", required: false },
    ],
  },
  {
    name: "leaderboard",
    description: "Show the top 10 players overall or in a gamemode",
    contexts: [0],
    options: [
      {
        type: 3, name: "gamemode", description: "Leave empty for overall", required: false,
        choices: [{ name: "Overall", value: "overall" }].concat(MODE_ORDER.map((k) => ({ name: MODE_NAMES[k], value: k }))),
      },
    ],
  },
  {
    name: "announce",
    description: "Owner/Administrator only: post an announcement here and on the website",
    contexts: [0],
    options: [
      {
        type: 1, name: "set", description: "Post a new announcement (replaces the old one)",
        options: [{ type: 3, name: "message", description: "What to announce", required: true, max_length: 300 }],
      },
      { type: 1, name: "clear", description: "Remove the announcement from the website" },
    ],
  },
  {
    name: "wipe",
    description: "Owner only: remove all of a player's tiers, cooldowns and peaks",
    contexts: [0],
    options: [
      { type: 6, name: "player", description: "Who to wipe", required: true },
      { type: 5, name: "confirm", description: "Set to True to really wipe them", required: true },
    ],
  },
  {
    name: "username",
    description: "Set the Minecraft username shown on the website",
    contexts: [0],
    options: [
      {
        type: 1, name: "set", description: "Set your Minecraft username",
        options: [
          { type: 3, name: "name", description: "Your Minecraft username", required: true, min_length: 3, max_length: 16 },
          { type: 6, name: "player", description: "Staff/Owner only: set it for someone else", required: false },
        ],
      },
      {
        type: 1, name: "reset", description: "Go back to showing your Discord name",
        options: [{ type: 6, name: "player", description: "Staff/Owner only: reset someone else", required: false }],
      },
    ],
  },
];

async function discord(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { Authorization: `Bot ${config.token}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord error ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  const app = await discord("GET", "/applications/@me");
  await discord("PUT", `/applications/${app.id}/guilds/${config.serverId}/commands`, COMMANDS);
  console.log("Registered " + COMMANDS.map((c) => "/" + c.name).join(", ") + " in your server.");

  const tomlFile = path.join(__dirname, "wrangler.toml");
  const toml = fs.readFileSync(tomlFile, "utf8").replace(/DISCORD_PUBLIC_KEY = ".*"/, `DISCORD_PUBLIC_KEY = "${app.verify_key}"`);
  fs.writeFileSync(tomlFile, toml);
  console.log("Saved the bot's public key to wrangler.toml.");
})().catch((e) => { console.error("ERROR: " + e.message); process.exitCode = 1; });
