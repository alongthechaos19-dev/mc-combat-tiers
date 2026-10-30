// ============================================================
//  MC Combat Tiers — /tier command bot (runs on Cloudflare Workers)
//
//  /tier player:@someone gamemode:Sword tier:3
//    -> gives them "T3 - Sword" and removes their other Sword tier
//       roles. Other gamemodes and regions are never touched.
//
//  Discord sends each command here as a web request. We check it
//  really came from Discord, check the person is a tester, then
//  change the roles with the bot token (DISCORD_TOKEN secret).
// ============================================================

import { MODE_NAMES, parseMode, parseTierRole } from "../discord-sync/roles.js";

const API = "https://discord.com/api/v10";

export default {
  async fetch(request, env, ctx) {
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
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5 });
    }

    return json({ type: 4, data: { content: "Unknown command.", flags: 64 } });
  },
};

async function handleTier(interaction, env) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const userId = opts.player;
  const mode = opts.gamemode;
  const tier = Number(opts.tier); // 0 = remove their tier in this gamemode
  const guildId = interaction.guild_id;
  if (!guildId) throw new Error("Use this command in the server, not in DMs.");

  const roles = await discord(env, "GET", `/guilds/${guildId}/roles`);

  if (!canTier(interaction.member, roles, mode, env)) {
    const testerRole = roles.find((r) => testerRoleMode(r.name, env) === mode)?.name ||
      `${env.TESTER_ROLE_PREFIX} - ${MODE_NAMES[mode]}`;
    throw new Error(`Only testers can use this. You need **${testerRole}** (or one of: ${env.ALL_MODES_ROLES}).`);
  }

  const target = interaction.data.resolved?.members?.[userId];
  if (!target) throw new Error("That person isn't in this server.");

  // Every tier role for the chosen gamemode, e.g. T1 - Sword ... T5 - Sword
  const modeRoles = roles.filter((r) => parseTierRole(r.name)?.mode === mode);
  const newRole = tier ? modeRoles.find((r) => parseTierRole(r.name).tier === tier) : null;
  if (tier && !newRole) throw new Error(`There's no "T${tier} - ${MODE_NAMES[mode]}" role in this server.`);

  // Only roles from this one gamemode are removed
  const toRemove = modeRoles.filter((r) => target.roles.includes(r.id) && r.id !== newRole?.id);
  const tester = interaction.member.user;
  const reason = `/tier by ${tester.username}`;

  for (const r of toRemove) {
    await discord(env, "DELETE", `/guilds/${guildId}/members/${userId}/roles/${r.id}`, reason);
  }
  if (newRole && !target.roles.includes(newRole.id)) {
    await discord(env, "PUT", `/guilds/${guildId}/members/${userId}/roles/${newRole.id}`, reason);
  }

  const oldTiers = toRemove.map((r) => "T" + parseTierRole(r.name).tier).join(", ");
  const modeName = MODE_NAMES[mode];
  if (!tier) {
    return oldTiers
      ? `🗑️ Removed <@${userId}>'s **${modeName}** tier (was ${oldTiers}).`
      : `<@${userId}> didn't have a **${modeName}** tier.`;
  }
  if (!toRemove.length && target.roles.includes(newRole.id)) {
    return `<@${userId}> is already **T${tier} ${modeName}**.`;
  }
  return `✅ <@${userId}> is now **T${tier} ${modeName}**` + (oldTiers ? ` (was ${oldTiers}).` : ".") +
    `\nTested by <@${tester.id}>. The website updates within ~15 minutes.`;
}

// Allowed: anyone with an ALL_MODES_ROLES role, or "Verified Tester - <gamemode>" for that gamemode only.
// Nobody else — not even people with admin permissions.
function canTier(member, roles, mode, env) {
  const allModes = env.ALL_MODES_ROLES.split(",").map((s) => s.trim().toLowerCase());
  const mine = roles.filter((r) => member.roles.includes(r.id)).map((r) => r.name.trim());
  return mine.some((name) => allModes.includes(name.toLowerCase()) || testerRoleMode(name, env) === mode);
}

// "Verified Tester - Diamond Pot" -> "pot"
function testerRoleMode(roleName, env) {
  const name = roleName.trim();
  const prefix = env.TESTER_ROLE_PREFIX;
  if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return parseMode(name.slice(prefix.length).replace(/^\s*[-–—:|]?\s*/, ""));
}

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

const hex = (s) => new Uint8Array(s.match(/.{2}/g).map((b) => parseInt(b, 16)));
const json = (data) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
