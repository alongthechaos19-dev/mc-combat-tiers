const MODES = [
  { key: "vanilla",    name: "Vanilla" },
  { key: "uhc",        name: "UHC" },
  { key: "pot",        name: "Pot" },
  { key: "nethop",     name: "NethOP" },
  { key: "smp",        name: "SMP" },
  { key: "sword",      name: "Sword" },
  { key: "axe",        name: "Axe" },
  { key: "mace",       name: "Mace" },
  { key: "spearmace",  name: "Spear Mace" },
  { key: "diamondsmp", name: "Diamond SMP" },
  { key: "cart",       name: "Cart" },
];

// Live data from the bot (instant updates). players.js is the backup if it can't be reached.
const LIVE_API = "https://mc-combat-tiers-bot.alongthechaos19.workers.dev/api/players";
const REFRESH_SECONDS = 60;

// Icon file for a gamemode (icons/<key>.png unless the mode sets its own)
const iconSrc = (m) => m.icon || `icons/${m.key}.png`;

// Points each tier is worth toward the overall ranking
const TIER_POINTS = { 1: 60, 2: 30, 3: 15, 4: 6, 5: 2 };

// Title shown under a player's name, by overall points (highest first)
const TITLES = [
  { min: 450, name: "Combat Grandmaster", cls: "grandmaster" },
  { min: 300, name: "Combat Master",      cls: "master" },
  { min: 250, name: "Combat Ace",         cls: "ace" },
  { min: 125, name: "Combat Specialist",  cls: "specialist" },
  { min: 50,  name: "Combat Cadet",       cls: "cadet" },
  { min: 20,  name: "Combat Novice",      cls: "novice" },
  { min: 0,   name: "Combat Rookie",      cls: "rookie" },
];

let players = typeof PLAYERS !== "undefined" ? PLAYERS : [];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const modeName = (key) => MODES.find((m) => m.key === key)?.name || key;

function points(p) {
  return Object.values(p.tiers || {}).reduce((sum, t) => sum + (TIER_POINTS[t] || 0), 0);
}

function titleFor(pts) {
  return TITLES.find((t) => pts >= t.min);
}

function titleTag(pts) {
  const t = titleFor(pts);
  return `<span class="title title-${t.cls}">${t.name}</span>`;
}

// Hover text for a tier: "Sword — Tier 3 · Peak: Tier 2"
function tierTip(p, key) {
  const t = p.tiers[key], peak = p.peak?.[key] || t;
  return `${modeName(key)} — Tier ${t} · Peak: Tier ${peak}`;
}

function head(name, size = 64) {
  const n = esc(name);
  return `<img class="head" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}" alt="${n}" loading="lazy"
    onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'head head-fallback',textContent:'${n.charAt(0).toUpperCase()}'}))">`;
}

function tierBadge(p, key) {
  const mode = MODES.find((m) => m.key === key);
  const t = p.tiers[key];
  return `<span class="badge t${t}" tabindex="0" data-tip="${esc(tierTip(p, key))}">
    ${mode ? `<img src="${iconSrc(mode)}" alt="">` : ""}T${t}</span>`;
}

function regionTag(r) {
  return r ? `<span class="region r-${esc(r.toLowerCase())}">${esc(r)}</span>` : "";
}

const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* ---------- Mode tabs ---------- */
function renderModes(active) {
  const tabs = [{ key: "overall", name: "Overall" }, ...MODES];
  $("#modes").innerHTML = tabs.map((m) => `
    <a href="#${m.key}" class="mode ${m.key === active ? "active" : ""}">
      ${m.key === "overall" ? `<span class="trophy">&#127942;</span>` : `<img src="${iconSrc(m)}" alt="">`}
      <span>${m.name}</span>
    </a>`).join("");
}

/* ---------- Overall leaderboard ---------- */
function renderOverall() {
  const ranked = players.map((p) => ({ ...p, pts: points(p) }))
    .filter((p) => p.pts > 0)
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));

  if (!ranked.length) return empty();

  $("#view").innerHTML = `
    <div class="board">
      <div class="board-head">
        <span>#</span><span>Player</span><span class="hide-sm">Region</span><span>Tiers</span>
      </div>
      ${ranked.map((p, i) => `
        <div class="row ${i < 3 ? "top top" + (i + 1) : ""}" role="button" tabindex="0" data-player="${esc(p.name)}">
          <span class="rank">${i + 1}.</span>
          <span class="who">${head(p.name, 48)}
            <span class="who-text"><b>${esc(p.name)}</b><small>${titleTag(p.pts)} · ${p.pts} points</small></span>
          </span>
          <span class="hide-sm">${regionTag(p.region)}</span>
          <span class="badges">${MODES.filter((m) => p.tiers[m.key]).map((m) => tierBadge(p, m.key)).join("")}</span>
        </div>`).join("")}
    </div>`;
}

/* ---------- Single gamemode: Tier 1-5 columns ---------- */
function renderMode(key) {
  const inMode = players.filter((p) => p.tiers && p.tiers[key]);
  if (!inMode.length) return empty();

  const cols = [1, 2, 3, 4, 5].map((t) => {
    const list = inMode.filter((p) => p.tiers[key] === t).sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div class="col">
        <div class="col-head t${t}">Tier ${t}</div>
        <div class="col-body">
          ${list.length ? list.map((p) => `
            <button class="chip" data-player="${esc(p.name)}" data-tip="${esc(tierTip(p, key))}">
              ${head(p.name, 32)}<span>${esc(p.name)}</span>${regionTag(p.region)}
            </button>`).join("") : `<div class="none">No players</div>`}
        </div>
      </div>`;
  }).join("");

  $("#view").innerHTML = `<div class="tiers">${cols}</div>`;
}

function empty() {
  $("#view").innerHTML = `<div class="empty">No players ranked here yet.</div>`;
}

/* ---------- Player modal ---------- */
let openName = null;

function openPlayer(name) {
  const p = players.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) return closeModal();
  openName = p.name;
  const ranked = players.map((x) => ({ n: x.name, pts: points(x) })).filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts || a.n.localeCompare(b.n));
  const pos = ranked.findIndex((x) => x.n === p.name) + 1;

  $("#modal-body").innerHTML = `
    <div class="pm-top">
      <img class="pm-body" src="https://mc-heads.net/body/${encodeURIComponent(p.name)}/120" alt="" onerror="this.style.display='none'">
      <h2>${esc(p.name)}</h2>
      ${titleTag(points(p))}
      ${regionTag(p.region)}
      <div class="pm-stats">
        <div><b>${pos ? "#" + pos : "—"}</b><small>Overall</small></div>
        <div><b>${points(p)}</b><small>Points</small></div>
      </div>
    </div>
    <div class="pm-grid">
      ${MODES.map((m) => {
        const t = p.tiers[m.key];
        const peak = p.peak?.[m.key];
        const retest = p.retest?.[m.key];
        const notes = [
          peak && peak !== t ? `Peak T${peak}` : "",
          retest ? `Retest ${shortDate(retest)}` : "",
        ].filter(Boolean).join(" · ");
        return `<a href="#${m.key}" class="pm-mode ${t ? "" : "unranked"}">
          <img src="${iconSrc(m)}" alt="">
          <span>${m.name}${notes ? `<small>${notes}</small>` : ""}</span>
          <b class="${t ? "t" + t : ""}">${t ? "T" + t : "—"}</b>
        </a>`;
      }).join("")}
    </div>`;
  $("#modal").hidden = false;
}

function closeModal() { $("#modal").hidden = true; openName = null; }

/* ---------- Search ---------- */
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const box = $("#search-results");
  if (!q) { box.innerHTML = ""; box.classList.remove("open"); return; }
  const hits = players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map((p) => `<button data-player="${esc(p.name)}">${head(p.name, 24)}${esc(p.name)}</button>`).join("")
    : `<div class="none">No player found</div>`;
  box.classList.add("open");
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-player]");
  if (btn) {
    openPlayer(btn.dataset.player);
    $("#search").value = "";
    $("#search-results").classList.remove("open");
    return;
  }
  if (e.target.closest(".pm-mode")) closeModal();
  if (e.target.id === "modal" || e.target.closest(".modal-close")) closeModal();
  if (!e.target.closest(".search")) $("#search-results").classList.remove("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && e.target.matches(".row[data-player]")) openPlayer(e.target.dataset.player);
});

/* ---------- Tooltip (peak tier on hover) ---------- */
function showTip(el) {
  const tip = $("#tip");
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const top = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
const hideTip = () => { $("#tip").hidden = true; };
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  el ? showTip(el) : hideTip();
});
document.addEventListener("focusin", (e) => { if (e.target.matches("[data-tip]")) showTip(e.target); });
document.addEventListener("focusout", hideTip);
window.addEventListener("scroll", hideTip, true);

/* ---------- Routing ---------- */
function route() {
  const key = location.hash.slice(1) || "overall";
  const valid = key === "overall" || MODES.some((m) => m.key === key);
  const active = valid ? key : "overall";
  renderModes(active);
  active === "overall" ? renderOverall() : renderMode(active);
}
window.addEventListener("hashchange", route);
route();

/* ---------- Live updates ---------- */
async function loadLive() {
  try {
    const res = await fetch(LIVE_API);
    if (!res.ok) return;
    const data = await res.json();
    if (JSON.stringify(data.players) === JSON.stringify(players)) return;
    players = data.players;
    route();
    if (openName) openPlayer(openName);
  } catch {
    // Bot unreachable: keep showing players.js
  }
}
loadLive();
setInterval(loadLive, REFRESH_SECONDS * 1000);
