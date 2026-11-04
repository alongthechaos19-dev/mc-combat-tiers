// ============================================================
//  MC Combat Tiers — bot + live data (runs on Cloudflare Workers)
//
//  POST /            Discord slash commands:
//    /tier player:@someone gamemode:Sword tier:3 [ignore_cooldown]
//      -> gives them "T3 - Sword" and removes their other Sword tier
//         roles. Other gamemodes and regions are never touched.
//         Every result is saved to the DB for peak tiers + cooldowns.
//
//  GET /api/players  Live player list for the website, built from
//                    Discord roles + the DB (peak tiers, last tested).
//
//  Discord sends commands here as web requests. We check they
//  really came from Discord, check the person is a tester, then
//  change the roles with the bot token (DISCORD_TOKEN secret).
// ============================================================

import { MODE_NAMES, buildPlayers, parseMode, parseTierRole } from "../discord-sync/roles.js";

const API = "https://discord.com/api/v10";
const DAY = 24 * 60 * 60 * 1000;
const PLAYERS_CACHE_SECONDS = 20;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/players") return playersApi(request, env, ctx);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return new Response("MC Combat Tiers bot is running.");

    const body = await request.text();
    const ok = await verifySignature(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get("X-Signature-Ed25519"),
      request.headers.get("X-Signature-Timestamp"),
      body,
    );
    if (!ok) return new Response("Bad request signature", { status: 401 });

    const interaction = JSON.parse(body);

    // Discord checking that we're online
    if (interaction.type === 1) return json({ type: 1 });

    if (interaction.type === 2 && interaction.data.name === "tier") {
      // Reply "thinking..." right away (Discord only waits 3 seconds), then finish in the background
      ctx.waitUntil(
        handleTier(interaction, env)
          .then(async (msg) => {
            // The website should see the change straight away
            await caches.default.delete(new Request(new URL("/api/players", request.url)));
            return msg;
          })
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5 });
    }

    return json({ type: 4, data: { content: "Unknown command.", flags: 64 } });
  },
};

/* ---------- /tier ---------- */

async function handleTier(interaction, env) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const userId = opts.player;
  const mode = opts.gamemode;
  const tier = Number(opts.tier); // 0 = remove their tier in this gamemode
  const guildId = interaction.guild_id;
  if (!guildId) throw new Error("Use this command in the server, not in DMs.");

  const roles = await discord(env, "GET", `/guilds/${guildId}/roles`);
  const member = interaction.member;

  if (!canTier(member, roles, mode, env)) {
    const testerRole = roles.find((r) => testerRoleMode(r.name, env) === mode)?.name ||
      `${env.TESTER_ROLE_PREFIX} - ${MODE_NAMES[mode]}`;
    throw new Error(`Only testers can use this. You need **${testerRole}** (or one of: ${env.ALL_MODES_ROLES}).`);
  }

  const target = interaction.data.resolved?.members?.[userId];
  if (!target) throw new Error("That person isn't in this server.");

  const modeName = MODE_NAMES[mode];

  // Cooldown: only a real test (not a removal) is blocked, and Staff/Owner can skip it
  if (tier) {
    const last = await env.DB.prepare(
      "SELECT MAX(at) AS at FROM tier_history WHERE user_id = ? AND mode = ? AND tier > 0",
    ).bind(userId, mode).first();
    const readyAt = last?.at ? last.at + Number(env.COOLDOWN_DAYS) * DAY : 0;
    if (readyAt > Date.now()) {
      if (!opts.ignore_cooldown) {
        throw new Error(`<@${userId}> was tested in **${modeName}** <t:${Math.floor(last.at / 1000)}:R>. ` +
          `They can retest <t:${Math.floor(readyAt / 1000)}:R> (<t:${Math.floor(readyAt / 1000)}:D>).`);
      }
      if (!hasAnyRole(member, roles, env.COOLDOWN_OVERRIDE_ROLES)) {
        throw new Error(`Only ${env.COOLDOWN_OVERRIDE_ROLES} can use **ignore_cooldown**.`);
      }
    }
  }

  // Every tier role for the chosen gamemode, e.g. T1 - Sword ... T5 - Sword
  const modeRoles = roles.filter((r) => parseTierRole(r.name)?.mode === mode);
  const newRole = tier ? modeRoles.find((r) => parseTierRole(r.name).tier === tier) : null;
  if (tier && !newRole) throw new Error(`There's no "T${tier} - ${modeName}" role in this server.`);

  // Only roles from this one gamemode are removed
  const toRemove = modeRoles.filter((r) => target.roles.includes(r.id) && r.id !== newRole?.id);
  const tester = member.user;
  const reason = `/tier by ${tester.username}`;
  const prevTier = modeRoles
    .filter((r) => target.roles.includes(r.id))
    .map((r) => parseTierRole(r.name).tier)
    .sort((a, b) => a - b)[0] ?? null;

  if (!tier && !toRemove.length) return `<@${userId}> didn't have a **${modeName}** tier.`;

  for (const r of toRemove) {
    await discord(env, "DELETE", `/guilds/${guildId}/members/${userId}/roles/${r.id}`, reason);
  }
  if (newRole && !target.roles.includes(newRole.id)) {
    await discord(env, "PUT", `/guilds/${guildId}/members/${userId}/roles/${newRole.id}`, reason);
  }

  // A retest that keeps the same tier still counts as a test (restarts the cooldown)
  await env.DB.prepare(
    "INSERT INTO tier_history (user_id, mode, tier, prev_tier, tester_id, at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(userId, mode, tier, prevTier, tester.id, Date.now()).run();

  const oldTiers = toRemove.map((r) => "T" + parseTierRole(r.name).tier).join(", ");
  if (!tier) return `🗑️ Removed <@${userId}>'s **${modeName}** tier (was ${oldTiers}).`;
  if (!toRemove.length && target.roles.includes(newRole.id)) {
    return `✅ <@${userId}> stays **T${tier} ${modeName}**.\nTested by <@${tester.id}>.`;
  }
  return `✅ <@${userId}> is now **T${tier} ${modeName}**` + (oldTiers ? ` (was ${oldTiers}).` : ".") +
    `\nTested by <@${tester.id}>. The website is already updated.`;
}

// Allowed: anyone with an ALL_MODES_ROLES role, or "Verified Tester - <gamemode>" for that gamemode only.
// Nobody else — not even people with admin permissions.
function canTier(member, roles, mode, env) {
  return hasAnyRole(member, roles, env.ALL_MODES_ROLES) ||
    roles.some((r) => member.roles.includes(r.id) && testerRoleMode(r.name, env) === mode);
}

// list = "Owner, Staff" (exact role names, any case)
function hasAnyRole(member, roles, list) {
  const wanted = list.split(",").map((s) => s.trim().toLowerCase());
  return roles.some((r) => member.roles.includes(r.id) && wanted.includes(r.name.trim().toLowerCase()));
}

// "Verified Tester - Diamond Pot" -> "pot"
function testerRoleMode(roleName, env) {
  const name = roleName.trim();
  const prefix = env.TESTER_ROLE_PREFIX;
  if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return parseMode(name.slice(prefix.length).replace(/^\s*[-–—:|]?\s*/, ""));
}

/* ---------- /api/players (live data for the website) ---------- */

async function playersApi(request, env, ctx) {
  const cacheKey = new Request(new URL("/api/players", request.url));
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const [roles, members, names, history] = await Promise.all([
    discord(env, "GET", `/guilds/${env.GUILD_ID}/roles`),
    fetchAllMembers(env),
    fetch(env.SITE_URL + "/names.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    env.DB.prepare("SELECT user_id, mode, tier, prev_tier, at FROM tier_history").all(),
  ]);
  delete names._comment;

  // Best tier ever held (lower = better) and when they were last tested, per player + gamemode
  const peaks = {}, tested = {};
  for (const h of history.results) {
    const p = (peaks[h.user_id] ||= {});
    for (const t of [h.tier, h.prev_tier]) if (t > 0 && (!p[h.mode] || t < p[h.mode])) p[h.mode] = t;
    if (h.tier > 0) {
      const l = (tested[h.user_id] ||= {});
      if (!l[h.mode] || h.at > l[h.mode]) l[h.mode] = h.at;
    }
  }

  const cooldownMs = Number(env.COOLDOWN_DAYS) * DAY;
  const players = buildPlayers(roles, members, names).players.map(({ id, ...p }) => {
    const peak = { ...p.tiers };
    for (const [m, t] of Object.entries(peaks[id] || {})) if (!peak[m] || t < peak[m]) peak[m] = t;
    const retest = {};
    for (const [m, at] of Object.entries(tested[id] || {})) if (at + cooldownMs > Date.now()) retest[m] = at + cooldownMs;
    return { ...p, peak, retest };
  });

  const res = new Response(JSON.stringify({ players, updated: Date.now() }), {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${PLAYERS_CACHE_SECONDS}` },
  });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

async function fetchAllMembers(env) {
  const all = [];
  let after = "0";
  for (;;) {
    const page = await discord(env, "GET", `/guilds/${env.GUILD_ID}/members?limit=1000&after=${after}`);
    all.push(...page);
    if (page.length < 1000) return all;
    after = page[page.length - 1].user.id;
  }
}

/* ---------- Discord helpers ---------- */

async function discord(env, method, route, reason) {
  const headers = { Authorization: `Bot ${env.DISCORD_TOKEN}` };
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason);
  const res = await fetch(API + route, { method, headers });
  if (res.ok) return res.status === 204 ? null : res.json();
  if (res.status === 401) throw new Error("The bot token is wrong. Update the DISCORD_TOKEN secret in Cloudflare.");
  if (res.status === 403) {
    throw new Error("I'm not allowed to change that role. Give the bot **Manage Roles** and drag its role " +
      "**above** all the tier roles in Server Settings → Roles.");
  }
  throw new Error(`Discord error ${res.status}: ${await res.text()}`);
}

async function editReply(interaction, content) {
  await fetch(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

async function verifySignature(publicKey, signature, timestamp, body) {
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const hex = (s) => new Uint8Array(s.match(/.{2}/g).map((b) => parseInt(b, 16)));
const json = (data) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
