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

import { MODE_NAMES, TITLES, buildPlayers, parseMode, parseTierRole, points, titleFor } from "../discord-sync/roles.js";

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

    // After a tier change: fix their rank role and let the website see it straight away
    const afterTierChange = async (msg) => {
      const userId = interaction.data.options?.find((o) => o.name === "player")?.value;
      if (userId) await syncMemberRankRole(env, interaction.guild_id, userId).catch(() => {});
      await caches.default.delete(new Request(new URL("/api/players", request.url)));
      return msg;
    };

    if (interaction.type === 2 && interaction.data.name === "tier") {
      // Reply "thinking..." right away (Discord only waits 3 seconds), then finish in the background
      ctx.waitUntil(
        handleTier(interaction, env)
          .then(afterTierChange)
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5 });
    }

    if (interaction.type === 2 && interaction.data.name === "announce") {
      ctx.waitUntil(
        handleAnnounce(interaction, env)
          .then(async (msg) => {
            await caches.default.delete(new Request(new URL("/api/players", request.url)));
            return msg;
          })
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5 });
    }

    if (interaction.type === 2 && interaction.data.name === "leaderboard") {
      ctx.waitUntil(
        handleLeaderboard(interaction, env)
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5 });
    }

    if (interaction.type === 2 && interaction.data.name === "wipe") {
      ctx.waitUntil(
        handleWipe(interaction, env)
          .then(afterTierChange)
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5 });
    }

    if (interaction.type === 2 && interaction.data.name === "username") {
      ctx.waitUntil(
        handleUsername(interaction, env)
          .then(async (msg) => {
            await caches.default.delete(new Request(new URL("/api/players", request.url)));
            return msg;
          })
          .catch((e) => "❌ " + e.message)
          .then((msg) => editReply(interaction, msg)),
      );
      return json({ type: 5, data: { flags: 64 } }); // only the person who used it sees the reply
    }

    return json({ type: 4, data: { content: "Unknown command.", flags: 64 } });
  },

  // Runs on the cron schedule in wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.allSettled([syncAllRankRoles(env), sendRetestReminders(env)]).then((results) => {
      for (const r of results) if (r.status === "rejected") console.error(r.reason);
    }));
  },
};

/* ---------- Rank roles (Combat Rookie ... Combat Grandmaster) ---------- */

// The rank a member should have from their tier roles, or null if they have no tiers
function rankFor(memberRoleIds, roles) {
  const best = {};
  for (const r of roles) {
    const t = memberRoleIds.includes(r.id) && parseTierRole(r.name);
    if (t && (!best[t.mode] || t.tier < best[t.mode])) best[t.mode] = t.tier;
  }
  return Object.keys(best).length ? titleFor(points(best)) : null;
}

// Gives the right rank role and removes any other rank roles. Returns how many roles changed.
async function applyRankRole(env, guildId, member, roles) {
  const rankRoles = roles.filter((r) => TITLES.some((t) => t.name === r.name));
  const want = rankRoles.find((r) => r.name === rankFor(member.roles, roles));
  const route = `/guilds/${guildId}/members/${member.user.id}/roles/`;
  let changes = 0;
  for (const r of rankRoles) {
    if (member.roles.includes(r.id) && r.id !== want?.id) { await discord(env, "DELETE", route + r.id, "Rank update"); changes++; }
  }
  if (want && !member.roles.includes(want.id)) { await discord(env, "PUT", route + want.id, "Rank update"); changes++; }
  return changes;
}

async function syncMemberRankRole(env, guildId, userId) {
  const [roles, member] = await Promise.all([
    discord(env, "GET", `/guilds/${guildId}/roles`),
    discord(env, "GET", `/guilds/${guildId}/members/${userId}`),
  ]);
  return applyRankRole(env, guildId, member, roles);
}

// Catches tier roles that were changed by hand in Discord
async function syncAllRankRoles(env) {
  const [roles, members] = await Promise.all([discord(env, "GET", `/guilds/${env.GUILD_ID}/roles`), fetchAllMembers(env)]);
  let changes = 0;
  for (const m of members) if (!m.user.bot) changes += await applyRankRole(env, env.GUILD_ID, m, roles);
  return changes;
}

/* ---------- Retest reminder DMs ---------- */

// DMs a player when their cooldown in a gamemode ends (once per test)
async function sendRetestReminders(env) {
  const cooldownMs = Number(env.COOLDOWN_DAYS) * DAY;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT h.user_id, h.mode, MAX(h.at) AS at FROM tier_history h WHERE h.tier > 0 GROUP BY h.user_id, h.mode",
  ).all();
  let sent = 0;
  for (const row of results) {
    const readyAt = row.at + cooldownMs;
    // Only cooldowns that ended in the last 2 days, so old tests don't all fire at once
    if (readyAt > now || readyAt < now - 2 * DAY) continue;
    const { meta } = await env.DB.prepare(
      "INSERT OR IGNORE INTO retest_reminders (user_id, mode, test_at, sent_at) VALUES (?, ?, ?, ?)",
    ).bind(row.user_id, row.mode, row.at, now).run();
    if (!meta?.changes) continue; // already reminded for this test
    try {
      const dm = await discord(env, "POST", "/users/@me/channels", null, { recipient_id: row.user_id });
      await discord(env, "POST", `/channels/${dm.id}/messages`, null, {
        content: `⏰ Your **${MODE_NAMES[row.mode]}** cooldown is over! You can retest in **MC Combat Tiers** now.`,
      });
      sent++;
    } catch {
      // DMs closed: skip, it's still marked as reminded
    }
  }
  return sent;
}

/* ---------- /announce set | clear (website banner) ---------- */

async function handleAnnounce(interaction, env) {
  const roles = await discord(env, "GET", `/guilds/${interaction.guild_id}/roles`);
  if (!hasAnyRole(interaction.member, roles, env.ANNOUNCE_ROLES)) throw new Error(`Only ${env.ANNOUNCE_ROLES} can use /announce.`);

  const sub = interaction.data.options?.[0];
  if (sub?.name === "clear") {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'announcement'").run();
    await logEvent(env, { title: "Announcement cleared", color: 0x8a90a6, description: `by <@${interaction.member.user.id}>` });
    return "🧹 The website announcement was removed.";
  }

  const text = String(sub?.options?.find((o) => o.name === "message")?.value || "").trim();
  if (!text) throw new Error("Write a message to announce.");
  const announcement = { text, by: interaction.member.user.username, at: Date.now() };
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('announcement', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(JSON.stringify(announcement)).run();

  await logEvent(env, { title: "Announcement posted", color: 0xf5c542, description: `by <@${interaction.member.user.id}>\n\n${text}` });
  return {
    embeds: [{
      title: "📢 Announcement",
      description: text,
      color: 0xf5c542,
      footer: { text: `Posted by ${announcement.by} · Also shown on mc-combat-tiers.pages.dev` },
    }],
  };
}

async function currentAnnouncement(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'announcement'").first();
  return row ? JSON.parse(row.value) : null;
}

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

  // Testers can give T3-T5 only. T1/T2 (giving them, or changing someone who has one) is HIGH_TIER_ROLES only.
  const highTierStaff = hasAnyRole(member, roles, env.HIGH_TIER_ROLES);
  if (!highTierStaff) {
    const current = roles
      .filter((r) => target.roles.includes(r.id) && parseTierRole(r.name)?.mode === mode)
      .map((r) => parseTierRole(r.name).tier);
    if (tier === 1 || tier === 2) {
      throw new Error(`Testers can give up to **T3**. Only ${env.HIGH_TIER_ROLES} can give **T${tier}**.`);
    }
    if (current.some((t) => t <= 2)) {
      throw new Error(`<@${userId}> is **T${Math.min(...current)} ${modeName}**. Only ${env.HIGH_TIER_ROLES} can change T1/T2 players.`);
    }
  }

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

  // Staff log: green = tier up, red = tier down / removed, gray = same
  const change = !tier ? `removed (was T${prevTier})` : prevTier ? `T${prevTier} → **T${tier}**` : `new: **T${tier}**`;
  const color = !tier || (prevTier && tier > prevTier) ? 0xef4444 : prevTier === tier ? 0x8a90a6 : 0x22c55e;
  await logEvent(env, {
    title: "Tier change",
    color,
    description: `<@${userId}> · **${modeName}**: ${change}`,
    fields: [
      { name: "Tester", value: `<@${tester.id}>`, inline: true },
      ...(opts.ignore_cooldown ? [{ name: "Cooldown", value: "Skipped", inline: true }] : []),
    ],
  });

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

  const [players, announcement] = await Promise.all([livePlayers(env), currentAnnouncement(env)]);
  const res = new Response(JSON.stringify({ players, announcement, updated: Date.now() }), {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${PLAYERS_CACHE_SECONDS}` },
  });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

// Everyone with a tier, from Discord roles + the DB (peak tiers, retest dates)
async function livePlayers(env) {
  const [roles, members, names, history, linked] = await Promise.all([
    discord(env, "GET", `/guilds/${env.GUILD_ID}/roles`),
    fetchAllMembers(env),
    fetch(env.SITE_URL + "/names.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    env.DB.prepare("SELECT user_id, mode, tier, prev_tier, at FROM tier_history").all(),
    env.DB.prepare("SELECT user_id, mc_name FROM usernames").all(),
  ]);
  delete names._comment;
  // Names set with /username win over names.json (buildPlayers checks user IDs first)
  for (const u of linked.results) names[u.user_id] = u.mc_name;

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
  return buildPlayers(roles, members, names, { staff: env.STAFF_ROLES, creator: env.CREATOR_ROLES }).players.map(({ id, ...p }) => {
    const peak = { ...p.tiers };
    for (const [m, t] of Object.entries(peaks[id] || {})) if (!peak[m] || t < peak[m]) peak[m] = t;
    const retest = {};
    for (const [m, at] of Object.entries(tested[id] || {})) if (at + cooldownMs > Date.now()) retest[m] = at + cooldownMs;
    return { ...p, peak, retest };
  });
}

/* ---------- /wipe (Owner only) ---------- */

async function handleWipe(interaction, env) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const userId = opts.player;
  const guildId = interaction.guild_id;
  const roles = await discord(env, "GET", `/guilds/${guildId}/roles`);

  if (!hasAnyRole(interaction.member, roles, env.WIPE_ROLES)) throw new Error(`Only ${env.WIPE_ROLES} can use /wipe.`);
  if (!opts.confirm) throw new Error("Nothing was wiped. Run it again with **confirm: True** to wipe them.");

  const target = interaction.data.resolved?.members?.[userId];
  if (!target) throw new Error("That person isn't in this server.");

  // Every tier role in every gamemode; regions and other roles stay
  const tierRoles = roles.filter((r) => target.roles.includes(r.id) && parseTierRole(r.name));
  const reason = `/wipe by ${interaction.member.user.username}`;
  for (const r of tierRoles) {
    await discord(env, "DELETE", `/guilds/${guildId}/members/${userId}/roles/${r.id}`, reason);
  }
  // History holds cooldowns and peak tiers
  const { meta } = await env.DB.prepare("DELETE FROM tier_history WHERE user_id = ?").bind(userId).run();

  const removed = tierRoles.map((r) => r.name).join(", ");
  await logEvent(env, {
    title: "Player wiped",
    color: 0xef4444,
    description: `<@${userId}> was wiped by <@${interaction.member.user.id}>`,
    fields: [
      { name: "Tier roles removed", value: removed || "None" },
      { name: "History cleared", value: `${meta?.changes ?? 0} entries (cooldowns and peaks)`, inline: true },
    ],
  });
  return `🧹 Wiped <@${userId}>: ` +
    (removed ? `removed ${tierRoles.length} tier role${tierRoles.length === 1 ? "" : "s"} (${removed})` : "no tier roles to remove") +
    ` and cleared ${meta?.changes ?? 0} history entr${meta?.changes === 1 ? "y" : "ies"} (cooldowns and peaks).`;
}

/* ---------- /username set | reset ---------- */

async function handleUsername(interaction, env) {
  const sub = interaction.data.options?.[0];
  const opts = Object.fromEntries((sub?.options || []).map((o) => [o.name, o.value]));
  const me = interaction.member.user.id;
  const target = opts.player || me;

  // Setting someone else's name is for Staff/Owner only
  if (target !== me) {
    const roles = await discord(env, "GET", `/guilds/${interaction.guild_id}/roles`);
    if (!hasAnyRole(interaction.member, roles, env.COOLDOWN_OVERRIDE_ROLES)) {
      throw new Error(`Only ${env.COOLDOWN_OVERRIDE_ROLES} can change someone else's username.`);
    }
  }
  const who = target === me ? "Your" : `<@${target}>'s`;

  if (sub?.name === "reset") {
    await env.DB.prepare("DELETE FROM usernames WHERE user_id = ?").bind(target).run();
    await logEvent(env, { title: "Username reset", color: 0x8a90a6, description: `<@${target}> · reset by <@${me}>` });
    return `✅ ${who} Minecraft username was removed. The website goes back to the default name.`;
  }

  const wanted = String(opts.name || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(wanted)) {
    throw new Error("That isn't a valid Minecraft username (3–16 letters, numbers or _).");
  }

  // Ask Mojang if the account exists, and use its exact capitalization
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(wanted)}`);
  if (res.status === 404 || res.status === 204) throw new Error(`There's no Minecraft account called **${wanted}**.`);
  const mcName = res.ok ? (await res.json()).name : wanted; // if Mojang is down, trust what they typed

  const taken = await env.DB.prepare("SELECT user_id FROM usernames WHERE mc_name = ? COLLATE NOCASE AND user_id != ?")
    .bind(mcName, target).first();
  if (taken) throw new Error(`**${mcName}** is already linked to <@${taken.user_id}>. Ask Staff if that's wrong.`);

  await env.DB.prepare(
    "INSERT INTO usernames (user_id, mc_name, set_by, at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET mc_name = excluded.mc_name, set_by = excluded.set_by, at = excluded.at",
  ).bind(target, mcName, me, Date.now()).run();

  await logEvent(env, {
    title: "Username set",
    color: 0x38bdf8,
    description: `<@${target}> → **${mcName}**` + (target !== me ? ` · set by <@${me}>` : ""),
  });
  return `✅ ${who} Minecraft username is now **${mcName}**. The website shows it right away.`;
}

/* ---------- /leaderboard ---------- */

const MEDALS = ["🥇", "🥈", "🥉"];
const LEADERBOARD_SIZE = 10;
// Names like "__gl1tch" would otherwise turn into Discord formatting
const escapeMd = (s) => s.replace(/([\\*_`~|>])/g, "\\$1");

async function handleLeaderboard(interaction, env) {
  const mode = interaction.data.options?.find((o) => o.name === "gamemode")?.value || "overall";
  const players = await livePlayers(env);
  const place = (i) => MEDALS[i] || `\`${i + 1}.\``;

  let title, lines, url, thumb;
  if (mode === "overall") {
    const ranked = players
      .map((p) => ({ ...p, pts: points(p.tiers) }))
      .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    title = "🏆 Overall leaderboard";
    lines = ranked.slice(0, LEADERBOARD_SIZE).map((p, i) =>
      `${place(i)} **${escapeMd(p.name)}** — ${p.pts} points · ${titleFor(p.pts)}`);
    url = env.SITE_URL;
    thumb = `${env.SITE_URL}/logo.png`;
  } else {
    const ranked = players
      .filter((p) => p.tiers[mode])
      .sort((a, b) => a.tiers[mode] - b.tiers[mode] || a.name.localeCompare(b.name));
    title = `${MODE_NAMES[mode]} leaderboard`;
    lines = ranked.slice(0, LEADERBOARD_SIZE).map((p, i) =>
      `${place(i)} **${escapeMd(p.name)}** — Tier ${p.tiers[mode]}`);
    url = `${env.SITE_URL}/#${mode}`;
    thumb = `${env.SITE_URL}/icons/${mode}.png`;
  }

  return {
    embeds: [{
      title,
      url,
      color: 0xf5c542,
      thumbnail: { url: thumb },
      description: lines.length ? lines.join("\n") : "Nobody is ranked here yet.",
      footer: { text: "Full rankings at mc-combat-tiers.pages.dev" },
    }],
  };
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

/* ---------- Staff log channel ---------- */

// Posts an embed in LOG_CHANNEL_ID. Never throws: a broken log channel must not break commands.
async function logEvent(env, embed) {
  if (!env.LOG_CHANNEL_ID) return;
  try {
    await discord(env, "POST", `/channels/${env.LOG_CHANNEL_ID}/messages`, null, {
      embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      allowed_mentions: { parse: [] },
    });
  } catch (e) {
    console.error("Staff log failed:", e.message);
  }
}

/* ---------- Discord helpers ---------- */

async function discord(env, method, route, reason, body) {
  const headers = { Authorization: `Bot ${env.DISCORD_TOKEN}` };
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason);
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(API + route, { method, headers, body: body && JSON.stringify(body) });
  if (res.ok) return res.status === 204 ? null : res.json();
  if (res.status === 401) throw new Error("The bot token is wrong. Update the DISCORD_TOKEN secret in Cloudflare.");
  if (res.status === 403) {
    throw new Error("I'm not allowed to change that role. Give the bot **Manage Roles** and drag its role " +
      "**above** all the tier roles in Server Settings → Roles.");
  }
  throw new Error(`Discord error ${res.status}: ${await res.text()}`);
}

// reply is either text or a message object like { embeds: [...] }
async function editReply(interaction, reply) {
  const message = typeof reply === "string" ? { content: reply } : reply;
  await fetch(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
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
