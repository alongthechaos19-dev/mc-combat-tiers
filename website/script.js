const MODES = [
  { key: "vanilla",    name: "Vanilla" },
  { key: "uhc",        name: "UHC" },
  { key: "pot",        name: "Pot" },
  { key: "nethop",     name: "NethOP" },
  { key: "smp",        name: "SMP" },
  { key: "sword",      name: "Sword" },
  { key: "axe",        name: "Axe" },
  { key: "mace",       name: "Mace" },
  { key: "diamondsmp", name: "Diamond SMP" },
  { key: "cart",       name: "Cart" },
];

// Points each tier is worth toward the overall ranking
const TIER_POINTS = { 1: 60, 2: 30, 3: 15, 4: 6, 5: 2 };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function points(p) {
  return Object.values(p.tiers || {}).reduce((sum, t) => sum + (TIER_POINTS[t] || 0), 0);
}

function head(name, size = 64) {
  const n = esc(name);
  return `<img class="head" src="https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}" alt="${n}" loading="lazy"
    onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'head head-fallback',textContent:'${n.charAt(0).toUpperCase()}'}))">`;
}

function tierBadge(t, modeKey) {
  const mode = MODES.find((m) => m.key === modeKey);
  return `<span class="badge t${t}" title="${mode ? mode.name : ""} — Tier ${t}">
    ${mode ? `<img src="icons/${mode.key}.png" alt="">` : ""}T${t}</span>`;
}

function regionTag(r) {
  return r ? `<span class="region r-${esc(r.toLowerCase())}">${esc(r)}</span>` : "";
}

/* ---------- Mode tabs ---------- */
function renderModes(active) {
  const tabs = [{ key: "overall", name: "Overall" }, ...MODES];
  $("#modes").innerHTML = tabs.map((m) => `
    <a href="#${m.key}" class="mode ${m.key === active ? "active" : ""}">
      ${m.key === "overall" ? `<span class="trophy">&#127942;</span>` : `<img src="icons/${m.key}.png" alt="">`}
      <span>${m.name}</span>
    </a>`).join("");
}

/* ---------- Overall leaderboard ---------- */
function renderOverall() {
  const ranked = PLAYERS.map((p) => ({ ...p, pts: points(p) }))
    .filter((p) => p.pts > 0)
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));

  if (!ranked.length) return empty();

  $("#view").innerHTML = `
    <div class="board">
      <div class="board-head">
        <span>#</span><span>Player</span><span class="hide-sm">Region</span><span>Tiers</span>
      </div>
      ${ranked.map((p, i) => `
        <button class="row ${i < 3 ? "top top" + (i + 1) : ""}" data-player="${esc(p.name)}">
          <span class="rank">${i + 1}.</span>
          <span class="who">${head(p.name, 48)}
            <span class="who-text"><b>${esc(p.name)}</b><small>${p.pts} points</small></span>
          </span>
          <span class="hide-sm">${regionTag(p.region)}</span>
          <span class="badges">${MODES.filter((m) => p.tiers[m.key]).map((m) => tierBadge(p.tiers[m.key], m.key)).join("")}</span>
        </button>`).join("")}
    </div>`;
}

/* ---------- Single gamemode: Tier 1-5 columns ---------- */
function renderMode(key) {
  const inMode = PLAYERS.filter((p) => p.tiers && p.tiers[key]);
  if (!inMode.length) return empty();

  const cols = [1, 2, 3, 4, 5].map((t) => {
    const list = inMode.filter((p) => p.tiers[key] === t).sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div class="col">
        <div class="col-head t${t}">Tier ${t}</div>
        <div class="col-body">
          ${list.length ? list.map((p) => `
            <button class="chip" data-player="${esc(p.name)}">
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
function openPlayer(name) {
  const p = PLAYERS.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) return;
  const ranked = PLAYERS.map((x) => ({ n: x.name, pts: points(x) })).filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts || a.n.localeCompare(b.n));
  const pos = ranked.findIndex((x) => x.n === p.name) + 1;

  $("#modal-body").innerHTML = `
    <div class="pm-top">
      <img class="pm-body" src="https://mc-heads.net/body/${encodeURIComponent(p.name)}/120" alt="" onerror="this.style.display='none'">
      <h2>${esc(p.name)}</h2>
      ${regionTag(p.region)}
      <div class="pm-stats">
        <div><b>${pos ? "#" + pos : "—"}</b><small>Overall</small></div>
        <div><b>${points(p)}</b><small>Points</small></div>
      </div>
    </div>
    <div class="pm-grid">
      ${MODES.map((m) => {
        const t = p.tiers[m.key];
        return `<a href="#${m.key}" class="pm-mode ${t ? "" : "unranked"}">
          <img src="icons/${m.key}.png" alt="">
          <span>${m.name}</span>
          <b class="${t ? "t" + t : ""}">${t ? "T" + t : "—"}</b>
        </a>`;
      }).join("")}
    </div>`;
  $("#modal").hidden = false;
}

function closeModal() { $("#modal").hidden = true; }

/* ---------- Search ---------- */
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const box = $("#search-results");
  if (!q) { box.innerHTML = ""; box.classList.remove("open"); return; }
  const hits = PLAYERS.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

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
