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
  console.log("Registered /tier in your server.");

  const tomlFile = path.join(__dirname, "wrangler.toml");
  const toml = fs.readFileSync(tomlFile, "utf8").replace(/DISCORD_PUBLIC_KEY = ".*"/, `DISCORD_PUBLIC_KEY = "${app.verify_key}"`);
  fs.writeFileSync(tomlFile, toml);
  console.log("Saved the bot's public key to wrangler.toml.");
})().catch((e) => { console.error("ERROR: " + e.message); process.exitCode = 1; });
