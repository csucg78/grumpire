const state = {
  manifest: null,
  avatarIndex: {},
  playerCache: {},
  leaderboardByYear: {},
  leaderboard: [],
  selectedYear: "2026",
  sortCol: "tol_acc_pct",
  sortAsc: true, // true = ascending (worst tol_acc_pct first)
  searchQuery: "",
  photoOnly: false,
  activeGame: null,
  pitchFilter: "ALL", // ALL | MISSED | CHAL
};

const AA_NO_HAWKEYE_TIP = "Hawk-Eye optical tracking is not installed at Double-A ballparks.";
const els = {
  totals: document.getElementById("seasonTotals"),
  yearSelect: document.getElementById("yearSelect"),
  dateSelect: document.getElementById("dateSelect"),
  dateControls: document.getElementById("dateControls"),
  leaderControls: document.getElementById("leaderControls"),
  slateView: document.getElementById("slateView"),
  leaderboardView: document.getElementById("leaderboardView"),
  badUmpsView: document.getElementById("badUmpsView"),
  badUmpsGrid: document.getElementById("badUmpsGrid"),
  gamesList: document.getElementById("gamesList"),
  scorecardPanel: document.getElementById("scorecardPanel"),
  leaderboardViz: document.getElementById("leaderboardViz"),
  leaderboardBody: document.getElementById("leaderboardBody"),
  levelFilter: document.getElementById("levelFilter"),
  minPitches: document.getElementById("minPitches"),
  umpSearchInput: document.getElementById("umpSearchInput"),
  umpModal: document.getElementById("umpModal"),
  umpModalCard: document.getElementById("umpModalCard"),
  playerModal: document.getElementById("playerModal"),
  playerModalCard: document.getElementById("playerModalCard"),
  metricTipBar: document.getElementById("metricTipBar"),
  metricTipText: document.getElementById("metricTipText"),
};

function umpAvatarUrl(umpId, umpName = "") {
  const cached = state.avatarIndex?.[String(umpId)];
  if (cached?.photo) {
    return cached.photo;
  }
  const initials = (umpName || "U")
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#1e293b"/><path d="M18 32c0-11 9.5-18 22-18s22 7 22 18H18z" fill="#0f172a"/><path d="M12 31h56v4H12z" fill="#334155"/><text x="40" y="56" text-anchor="middle" fill="#f8fafc" font-family="Inter,Arial,sans-serif" font-size="22" font-weight="800">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function fetchWikiUmpirePhoto(umpName, imgEl, linkContainerEl, umpId = "") {
  const cached = state.avatarIndex?.[String(umpId)];
  if (cached) {
    if (cached.photo && imgEl) imgEl.src = cached.photo;
    if (cached.wiki_url && linkContainerEl) {
      const a = document.createElement("a");
      a.href = cached.wiki_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "📖 Wikipedia Bio ↗";
      linkContainerEl.prepend(a);
    }
    return;
  }
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`"${umpName}" umpire`)}&gsrlimit=1&prop=pageimages|info|extracts&exintro=1&explaintext=1&inprop=url&pithumbsize=240&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return;
    const first = Object.values(pages)[0];
    const extract = (first?.extract || "").toLowerCase();
    // Verify the Wikipedia article is actually about a baseball umpire (avoiding namesake players/actors)
    if (
      first &&
      first.title &&
      first.title.toLowerCase() === umpName.toLowerCase() &&
      extract.includes("umpire")
    ) {
      if (first.thumbnail?.source && imgEl) {
        imgEl.src = first.thumbnail.source;
      }
      if (first.fullurl && linkContainerEl) {
        const a = document.createElement("a");
        a.href = first.fullurl;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "📖 Wikipedia Bio ↗";
        linkContainerEl.prepend(a);
      }
    }
  } catch {
    // Keep stylized SVG cap badge if no verified Wikipedia umpire photo exists
  }
}

function umpProfileLinks(umpId, umpName) {
  const photosUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`"${umpName}" umpire baseball`)}`;
  const webUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${umpName}" MiLB MLB umpire`)}`;
  const ccsUrl = `https://www.closecallsports.com/search?q=${encodeURIComponent(umpName)}`;
  const bRefUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(umpName)}`;
  return { photosUrl, webUrl, ccsUrl, bRefUrl };
}

function fmt1(val) {
  return Number(val).toFixed(1);
}

function accColor(pct) {
  if (pct < 89.5) return "#dc2626"; // High grump (red)
  if (pct < 92.5) return "#d97706"; // Mid (amber)
  return "#15803d";                 // Sharp (green)
}

function grumpBadge(pct, csPct = null) {
  if (pct === null || pct === undefined) {
    // Double-A ungraded split: show neutral AA zone badge or Miriam pips based on zone deviation
    const label = csPct !== null && csPct !== undefined ? `AA (${fmt1(csPct)}% CS)` : "AA Split";
    return `<span class="badge" title="${AA_NO_HAWKEYE_TIP}" data-tip="${AA_NO_HAWKEYE_TIP}">${label}</span>`;
  }
  let count = 1;
  if (pct < 88.5) count = 5;
  else if (pct < 90.0) count = 4;
  else if (pct < 91.5) count = 3;
  else if (pct < 93.0) count = 2;

  const pips = Array.from(
    { length: count },
    () => `<img src="./favicon.png" alt="Miriam" class="miriam-pip" width="20" height="20" />`
  ).join("");

  return `<span class="grump-pill" title="${count}/5 Miriam Grumpiness Rating (${fmt1(pct)}% Acc — more Miriams = worse)" aria-label="${count} out of 5 Miriams">${pips}</span>`;
}

function naDashHtml() {
  return `<span class="na-dash" title="${AA_NO_HAWKEYE_TIP}" data-tip="${AA_NO_HAWKEYE_TIP}">—</span>`;
}

function renderAaHeatmapSvg(heatmap) {
  if (!heatmap || !heatmap.cells) return "";
  const n = heatmap.grid_size || 6;
  const size = 220;
  const cellW = size / n;
  let rects = "";

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = heatmap.cells[r]?.[c] || { taken: 0, cs: 0, cs_pct: null };
      const rate = cell.cs_pct;
      let fill = "#f3f2ee";
      let textFill = "#5e5d59";
      if (rate !== null && cell.taken > 0) {
        // Color scale from cool blue (0% CS) -> amber (50% CS) -> deep crimson (90%+ CS)
        const t = Math.max(0, Math.min(1, rate / 100));
        const red = Math.round(30 + t * 190);
        const green = Math.round(110 - t * 75);
        const blue = Math.round(210 - t * 175);
        fill = `rgb(${red}, ${green}, ${blue})`;
        textFill = t > 0.35 ? "#ffffff" : "#141413";
      }
      const x = (c * cellW).toFixed(1);
      const y = (r * cellW).toFixed(1);
      const label = rate !== null && cell.taken > 0 ? `${Math.round(rate)}%` : "·";
      rects += `
        <g>
          <rect x="${x}" y="${y}" width="${cellW.toFixed(1)}" height="${cellW.toFixed(1)}" fill="${fill}" stroke="#ffffff" stroke-width="1">
            <title>Bin (${r + 1},${c + 1}): ${cell.cs}/${cell.taken} Called Strikes (${rate !== null ? rate + "%" : "N/A"})</title>
          </rect>
          <text x="${(c * cellW + cellW / 2).toFixed(1)}" y="${(r * cellW + cellW / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${textFill}">${label}</text>
        </g>
      `;
    }
  }

  // Approximate inner rulebook zone guide box (central +-0.85 SD out of +-1.8 SD)
  const z0 = (((1.8 - 0.85) / 3.6) * size).toFixed(1);
  const zw = (((1.7) / 3.6) * size).toFixed(1);

  return `
    <div class="heatmap-panel">
      <svg class="heatmap-svg" viewBox="0 0 220 220" role="img" aria-label="Venue-normalized Double-A called strike heatmap">
        ${rects}
        <rect x="${z0}" y="${z0}" width="${zw}" height="${zw}" fill="none" stroke="#141413" stroke-width="2" stroke-dasharray="4 2" />
      </svg>
      <div class="heatmap-info">
        <h4>🗺️ Venue-Normalized AA Called-Strike Heatmap</h4>
        <p style="margin-bottom:6px">${AA_NO_HAWKEYE_TIP}</p>
        <p style="color:var(--muted)">Each cell shows this umpire's called-strike rate (%) on taken pitches binned across venue-normalized Gameday stringer coordinates (<code>norm_x</code>, <code>norm_y</code> in ±1.8 SD). Dashed inner box marks the empirical core zone.</p>
      </div>
    </div>
  `;
}

function bindTooltipTargets(root = document) {
  root.querySelectorAll("[data-tip]").forEach((el) => {
    const showTip = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".tip-active").forEach((a) => a.classList.remove("tip-active"));
      el.classList.add("tip-active");
      if (els.metricTipText) {
        els.metricTipText.textContent = el.dataset.tip;
      }
      const leaderTipText = document.getElementById("leaderTipText");
      if (leaderTipText) {
        leaderTipText.textContent = el.dataset.tip;
      }
    };
    el.addEventListener("mouseenter", showTip);
    el.addEventListener("click", showTip);
  });
}

async function hydratePlayerHeadshots(rootEl) {
  const imgs = rootEl.querySelectorAll("img.player-avatar[data-player-img]");
  imgs.forEach(async (img) => {
    const name = img.dataset.playerImg;
    if (!name) return;
    if (state.playerCache[name]) {
      img.src = state.playerCache[name].headshot;
      return;
    }
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const data = await res.json();
      const person = (data.people || [])[0];
      if (person?.id) {
        const url = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${person.id}/headshot/67/current`;
        state.playerCache[name] = { id: person.id, headshot: url, person };
        img.src = url;
      }
    } catch {
      // Keep initials avatar if lookup fails
    }
  });
}

async function openPlayerModal(playerName) {
  if (!playerName || !els.playerModal) return;
  els.playerModal.classList.remove("hidden");
  els.playerModalCard.innerHTML = `<div class="empty-state">Looking up ${playerName} in MLB StatsAPI…</div>`;

  const g = state.activeGame;
  const gamePitches = g ? g.pitches.filter((p) => p.bat === playerName || p.pit === playerName) : [];
  const asBatter = g ? g.pitches.filter((p) => p.bat === playerName) : [];
  const missedAgainst = asBatter.filter((p) => !p.ok);
  const absOverturns = asBatter.filter((p) => p.ovt);

  let person = null;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}&hydrate=currentTeam`);
    if (res.ok) {
      const data = await res.json();
      person = (data.people || [])[0] || null;
    }
  } catch {
    person = null;
  }

  const pid = person?.id;
  const headshot = pid
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best/v1/people/${pid}/headshot/67/current`
    : umpAvatarUrl(0, playerName);

  const pos = person?.primaryPosition?.abbreviation || "Player";
  const teamName = person?.currentTeam?.name || (g ? `${g.away} / ${g.home}` : "MiLB");
  const batsThrows = person ? `B/T: ${person.batSide?.code || "?"}/${person.pitchHand?.code || "?"}` : "";
  const ageHeight = person ? `${person.height || ""} · ${person.weight ? person.weight + " lbs" : ""} ${person.currentAge ? "· Age " + person.currentAge : ""}` : "";

  const mlbUrl = pid ? `https://www.mlb.com/player/${pid}` : `https://www.mlb.com/search?q=${encodeURIComponent(playerName)}`;
  const milbUrl = pid ? `https://www.milb.com/player/${pid}` : `https://www.milb.com/search?q=${encodeURIComponent(playerName)}`;
  const savantUrl = pid ? `https://baseballsavant.mlb.com/savant-player/${pid}` : `https://baseballsavant.mlb.com/`;
  const bRefUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(playerName)}`;

  els.playerModalCard.innerHTML = `
    <div class="modal-top">
      <div class="modal-id-row">
        <img src="${headshot}" alt="${playerName}" class="modal-avatar" />
        <div>
          <h2 style="font-size:1.35rem">${person?.fullName || playerName}</h2>
          <div class="sc-sub">${pos} · ${teamName} ${batsThrows ? "· " + batsThrows : ""} ${ageHeight ? "· " + ageHeight : ""}</div>
          <div class="ext-links">
            <a href="${mlbUrl}" target="_blank" rel="noopener">⚾ MLB.com Profile ↗</a>
            <a href="${milbUrl}" target="_blank" rel="noopener">🏟️ MiLB.com Profile ↗</a>
            ${pid ? `<a href="${savantUrl}" target="_blank" rel="noopener">📊 Baseball Savant ↗</a>` : ""}
            <a href="${bRefUrl}" target="_blank" rel="noopener">📈 Baseball-Reference ↗</a>
          </div>
        </div>
      </div>
      <button class="pill-btn" id="closePlayerModal">✕ Close</button>
    </div>

    ${g ? `
      <div class="sc-kpi-grid">
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>Taken Pitches (This Game)</span><span>⚾</span></div>
          <div class="sc-kpi-val">${asBatter.length || gamePitches.length}</div>
        </div>
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>Missed Calls Against</span><span>😠</span></div>
          <div class="sc-kpi-val" style="color:#dc2626">${missedAgainst.length}</div>
        </div>
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>ABS Overturns</span><span>↺</span></div>
          <div class="sc-kpi-val" style="color:#7c3aed">${absOverturns.length}</div>
        </div>
      </div>

      <h3 style="font-size:0.8rem;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Taken Pitches in ${g.away} @ ${g.home} (${g.date})</h3>
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="data-table">
          <thead>
            <tr><th>Inn</th><th>Cnt</th><th>Matchup</th><th>Initial</th><th>Hawk-Eye</th><th>Margin</th><th>ABS</th></tr>
          </thead>
          <tbody>
            ${gamePitches.map((p) => `
              <tr>
                <td>${p.inn}</td>
                <td>${p.cnt}</td>
                <td>${p.bat} vs. ${p.pit}</td>
                <td><strong style="color:${p.ok ? "#15803d" : "#dc2626"}">${p.init.toUpperCase()}</strong></td>
                <td>${p.true.toUpperCase()}</td>
                <td>${p.margin_in}"</td>
                <td>${p.ovt ? "<strong style='color:#7c3aed'>↺ Overturned</strong>" : (p.chal ? "Upheld" : "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    ` : ""}
  `;

  document.getElementById("closePlayerModal").addEventListener("click", () => {
    els.playerModal.classList.add("hidden");
  });
}

async function openUmpireModal(umpId, initialLevel = null) {
  if (!umpId || umpId === "unknown") return;
  els.umpModal.classList.remove("hidden");
  els.umpModalCard.innerHTML = `<div class="empty-state">Loading umpire profile #${umpId}…</div>`;

  try {
    const u = await getJSON(`./data/umpires/${umpId}.json`);
    const links = umpProfileLinks(u.umpire_id, u.umpire_name);
    const activeYr = state.selectedYear || "ALL";
    const yrSplits = u.season_splits?.[activeYr] || u.level_splits || { ALL: u };
    const availLevels = ["ALL", ...["AAA", "AA", "FSL"].filter((l) => u.levels.includes(l))];

    let selectedLvl = initialLevel || (els.levelFilter?.value !== "ALL" && availLevels.includes(els.levelFilter?.value) ? els.levelFilter.value : "ALL");
    if (!availLevels.includes(selectedLvl)) selectedLvl = availLevels[1] || "ALL";

    const renderModalSplit = (lvlKey) => {
      selectedLvl = lvlKey;
      const splitRec = yrSplits[lvlKey] || u.level_splits?.[lvlKey] || u;
      // Only show the AA-only notice/heatmap when explicitly viewing the "AA" split, OR when the umpire has zero Hawk-Eye games
      const isAaOnly = lvlKey === "AA" || (splitRec.tol_acc_pct === null || splitRec.tol_acc_pct === undefined);
      const color = isAaOnly ? "#1d4ed8" : accColor(splitRec.tol_acc_pct);
      const logsForSplit = u.game_log.filter((g) => {
        if (activeYr !== "ALL" && !g.date.startsWith(activeYr)) return false;
        if (lvlKey !== "ALL" && g.level !== lvlKey) return false;
        return true;
      });
      const heatmapObj = splitRec.aa_heatmap || u.aa_heatmap || u.level_splits?.AA?.aa_heatmap;

      const splitTabsHtml = availLevels.length > 1 ? `
        <div class="split-pills">
          <span style="font-size:0.76rem;font-weight:700;color:var(--muted);align-self:center;margin-right:4px">LEVEL SPLIT:</span>
          ${availLevels.map((lk) => `
            <button type="button" class="pill-btn modal-lvl-btn ${lk === lvlKey ? "active" : ""}" data-mlvl="${lk}">
              ${lk === "ALL" ? `All Levels (${u.levels.join(" + ")})` : (lk === "AA" ? "Double-A (AA)" : (lk === "AAA" ? "Triple-A (AAA)" : "Single-A (FSL)"))}
            </button>
          `).join("")}
        </div>
      ` : "";

      const kpiHtml = isAaOnly ? `
        <div class="aa-notice-banner">
          <strong>Double-A Outcome &amp; Zone Profile:</strong> ${AA_NO_HAWKEYE_TIP} Displaying outcome-based zone metrics and venue-normalized called-strike density.
        </div>
        <div class="sc-kpi-grid">
          <div class="sc-kpi-box">
            <div class="sc-kpi-label"><span>Called Strike %</span><span>⚾</span></div>
            <div class="sc-kpi-val" style="color:#1d4ed8">${fmt1(splitRec.called_strike_pct || 0)}%</div>
            <div class="sc-sub">${(splitRec.called_strikes || 0).toLocaleString()} CS / ${(splitRec.taken || 0).toLocaleString()} Taken</div>
          </div>
          <div class="sc-kpi-box">
            <div class="sc-kpi-label"><span>K% / BB%</span><span>📊</span></div>
            <div class="sc-kpi-val">${splitRec.k_pct != null ? fmt1(splitRec.k_pct) + "%" : "—"} / ${splitRec.bb_pct != null ? fmt1(splitRec.bb_pct) + "%" : "—"}</div>
            <div class="sc-sub">${(splitRec.plate_appearances || 0).toLocaleString()} Completed PAs</div>
          </div>
          <div class="sc-kpi-box">
            <div class="sc-kpi-label"><span>Runs/G · Ejections</span><span>🏟️</span></div>
            <div class="sc-kpi-val">${splitRec.runs_per_game != null ? Number(splitRec.runs_per_game).toFixed(2) : "—"} R/G</div>
            <div class="sc-sub">Ejections: ${splitRec.ejections || 0} · Games: ${splitRec.games}</div>
          </div>
        </div>
        ${renderAaHeatmapSvg(heatmapObj)}
      ` : `
        <div class="sc-kpi-grid">
          <div class="sc-kpi-box">
            <div class="sc-kpi-label"><span>Tol Acc% (±0.20")</span><span>🎯</span></div>
            <div class="sc-kpi-val" style="color:${color}">${fmt1(splitRec.tol_acc_pct)}%</div>
            <div class="sc-sub">Raw Acc: ${fmt1(splitRec.acc_pct)}% · CS%: ${fmt1(splitRec.called_strike_pct || 0)}%</div>
          </div>
          <div class="sc-kpi-box">
            <div class="sc-kpi-label"><span>ABS Overturns</span><span>↺</span></div>
            <div class="sc-kpi-val" style="color:#7c3aed">${splitRec.overturns}/${splitRec.challenges} (${fmt1(splitRec.overturn_pct || 0)}%)</div>
            <div class="sc-sub">Total Missed: ${(splitRec.missed || 0).toLocaleString()} (Mean ${splitRec.mean_miss_in}")</div>
          </div>
          <div class="sc-kpi-box">
            <div class="sc-kpi-label"><span>Cumulative Σ ΔRE24</span><span>⚡</span></div>
            <div class="sc-kpi-val" style="color:#dc2626">+${splitRec.re_impact}</div>
            <div class="sc-sub">Runs/G: ${splitRec.runs_per_game ?? "—"} · Ej: ${splitRec.ejections || 0}</div>
          </div>
        </div>
      `;

      els.umpModalCard.innerHTML = `
        <div class="modal-top">
          <div class="modal-id-row">
            <img id="modalUmpAvatar" src="${umpAvatarUrl(u.umpire_id, u.umpire_name)}" alt="${u.umpire_name}" class="modal-avatar" />
            <div>
              <h2 style="font-size:1.35rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${u.umpire_name} ${grumpBadge(splitRec.tol_acc_pct, splitRec.called_strike_pct)}
              </h2>
              <div class="sc-sub">MLB Official ID #${u.umpire_id} · Levels: ${u.levels.join(", ")} · ${splitRec.games} Games (${(splitRec.taken || 0).toLocaleString()} Taken Pitches)</div>
              <div class="ext-links" id="modalExtLinks">
                <a href="${links.photosUrl}" target="_blank" rel="noopener">📷 Umpire Photos ↗</a>
                <a href="${links.webUrl}" target="_blank" rel="noopener">🔎 Umpire Bio &amp; News ↗</a>
                <a href="${links.ccsUrl}" target="_blank" rel="noopener">Close Call Sports ↗</a>
                <a href="${links.bRefUrl}" target="_blank" rel="noopener">Baseball-Reference ↗</a>
              </div>
            </div>
          </div>
          <button class="pill-btn" id="closeUmpModal">✕ Close</button>
        </div>

        ${splitTabsHtml}
        ${kpiHtml}

        <h3 style="font-size:0.8rem;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Game Log (${logsForSplit.length} Games — Click any game to open scorecard)</h3>
        <div class="table-wrap" style="max-height:340px;overflow-y:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Lvl</th>
                <th>Matchup</th>
                <th>Taken</th>
                <th>CS%</th>
                <th>Tol Acc%</th>
                <th>Raw Acc%</th>
                <th>Missed</th>
                <th>ABS Ovt</th>
              </tr>
            </thead>
            <tbody>
              ${logsForSplit.map((g) => {
                const gIsAa = g.level === "AA" || g.acc_pct === null || g.acc_pct === undefined;
                const gTol = g.tol_acc_pct ?? g.acc_pct;
                return `
                <tr class="ump-log-row" data-date="${g.date}" data-pk="${g.game_pk}" style="cursor:pointer">
                  <td><strong>${g.date}</strong></td>
                  <td><span class="badge">${g.level}</span></td>
                  <td>${g.matchup}</td>
                  <td>${g.taken}</td>
                  <td>${g.called_strike_pct != null ? fmt1(g.called_strike_pct) + "%" : "—"}</td>
                  <td>${gIsAa ? naDashHtml() : `<strong style="color:${accColor(gTol)}">${fmt1(gTol)}%</strong>`}</td>
                  <td>${gIsAa ? naDashHtml() : `${fmt1(g.acc_pct)}%`}</td>
                  <td>${gIsAa ? naDashHtml() : g.missed}</td>
                  <td>${gIsAa ? naDashHtml() : g.overturns}</td>
                </tr>
              `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `;

      document.getElementById("closeUmpModal").addEventListener("click", () => {
        els.umpModal.classList.add("hidden");
      });

      els.umpModalCard.querySelectorAll(".modal-lvl-btn").forEach((b) => {
        b.addEventListener("click", () => renderModalSplit(b.dataset.mlvl));
      });

      fetchWikiUmpirePhoto(
        u.umpire_name,
        document.getElementById("modalUmpAvatar"),
        document.getElementById("modalExtLinks"),
        u.umpire_id
      );

      bindTooltipTargets(els.umpModalCard);

      els.umpModalCard.querySelectorAll(".ump-log-row").forEach((row) => {
        row.addEventListener("click", async () => {
          els.umpModal.classList.add("hidden");
          document.querySelector('[data-view="slateView"]').click();
          const rowYear = row.dataset.date.slice(0, 4);
          if (els.yearSelect && state.selectedYear !== "ALL" && state.selectedYear !== rowYear) {
            els.yearSelect.value = rowYear;
            await applyYearSelection(rowYear, false);
          }
          els.dateSelect.value = row.dataset.date;
          await loadDateSlate(row.dataset.date);
          const targetCard = els.gamesList.querySelector(`.game-card[data-pk="${row.dataset.pk}"]`);
          if (targetCard) selectGame(row.dataset.pk, targetCard);
        });
      });
    };

    renderModalSplit(selectedLvl);
  } catch {
    els.umpModalCard.innerHTML = `<div class="empty-state">Could not load umpire #${umpId}.</div>`;
  }
}

async function getJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

function activateView(target, updateHash = true) {
  const isSlate = target === "slateView";
  const isLeader = target === "leaderboardView";
  const isBadUmps = target === "badUmpsView";
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === target);
  });
  els.slateView.classList.toggle("hidden", !isSlate);
  els.dateControls.classList.toggle("hidden", !isSlate);
  if (els.metricTipBar) els.metricTipBar.classList.toggle("hidden", !isSlate);
  els.leaderboardView.classList.toggle("hidden", !isLeader);
  if (els.badUmpsView) els.badUmpsView.classList.toggle("hidden", !isBadUmps);
  els.leaderControls.classList.toggle("hidden", !(isLeader || isBadUmps));

  if (updateHash) {
    const newHash = isSlate ? "#/slate" : (isBadUmps ? "#/bad-umps" : "#/leaderboard");
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  }
}

function syncViewFromUrl() {
  const h = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  if (h.includes("bad") || params.get("view") === "bad-umps") {
    activateView("badUmpsView", false);
  } else if (h.includes("leaderboard") || params.get("view") === "leaderboard") {
    activateView("leaderboardView", false);
  } else if (h.includes("slate") || params.get("view") === "slate") {
    activateView("slateView", false);
  }
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateView(btn.dataset.view, true));
  });
  window.addEventListener("hashchange", syncViewFromUrl);
  syncViewFromUrl();

  if (els.yearSelect) {
    els.yearSelect.addEventListener("change", () => applyYearSelection(els.yearSelect.value, true));
  }
  els.dateSelect.addEventListener("change", () => loadDateSlate(els.dateSelect.value));
  els.levelFilter.addEventListener("change", () => {
    const lvl = els.levelFilter.value;
    document.querySelectorAll("#badUmpsLevelPills [data-bu-lvl]").forEach((p) => {
      p.classList.toggle("active", p.dataset.buLvl === lvl);
    });
    if (lvl === "AA") {
      state.sortCol = "called_strike_pct";
      state.sortAsc = false;
    } else if (lvl !== "AA" && state.sortCol === "called_strike_pct") {
      state.sortCol = "tol_acc_pct";
      state.sortAsc = true;
    }
    document.querySelectorAll("#leaderboardHeaderRow .sortable-th").forEach((h) => {
      const active = h.dataset.sort === state.sortCol;
      h.classList.toggle("sort-active", active);
      const arrow = h.querySelector(".sort-arrow");
      if (arrow) arrow.textContent = active ? (state.sortAsc ? "▲" : "▼") : "";
    });
    renderLeaderboard();
  });
  document.querySelectorAll("#badUmpsLevelPills [data-bu-lvl]").forEach((pill) => {
    pill.addEventListener("click", () => {
      els.levelFilter.value = pill.dataset.buLvl;
      els.levelFilter.dispatchEvent(new Event("change"));
    });
  });
  els.minPitches.addEventListener("input", renderLeaderboard);
  if (els.umpSearchInput) {
    els.umpSearchInput.addEventListener("input", () => {
      state.searchQuery = els.umpSearchInput.value.trim().toLowerCase();
      renderLeaderboard();
    });
  }

  const organBtn = document.getElementById("organToggleBtn");
  if (organBtn) {
    organBtn.addEventListener("click", () => organ.toggle());
  }
  organ.start();

  if (els.umpModal) {
    els.umpModal.addEventListener("click", (e) => {
      if (e.target === els.umpModal) els.umpModal.classList.add("hidden");
    });
  }
  if (els.playerModal) {
    els.playerModal.addEventListener("click", (e) => {
      if (e.target === els.playerModal) els.playerModal.classList.add("hidden");
    });
  }
  bindTooltipTargets(document);

  const toggleLevelsBtn = document.getElementById("toggleLevelsCol");
  const tableWrap = document.getElementById("leaderboardTableWrap");
  if (toggleLevelsBtn && tableWrap) {
    toggleLevelsBtn.addEventListener("click", () => {
      const hidden = tableWrap.classList.toggle("hide-levels");
      toggleLevelsBtn.classList.toggle("active", !hidden);
      toggleLevelsBtn.textContent = hidden ? "+ Show Levels" : "− Hide Levels";
    });
  }

  const togglePhotoBtn = document.getElementById("togglePhotoOnly");
  if (togglePhotoBtn) {
    togglePhotoBtn.addEventListener("click", () => {
      state.photoOnly = !state.photoOnly;
      togglePhotoBtn.classList.toggle("active", state.photoOnly);
      if (state.photoOnly && els.yearSelect && state.selectedYear !== "ALL") {
        // Switch to All Seasons & Min Pitches 0 so all 10 verified MLB/MiLB umpire photos show
        els.yearSelect.value = "ALL";
        els.minPitches.value = "0";
        applyYearSelection("ALL", false);
      } else {
        renderLeaderboard();
      }
    });
  }

  document.querySelectorAll("#leaderboardHeaderRow .sortable-th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortCol = col;
        // Default direction: ascending for accuracy/name/levels, descending for counts/misses/RE
        state.sortAsc = ["acc_pct", "tol_acc_pct", "umpire_name", "levels"].includes(col);
      }
      document.querySelectorAll("#leaderboardHeaderRow .sortable-th").forEach((h) => {
        h.classList.toggle("sort-active", h === th);
        const arrow = h.querySelector(".sort-arrow");
        if (arrow) arrow.textContent = h === th ? (state.sortAsc ? "▲" : "▼") : "";
      });
      renderLeaderboard();
    });
  });
}

async function loadDateSlate(dateStr) {
  if (!dateStr) return;
  els.gamesList.innerHTML = `<div class="empty-state">Loading ${dateStr}…</div>`;
  const data = await getJSON(`./data/dates/${dateStr}.json`);

  if (!data.games.length) {
    els.gamesList.innerHTML = `<div class="empty-state">No tracked AAA or FSL games on ${dateStr}.</div>`;
    return;
  }

  els.gamesList.innerHTML = data.games.map((g) => {
    const isAa = g.level === "AA" || g.tol_acc_pct === null || g.tol_acc_pct === undefined;
    const color = isAa ? "#1d4ed8" : accColor(g.tol_acc_pct);
    const barW = isAa
      ? Math.max(0, Math.min(100, ((g.called_strike_pct || 0) / 50) * 100)).toFixed(1)
      : Math.max(0, Math.min(100, ((g.tol_acc_pct - 75) / 25) * 100)).toFixed(1);
    const stripHtml = isAa ? `
      <div class="metrics-strip">
        <div class="metric-cell" data-tip="Called Strike %: Called strikes divided by taken pitches (${g.called_strikes}/${g.taken})."><span>CS% <b class="th-info-badge">?</b></span><strong style="color:#1d4ed8">${fmt1(g.called_strike_pct || 0)}%</strong></div>
        <div class="metric-cell" data-tip="K% / BB%: Strikeout and walk rates across ${g.plate_appearances || 0} completed plate appearances."><span>K% / BB% <b class="th-info-badge">?</b></span><strong>${fmt1(g.k_pct || 0)}%/${fmt1(g.bb_pct || 0)}%</strong></div>
        <div class="metric-cell" data-tip="Taken Pitches: ${g.called_strikes || 0} called strikes out of ${g.taken} taken pitches (${g.total_pitches || 0} total pitches)."><span>CS/Taken <b class="th-info-badge">?</b></span><strong>${g.called_strikes || 0}/${g.taken}</strong></div>
        <div class="metric-cell" data-tip="${AA_NO_HAWKEYE_TIP}"><span>Hawk-Eye <b class="th-info-badge">?</b></span><strong>${naDashHtml()}</strong></div>
      </div>
    ` : `
      <div class="metrics-strip">
        <div class="metric-cell" data-tip="Tol Acc (±0.20&quot;): Tolerance-adjusted accuracy excluding razor-thin borderline pitches within ±0.20 inches of the zone edge."><span>Tol Acc <b class="th-info-badge">?</b></span><strong style="color:${color}">${fmt1(g.tol_acc_pct)}%</strong></div>
        <div class="metric-cell" data-tip="Raw Acc: Strict unbuffered percentage of taken pitches matching the exact 0.00&quot; 2D Hawk-Eye strike zone."><span>Raw Acc <b class="th-info-badge">?</b></span><strong>${fmt1(g.acc_pct)}%</strong></div>
        <div class="metric-cell" data-tip="Missed: Total initial ball/strike calls that disagreed with Hawk-Eye out of all taken pitches."><span>Missed <b class="th-info-badge">?</b></span><strong>${g.missed}/${g.taken}</strong></div>
        <div class="metric-cell" data-tip="ABS Ovt: Calls overturned by an ABS challenge out of total challenges in this game."><span>ABS Ovt <b class="th-info-badge">?</b></span><strong style="color:#7c3aed">${g.overturns}/${g.challenges}</strong></div>
      </div>
    `;
    return `
    <article class="game-card" data-pk="${g.game_pk}">
      <div class="card-top">
        <span class="matchup">${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs}</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${grumpBadge(g.tol_acc_pct, g.called_strike_pct)}
          <span class="badge">${g.level}</span>
        </div>
      </div>
      <div class="ump-line">
        <img src="${umpAvatarUrl(g.umpire_id, g.umpire_name)}" alt="${g.umpire_name}" class="ump-avatar" data-ump="${g.umpire_id}" loading="lazy" />
        HP Umpire: <button type="button" class="ump-link" data-ump="${g.umpire_id}">${g.umpire_name}</button> · ${g.venue}
      </div>
      ${stripHtml}
      <div class="card-meter" title="${isAa ? `Called Strike % (${fmt1(g.called_strike_pct || 0)}%)` : `Tolerance accuracy gauge (${fmt1(g.tol_acc_pct)}%)`}">
        <div class="card-meter-fill" style="width:${barW}%;background:${color}"></div>
      </div>
    </article>
  `;
  }).join("");

  els.gamesList.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-ump]")) return;
      selectGame(card.dataset.pk, card);
    });
  });

  els.gamesList.querySelectorAll("[data-ump]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openUmpireModal(btn.dataset.ump);
    });
  });

  bindTooltipTargets(els.gamesList);

  const firstCard = els.gamesList.querySelector(".game-card");
  if (firstCard) selectGame(firstCard.dataset.pk, firstCard, false);
}

async function selectGame(gamePk, cardEl, shouldScroll = true) {
  els.gamesList.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
  if (cardEl) cardEl.classList.add("selected");

  state.activeGame = await getJSON(`./data/games/${gamePk}.json`);
  renderScorecard();
  if (shouldScroll && window.innerWidth <= 960 && cardEl) {
    els.scorecardPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderScorecard() {
  const g = state.activeGame;
  if (!g) return;

  const isAa = g.level === "AA" || g.tol_acc_pct === null || g.tol_acc_pct === undefined;

  if (isAa) {
    // Double-A venue-normalized Gameday stringer coordinate plot: nx in [-2.2, 2.2] -> [0, 310]; ny in [-2.2, 2.2] -> [340, 0]
    const mapX = (nx) => (((nx || 0) + 2.2) / 4.4) * 310;
    const mapY = (ny) => 340 - (((ny || 0) + 2.2) / 4.4) * 340;
    const zx = mapX(-0.95);
    const zw = mapX(0.95) - zx;
    const zy = mapY(0.95);
    const zh = mapY(-0.95) - zy;
    const plateY = 318;
    const plateMid = mapX(0).toFixed(1);
    const plateL = zx.toFixed(1);
    const plateR = (zx + zw).toFixed(1);

    const filtered = g.pitches.filter((p) => {
      if (state.pitchFilter === "STRIKE") return p.init === "strike";
      if (state.pitchFilter === "BALL") return p.init === "ball";
      return true;
    });

    const circles = filtered
      .filter((p) => p.nx !== undefined && p.ny !== undefined)
      .map((p, i) => {
        const isStrike = p.init === "strike";
        const fill = isStrike ? "#dc2626" : "#1d4ed8";
        return `<circle class="pitch-dot" data-idx="${i}" cx="${mapX(p.nx).toFixed(1)}" cy="${mapY(p.ny).toFixed(1)}" r="${isStrike ? 5.2 : 4.5}" fill="${fill}" fill-opacity="${isStrike ? 0.85 : 0.45}" stroke="#141413" stroke-width="0.7"/>`;
      })
      .join("");

    els.scorecardPanel.innerHTML = `
      <div class="sc-header">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <h2 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <img src="${umpAvatarUrl(g.umpire_id, g.umpire_name)}" alt="${g.umpire_name}" class="ump-avatar" data-ump="${g.umpire_id}" />
            <span>${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs} · <button type="button" class="ump-link" data-ump="${g.umpire_id}">${g.umpire_name}</button></span>
          </h2>
          ${grumpBadge(null, g.called_strike_pct)}
        </div>
        <div class="sc-sub">${g.date} · ${g.venue} (Double-A) · ${AA_NO_HAWKEYE_TIP}</div>
      </div>

      <div class="sc-kpi-grid">
        <div class="sc-kpi-box" data-tip="Called Strike %: Called strikes divided by total taken pitches in this game.">
          <div class="sc-kpi-label"><span>Called Strike % <b class="th-info-badge">?</b></span><span>⚾</span></div>
          <div class="sc-kpi-val" style="color:#1d4ed8">${fmt1(g.called_strike_pct || 0)}%</div>
          <div class="sc-sub">${g.called_strikes || 0} CS / ${g.taken} Taken</div>
        </div>
        <div class="sc-kpi-box" data-tip="K% / BB%: Strikeout and walk rates across completed plate appearances in this game.">
          <div class="sc-kpi-label"><span>Game K% / BB% <b class="th-info-badge">?</b></span><span>📊</span></div>
          <div class="sc-kpi-val">${fmt1(g.k_pct || 0)}% / ${fmt1(g.bb_pct || 0)}%</div>
          <div class="sc-sub">${g.strikeouts || 0} K · ${g.walks || 0} BB (${g.plate_appearances || 0} PAs)</div>
        </div>
        <div class="sc-kpi-box" data-tip="${AA_NO_HAWKEYE_TIP}">
          <div class="sc-kpi-label"><span>Hawk-Eye / ABS <b class="th-info-badge">?</b></span><span>🏟️</span></div>
          <div class="sc-kpi-val">${naDashHtml()}</div>
          <div class="sc-sub">Runs: ${g.runs_scored || (g.away_runs + g.home_runs)} · Ejections: ${g.ejections || 0}</div>
        </div>
      </div>

      <div class="zone-toolbar">
        <div class="tabs">
          <button class="pill-btn ${state.pitchFilter === "ALL" ? "active" : ""}" data-pf="ALL">All Taken (${g.pitches.length})</button>
          <button class="pill-btn ${state.pitchFilter === "STRIKE" ? "active" : ""}" data-pf="STRIKE">Called Strikes (${g.called_strikes || 0})</button>
          <button class="pill-btn ${state.pitchFilter === "BALL" ? "active" : ""}" data-pf="BALL">Called Balls (${g.taken - (g.called_strikes || 0)})</button>
        </div>
      </div>

      <div class="zone-wrap">
        <svg class="zone-svg" viewBox="0 0 310 340" role="img" aria-label="Venue-normalized Double-A taken pitch plot">
          <rect x="${zx.toFixed(1)}" y="${zy.toFixed(1)}" width="${zw.toFixed(1)}" height="${zh.toFixed(1)}" fill="#141413" fill-opacity="0.03" stroke="#5e5d59" stroke-dasharray="4 3" stroke-width="1.6"/>
          <polygon points="${plateL},${plateY} ${plateR},${plateY} ${plateR},${plateY + 7} ${plateMid},${plateY + 15} ${plateL},${plateY + 7}" fill="#ffffff" stroke="#5e5d59" stroke-width="1.3"/>
          ${circles}
        </svg>

        <div class="pitch-readout">
          <div class="legend">
            <div><span class="dot-key" style="background:#dc2626"></span>Called Strike (Stringer x/y)</div>
            <div><span class="dot-key" style="background:#1d4ed8;opacity:0.6"></span>Called Ball (Stringer x/y)</div>
            <div style="color:var(--muted);font-size:0.74rem;margin-top:4px">${AA_NO_HAWKEYE_TIP} Dashed box shows empirical ±0.95 SD zone.</div>
          </div>
          <div id="hoverDetail">Hover or tap any pitch dot to inspect batter, count, call, and normalized stringer coordinates.</div>
        </div>
      </div>
    `;

    els.scorecardPanel.querySelectorAll(".pill-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.pitchFilter = b.dataset.pf;
        renderScorecard();
      });
    });
    els.scorecardPanel.querySelectorAll("[data-ump]").forEach((btn) => {
      btn.addEventListener("click", () => openUmpireModal(btn.dataset.ump, "AA"));
    });
    bindTooltipTargets(els.scorecardPanel);

    const detailEl = document.getElementById("hoverDetail");
    els.scorecardPanel.querySelectorAll(".pitch-dot").forEach((dot) => {
      const showDetail = () => {
        const p = filtered[Number(dot.dataset.idx)];
        detailEl.innerHTML = `
          <strong>${p.inn} · ${p.cnt}</strong> ·
          <img src="${umpAvatarUrl(0, p.bat)}" alt="" class="player-avatar player-link" data-player="${p.bat}" data-player-img="${p.bat}" />
          <button type="button" class="ump-link player-link" data-player="${p.bat}">${p.bat}</button>
          vs.
          <img src="${umpAvatarUrl(0, p.pit)}" alt="" class="player-avatar player-link" data-player="${p.pit}" data-player-img="${p.pit}" />
          <button type="button" class="ump-link player-link" data-player="${p.pit}">${p.pit}</button><br/>
          Call: <strong>${p.init.toUpperCase()}</strong> | Stringer px: <code>(${p.gx}, ${p.gy})</code> · Norm: <code>(${p.nx}, ${p.ny})</code>
        `;
        detailEl.querySelectorAll(".player-link").forEach((b) => {
          b.addEventListener("click", () => openPlayerModal(b.dataset.player));
        });
        hydratePlayerHeadshots(detailEl);
      };
      dot.addEventListener("mouseenter", showDetail);
      dot.addEventListener("click", showDetail);
    });
    return;
  }

  // SVG coordinate mapper: x in [-1.8, 1.8] ft -> [0, 310]; pzn in [-0.45, 1.45] -> [340, 0]
  const mapX = (px) => ((px + 1.8) / 3.6) * 310;
  const mapY = (pzn) => 340 - ((pzn + 0.45) / 1.9) * 340;

  const zx = mapX(-0.7083);
  const zw = mapX(0.7083) - zx;
  const zy = mapY(1.0);
  const zh = mapY(0.0) - zy;

  // Outer baseball-radius halo (+0.1225 ft horizontal, approx +0.065 normalized vertical)
  const hx = mapX(-0.8308);
  const hw = mapX(0.8308) - hx;
  const hy = mapY(1.065);
  const hh = mapY(-0.065) - hy;

  // 3x3 internal zone grid lines + home plate pentagon
  const xThird1 = (zx + zw / 3).toFixed(1);
  const xThird2 = (zx + (2 * zw) / 3).toFixed(1);
  const yThird1 = (zy + zh / 3).toFixed(1);
  const yThird2 = (zy + (2 * zh) / 3).toFixed(1);
  const plateY = 318;
  const plateMid = mapX(0).toFixed(1);
  const plateL = zx.toFixed(1);
  const plateR = (zx + zw).toFixed(1);

  const filtered = g.pitches.filter((p) => {
    if (state.pitchFilter === "MISSED") return !p.ok;
    if (state.pitchFilter === "CHAL") return p.chal;
    return true;
  });

  const circles = filtered.map((p, i) => {
    let fill = "#15803d";
    let radius = 4.5;
    if (!p.ok) {
      fill = p.init === "strike" ? "#dc2626" : "#d97706";
      radius = 6;
    }
    const ring = p.ovt
      ? `<circle cx="${mapX(p.px).toFixed(1)}" cy="${mapY(p.pzn).toFixed(1)}" r="${radius + 3}" fill="none" stroke="#7c3aed" stroke-width="2"/>`
      : "";
    return `${ring}<circle class="pitch-dot" data-idx="${i}" cx="${mapX(p.px).toFixed(1)}" cy="${mapY(p.pzn).toFixed(1)}" r="${radius}" fill="${fill}" fill-opacity="${p.ok ? 0.35 : 0.9}" stroke="#141413" stroke-width="0.7"/>`;
  }).join("");

  const worstMisses = [...g.pitches]
    .filter((p) => !p.ok)
    .sort((a, b) => b.re - a.re || b.err_in - a.err_in)
    .slice(0, 6);

  const maxRe = Math.max(0.45, ...worstMisses.map((m) => m.re));

  els.scorecardPanel.innerHTML = `
    <div class="sc-header">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h2 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <img src="${umpAvatarUrl(g.umpire_id, g.umpire_name)}" alt="${g.umpire_name}" class="ump-avatar" data-ump="${g.umpire_id}" />
          <span>${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs} · <button type="button" class="ump-link" data-ump="${g.umpire_id}">${g.umpire_name}</button></span>
        </h2>
        ${grumpBadge(g.acc_pct)}
      </div>
      <div class="sc-sub">${g.date} · ${g.venue} · Mean Miss ${g.mean_miss_in}" · Unchallenged Misses: ${g.unchallenged_misses}</div>
    </div>

    <div class="sc-kpi-grid">
      <div class="sc-kpi-box" data-tip="Called Strike Acc: Percentage of pitches the umpire initially called a STRIKE that genuinely clipped or entered the Hawk-Eye zone.">
        <div class="sc-kpi-label"><span>Called Strike Acc <b class="th-info-badge">?</b></span><span>🎯</span></div>
        <div class="sc-kpi-val" style="color:${accColor(g.cs_acc_pct)}">${fmt1(g.cs_acc_pct)}%</div>
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${g.cs_acc_pct}%;background:${accColor(g.cs_acc_pct)}"></div></div>
      </div>
      <div class="sc-kpi-box" data-tip="Called Ball Acc: Percentage of pitches the umpire initially called a BALL that were genuinely outside the Hawk-Eye zone.">
        <div class="sc-kpi-label"><span>Called Ball Acc <b class="th-info-badge">?</b></span><span>👁️</span></div>
        <div class="sc-kpi-val" style="color:${accColor(g.cb_acc_pct)}">${fmt1(g.cb_acc_pct)}%</div>
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${g.cb_acc_pct}%;background:${accColor(g.cb_acc_pct)}"></div></div>
      </div>
      <div class="sc-kpi-box" data-tip="Run Impact (Σ ΔRE24): Sum of Run Expectancy swings caused by missed initial calls in this game, weighted by pre-pitch ball-strike count.">
        <div class="sc-kpi-label"><span>Run Impact (Σ ΔRE24) <b class="th-info-badge">?</b></span><span>⚡</span></div>
        <div class="sc-kpi-val" style="color:#dc2626">+${g.re_impact}</div>
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(100, (g.re_impact / 3.5) * 100).toFixed(0)}%;background:#dc2626"></div></div>
      </div>
    </div>

    <div class="zone-toolbar">
      <div class="tabs">
        <button class="pill-btn ${state.pitchFilter === "ALL" ? "active" : ""}" data-pf="ALL">All (${g.pitches.length})</button>
        <button class="pill-btn ${state.pitchFilter === "MISSED" ? "active" : ""}" data-pf="MISSED">Missed (${g.missed})</button>
        <button class="pill-btn ${state.pitchFilter === "CHAL" ? "active" : ""}" data-pf="CHAL">ABS Challenges (${g.challenges})</button>
      </div>
    </div>

    <div class="zone-wrap">
      <svg class="zone-svg" viewBox="0 0 310 340" role="img" aria-label="Normalized strike zone pitch plot">
        <!-- Outer ball-edge halo -->
        <rect x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${hw.toFixed(1)}" height="${hh.toFixed(1)}" rx="10" fill="none" stroke="#5e5d59" stroke-dasharray="4 3" stroke-width="1.2"/>
        <!-- 3x3 inner grid -->
        <line x1="${xThird1}" y1="${zy.toFixed(1)}" x2="${xThird1}" y2="${(zy + zh).toFixed(1)}" stroke="#dcd9d0" stroke-width="1"/>
        <line x1="${xThird2}" y1="${zy.toFixed(1)}" x2="${xThird2}" y2="${(zy + zh).toFixed(1)}" stroke="#dcd9d0" stroke-width="1"/>
        <line x1="${zx.toFixed(1)}" y1="${yThird1}" x2="${(zx + zw).toFixed(1)}" y2="${yThird1}" stroke="#dcd9d0" stroke-width="1"/>
        <line x1="${zx.toFixed(1)}" y1="${yThird2}" x2="${(zx + zw).toFixed(1)}" y2="${yThird2}" stroke="#dcd9d0" stroke-width="1"/>
        <!-- Rulebook strike zone boundary -->
        <rect x="${zx.toFixed(1)}" y="${zy.toFixed(1)}" width="${zw.toFixed(1)}" height="${zh.toFixed(1)}" fill="#141413" fill-opacity="0.03" stroke="#141413" stroke-width="2"/>
        <!-- Home plate pentagon -->
        <polygon points="${plateL},${plateY} ${plateR},${plateY} ${plateR},${plateY + 7} ${plateMid},${plateY + 15} ${plateL},${plateY + 7}" fill="#ffffff" stroke="#5e5d59" stroke-width="1.3"/>
        ${circles}
      </svg>

      <div class="pitch-readout">
        <div class="legend">
          <div><span class="dot-key" style="background:#dc2626"></span>Called Strike on True Ball</div>
          <div><span class="dot-key" style="background:#d97706"></span>Called Ball on True Strike</div>
          <div><span class="dot-key" style="border:2px solid #7c3aed"></span>Overturned by ABS Challenge</div>
          <div><span class="dot-key" style="background:#15803d;opacity:0.45"></span>Correct Initial Call</div>
        </div>
        <div id="hoverDetail">Hover or tap any pitch dot to inspect batter, count, initial call, and miss distance.</div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th data-tip="Inn: Half-inning (T = Top, B = Bottom) when the pitch was thrown.">Inn <span class="th-info-badge">?</span></th>
            <th data-tip="Cnt: Pre-pitch balls-strikes count before the pitch was delivered.">Cnt <span class="th-info-badge">?</span></th>
            <th data-tip="Batter: Batter at the plate for the taken pitch.">Batter <span class="th-info-badge">?</span></th>
            <th data-tip="Initial: The home plate umpire's live call on the field BEFORE any ABS challenge review.">Initial <span class="th-info-badge">?</span></th>
            <th data-tip="Miss (in): Distance in inches between the outer edge of the baseball and the Hawk-Eye strike zone boundary.">Miss (in) <span class="th-info-badge">?</span></th>
            <th data-tip="ABS: Challenge status — Unchallenged miss, Overturned by ABS challenge, or Upheld.">ABS <span class="th-info-badge">?</span></th>
            <th data-tip="ΔRE24: Run Expectancy swing caused by the missed call based on the pre-pitch count.">ΔRE24 <span class="th-info-badge">?</span></th>
          </tr>
        </thead>
        <tbody>
          ${worstMisses.length ? worstMisses.map((m) => {
            const reBar = Math.min(100, (m.re / maxRe) * 100).toFixed(0);
            const initColor = m.init === "strike" ? "#dc2626" : "#d97706";
            return `
            <tr>
              <td>${m.inn}</td>
              <td>${m.cnt}</td>
              <td>
                <img src="${umpAvatarUrl(0, m.bat)}" alt="${m.bat}" class="player-avatar player-link" data-player="${m.bat}" data-player-img="${m.bat}" />
                <button type="button" class="ump-link player-link" data-player="${m.bat}">${m.bat}</button>
              </td>
              <td><strong style="color:${initColor}">${m.init.toUpperCase()}</strong></td>
              <td>${m.err_in}"</td>
              <td>${m.ovt ? `<strong style="color:#7c3aed">↺ Overturned</strong>` : (m.chal ? "Upheld" : "Unchallenged")}</td>
              <td>
                <div class="cell-bar-wrap">
                  <span>+${m.re.toFixed(3)}</span>
                  <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${reBar}%;background:#dc2626"></div></div>
                </div>
              </td>
            </tr>
          `;
          }).join("") : `<tr><td colspan="7">Zero missed calls recorded.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  els.scorecardPanel.querySelectorAll(".pill-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.pitchFilter = b.dataset.pf;
      renderScorecard();
    });
  });

  els.scorecardPanel.querySelectorAll("[data-ump]").forEach((btn) => {
    btn.addEventListener("click", () => openUmpireModal(btn.dataset.ump));
  });

  els.scorecardPanel.querySelectorAll(".player-link").forEach((btn) => {
    btn.addEventListener("click", () => openPlayerModal(btn.dataset.player));
  });

  hydratePlayerHeadshots(els.scorecardPanel);

  bindTooltipTargets(els.scorecardPanel);

  const detailEl = document.getElementById("hoverDetail");
  els.scorecardPanel.querySelectorAll(".pitch-dot").forEach((dot) => {
    const showDetail = () => {
      const p = filtered[Number(dot.dataset.idx)];
      detailEl.innerHTML = `
        <strong>${p.inn} · ${p.cnt}</strong> ·
        <img src="${umpAvatarUrl(0, p.bat)}" alt="" class="player-avatar player-link" data-player="${p.bat}" data-player-img="${p.bat}" />
        <button type="button" class="ump-link player-link" data-player="${p.bat}">${p.bat}</button>
        vs.
        <img src="${umpAvatarUrl(0, p.pit)}" alt="" class="player-avatar player-link" data-player="${p.pit}" data-player-img="${p.pit}" />
        <button type="button" class="ump-link player-link" data-player="${p.pit}">${p.pit}</button><br/>
        Initial: <strong>${p.init.toUpperCase()}</strong> | Hawk-Eye: <strong>${p.true.toUpperCase()}</strong><br/>
        Edge margin: <strong>${p.margin_in}"</strong> ${p.ovt ? "· <strong style='color:#7c3aed'>↺ ABS OVERTURNED</strong>" : ""}
      `;
      detailEl.querySelectorAll(".player-link").forEach((b) => {
        b.addEventListener("click", () => openPlayerModal(b.dataset.player));
      });
      hydratePlayerHeadshots(detailEl);
    };
    dot.addEventListener("mouseenter", showDetail);
    dot.addEventListener("click", showDetail);
  });
}

function miriamCount(pct) {
  if (pct === null || pct === undefined) return 0;
  if (pct < 88.5) return 5;
  if (pct < 90.0) return 4;
  if (pct < 91.5) return 3;
  if (pct < 93.0) return 2;
  return 1;
}

function getUmpireViewRow(u, lvl) {
  if (lvl && lvl !== "ALL" && u.level_splits && u.level_splits[lvl]) {
    // Use the strict level split so Double-A stats never contaminate Triple-A / FSL Hawk-Eye averages
    return { ...u.level_splits[lvl], all_levels: u.levels, level_splits: u.level_splits };
  }
  if (lvl === "ALL" && u.level_splits && u.level_splits.HAWKEYE && u.levels.includes("AA") && u.levels.length > 1) {
    // Ensure All-Levels view shows pure Hawk-Eye grading alongside combined game/taken counts
    return {
      ...u,
      tol_acc_pct: u.level_splits.HAWKEYE.tol_acc_pct,
      acc_pct: u.level_splits.HAWKEYE.acc_pct,
      all_levels: u.levels,
      level_splits: u.level_splits,
    };
  }
  return { ...u, all_levels: u.levels };
}

function renderLeaderboard() {
  const lvl = els.levelFilter.value;
  const minP = Number(els.minPitches.value) || 0;
  const q = state.searchQuery || "";

  const filteredRows = state.leaderboard
    .filter((u) => {
      if (lvl !== "ALL" && !u.levels.includes(lvl)) return false;
      if (q && !u.umpire_name.toLowerCase().includes(q)) return false;
      if (state.photoOnly && !state.avatarIndex?.[String(u.umpire_id)]?.photo) return false;
      return true;
    })
    .map((u) => getUmpireViewRow(u, lvl))
    .filter((u) => u.taken >= minP);

  const col = state.sortCol || (lvl === "AA" ? "called_strike_pct" : "tol_acc_pct");
  const dir = state.sortAsc ? 1 : -1;

  const rows = [...filteredRows].sort((a, b) => {
    if (col === "umpire_name") {
      return dir * a.umpire_name.localeCompare(b.umpire_name);
    }
    if (col === "levels") {
      return dir * (a.all_levels || a.levels).join(",").localeCompare((b.all_levels || b.levels).join(","));
    }
    if (col === "rating") {
      const ma = miriamCount(a.tol_acc_pct);
      const mb = miriamCount(b.tol_acc_pct);
      if (ma === 0 && mb === 0) return (b.called_strike_pct || 0) - (a.called_strike_pct || 0);
      if (ma === 0) return 1;
      if (mb === 0) return -1;
      const diff = ma - mb;
      return diff !== 0 ? dir * diff : ((a.tol_acc_pct || 0) - (b.tol_acc_pct || 0)) * -dir;
    }
    const rawA = a[col];
    const rawB = b[col];
    const nullA = rawA === null || rawA === undefined;
    const nullB = rawB === null || rawB === undefined;
    if (nullA && nullB) return (b.called_strike_pct || 0) - (a.called_strike_pct || 0) || (b.games || 0) - (a.games || 0);
    if (nullA) return 1;
    if (nullB) return -1;
    const va = Number(rawA);
    const vb = Number(rawB);
    if (va !== vb) return dir * (va - vb);
    return (b.missed || 0) - (a.missed || 0) || (b.taken || 0) - (a.taken || 0);
  });

  if (els.leaderboardViz && filteredRows.length) {
    if (lvl === "AA") {
      const topCs5 = [...filteredRows].sort((a, b) => (b.called_strike_pct || 0) - (a.called_strike_pct || 0)).slice(0, 5);
      const topK5 = [...filteredRows].sort((a, b) => (b.k_pct || 0) - (a.k_pct || 0)).slice(0, 5);
      const topRuns5 = [...filteredRows].sort((a, b) => (b.runs_per_game || 0) - (a.runs_per_game || 0)).slice(0, 5);
      const maxRuns = Math.max(1, ...topRuns5.map((u) => u.runs_per_game || 0));

      els.leaderboardViz.innerHTML = `
        <div class="viz-card">
          <h3>⚾ Highest Called Strike % (Top 5 AA)</h3>
          ${topCs5.map((u) => {
            const w = Math.max(15, Math.min(100, ((u.called_strike_pct || 0) / 42) * 100)).toFixed(0);
            return `
              <div class="bar-row">
                <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#1d4ed8"></div></div>
                <strong>${fmt1(u.called_strike_pct || 0)}%</strong>
              </div>
            `;
          }).join("")}
        </div>

        <div class="viz-card">
          <h3>🔥 Highest Strikeout Rate K% (Top 5 AA)</h3>
          ${topK5.map((u) => {
            const w = Math.max(15, Math.min(100, ((u.k_pct || 0) / 35) * 100)).toFixed(0);
            return `
              <div class="bar-row">
                <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#7c3aed"></div></div>
                <strong>${u.k_pct != null ? fmt1(u.k_pct) + "%" : "—"}</strong>
              </div>
            `;
          }).join("")}
        </div>

        <div class="viz-card">
          <h3>🏟️ Highest Runs Per Game (Top 5 AA)</h3>
          ${topRuns5.map((u) => {
            const w = (((u.runs_per_game || 0) / maxRuns) * 100).toFixed(0);
            return `
              <div class="bar-row">
                <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#15803d"></div></div>
                <strong>${Number(u.runs_per_game || 0).toFixed(1)}</strong>
              </div>
            `;
          }).join("")}
        </div>
      `;
    } else {
      const heRows = filteredRows.filter((u) => u.tol_acc_pct !== null && u.tol_acc_pct !== undefined);
      const grumpiest5 = [...heRows].sort((a, b) => a.tol_acc_pct - b.tol_acc_pct || (b.missed || 0) - (a.missed || 0)).slice(0, 5);
      const mostOverturned5 = [...heRows].sort((a, b) => (b.overturns || 0) - (a.overturns || 0)).slice(0, 5);
      const maxOvt = Math.max(1, ...mostOverturned5.map((u) => u.overturns || 0));
      const highestRe5 = [...heRows].sort((a, b) => (b.re_impact || 0) - (a.re_impact || 0)).slice(0, 5);
      const maxRe = Math.max(1, ...highestRe5.map((u) => u.re_impact || 0));

      els.leaderboardViz.innerHTML = `
        <div class="viz-card">
          <h3>💩 Lowest Tol Accuracy (Bottom 5)</h3>
          ${grumpiest5.map((u) => {
            const w = Math.max(12, Math.min(100, ((97 - u.tol_acc_pct) / 10) * 100)).toFixed(0);
            return `
              <div class="bar-row">
                <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#5c3a21"></div></div>
                <strong>${fmt1(u.tol_acc_pct)}%</strong>
              </div>
            `;
          }).join("")}
        </div>

        <div class="viz-card">
          <h3>↺ Most ABS Overturns (Top 5)</h3>
          ${mostOverturned5.map((u) => {
            const w = (((u.overturns || 0) / maxOvt) * 100).toFixed(0);
            return `
              <div class="bar-row">
                <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#7c3aed"></div></div>
                <strong>${u.overturns}</strong>
              </div>
            `;
          }).join("")}
        </div>

        <div class="viz-card">
          <h3>👍 Highest Cumulative ΔRE24 (Top 5)</h3>
          ${highestRe5.map((u) => {
            const w = (((u.re_impact || 0) / maxRe) * 100).toFixed(0);
            return `
              <div class="bar-row">
                <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
                <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#15803d"></div></div>
                <strong>${u.re_impact}</strong>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }
  }

  const maxReRow = Math.max(1, ...rows.map((u) => u.re_impact || 0));

  els.leaderboardBody.innerHTML = rows.map((u, idx) => {
    const hasHe = u.tol_acc_pct !== null && u.tol_acc_pct !== undefined;
    const color = hasHe ? accColor(u.tol_acc_pct) : "#1d4ed8";
    const accBar = hasHe ? Math.max(0, Math.min(100, ((u.tol_acc_pct - 80) / 18) * 100)).toFixed(0) : 0;
    const reBar = hasHe ? Math.min(100, ((u.re_impact || 0) / maxReRow) * 100).toFixed(0) : 0;
    const csBar = Math.max(0, Math.min(100, (((u.called_strike_pct || 0) - 20) / 25) * 100)).toFixed(0);
    const displayLevels = (u.all_levels || u.levels || []).join(", ");

    return `
    <tr>
      <td>${idx + 1}</td>
      <td>
        <img src="${umpAvatarUrl(u.umpire_id, u.umpire_name)}" alt="${u.umpire_name}" class="ump-avatar" data-ump="${u.umpire_id}" loading="lazy" />
        <button type="button" class="ump-link" data-ump="${u.umpire_id}">${u.umpire_name}</button>
      </td>
      <td>${grumpBadge(u.tol_acc_pct, u.called_strike_pct)}</td>
      <td class="col-levels">${displayLevels}</td>
      <td>${u.games.toLocaleString()}</td>
      <td>${u.taken.toLocaleString()}</td>
      <td>
        <div class="cell-bar-wrap">
          <strong style="color:#1d4ed8;min-width:42px">${fmt1(u.called_strike_pct || 0)}%</strong>
          <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${csBar}%;background:#1d4ed8"></div></div>
        </div>
      </td>
      <td class="col-aa-metric">${u.k_pct != null ? fmt1(u.k_pct) + "%" : "—"}</td>
      <td class="col-aa-metric">${u.bb_pct != null ? fmt1(u.bb_pct) + "%" : "—"}</td>
      <td class="col-aa-metric">${u.runs_per_game != null ? Number(u.runs_per_game).toFixed(1) : "—"}</td>
      <td class="col-aa-metric">${u.ejections ?? 0}</td>
      <td class="col-he-metric">
        ${hasHe ? `
          <div class="cell-bar-wrap">
            <strong style="color:${color};min-width:44px">${fmt1(u.tol_acc_pct)}%</strong>
            <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${accBar}%;background:${color}"></div></div>
          </div>
        ` : naDashHtml()}
      </td>
      <td class="col-he-metric">${hasHe ? fmt1(u.acc_pct) + "%" : naDashHtml()}</td>
      <td class="col-he-metric">${hasHe ? (u.missed || 0).toLocaleString() : naDashHtml()}</td>
      <td class="col-he-metric">${hasHe ? u.mean_miss_in + '"' : naDashHtml()}</td>
      <td class="col-he-metric">
        ${hasHe ? `
          <div class="cell-bar-wrap">
            <span>${u.overturns}/${u.challenges} (${fmt1(u.overturn_pct || 0)}%)</span>
            <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${u.overturn_pct || 0}%;background:#7c3aed"></div></div>
          </div>
        ` : naDashHtml()}
      </td>
      <td class="col-he-metric">
        ${hasHe ? `
          <div class="cell-bar-wrap">
            <span style="min-width:42px">${u.re_impact}</span>
            <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${reBar}%;background:#d97706"></div></div>
          </div>
        ` : naDashHtml()}
      </td>
    </tr>
  `;
  }).join("");

  document.querySelectorAll("#leaderboardView [data-ump]").forEach((btn) => {
    btn.addEventListener("click", () => openUmpireModal(btn.dataset.ump, lvl !== "ALL" ? lvl : null));
  });
  bindTooltipTargets(els.leaderboardBody);

  renderBadUmpsCards(filteredRows);
}

const MIRIAM_VERDICTS = [
  "\"That outer half wasn't a strike zone, it was a zip code!\"",
  "\"Even the Hawk-Eye cameras had to rub their eyes on that call.\"",
  "\"Batter needed a boat paddle to reach those called strikes.\"",
  "\"ABS challenge button got worn down to the springs in this series.\"",
  "\"Calling pitches in the dirt like it's cricket behind the plate!\"",
  "\"Miriam's glasses fogged up just watching this strike zone drift.\"",
  "\"Generous on the corners? That pitch was in the on-deck circle!\"",
  "\"Pitchers loved it, batters wept, and the ABS system worked overtime.\"",
];

function computeAaChaosMetrics(u) {
  const csPct = Number(u.called_strike_pct || 0);
  const rawDev = csPct - 31.2;
  const absDev = Math.abs(rawDev);
  const hm = u.aa_heatmap?.cells || [];
  let outerTaken = 0;
  let outerCs = 0;
  for (let r = 0; r < hm.length; r++) {
    for (let c = 0; c < (hm[r]?.length || 0); c++) {
      if (r === 0 || r === hm.length - 1 || c === 0 || c === hm[r].length - 1) {
        outerTaken += hm[r][c]?.taken || 0;
        outerCs += hm[r][c]?.cs || 0;
      }
    }
  }
  const outerCsPct = outerTaken > 0 ? (100 * outerCs) / outerTaken : 0;
  const ejections = Number(u.ejections || 0);
  const kPct = Number(u.k_pct || 0);
  const bbPct = Number(u.bb_pct || 0);
  const runsPerGame = Number(u.runs_per_game || 0);
  const chaosScore =
    absDev * 1.4 +
    outerCs * 1.5 +
    outerCsPct * 0.4 +
    ejections * 4.5 +
    Math.max(0, bbPct - 11) * 0.6 +
    Math.max(0, runsPerGame - 11) * 0.4;

  const mCount = chaosScore >= 13.5 ? 5 : chaosScore >= 9.5 ? 4 : 3;
  let zoneTag = "AA · WILD ZONE";
  if (ejections > 0 && outerCs >= 2) zoneTag = "AA · FRINGE & HOOK";
  else if (ejections > 0) zoneTag = "AA · QUICK HOOK";
  else if (rawDev <= -3.5) zoneTag = "AA · SQUEEZE ZONE";
  else if (rawDev >= 3.0) zoneTag = "AA · BARN-DOOR ZONE";
  else if (outerCs >= 3) zoneTag = "AA · FRINGE STRIKES";

  let verdict = `"Miriam's stringer chart caught ${fmt1(csPct)}% called strikes (${rawDev >= 0 ? "+" : ""}${fmt1(rawDev)}% vs. AA norm) and ${runsPerGame.toFixed(1)} runs/game!"`;
  if (ejections > 0 && outerCs >= 2) {
    verdict = `"Rang up ${outerCs} outer-fringe called strikes beyond ±1.2σ (${fmt1(outerCsPct)}%) and tossed ${ejections} from the ballpark when they complained!"`;
  } else if (rawDev <= -5.0) {
    verdict = `"Squeezed the strike zone to a microscopic ${fmt1(csPct)}% Called Strikes (${fmt1(bbPct)}% BB rate, ${runsPerGame.toFixed(1)} Runs/G) — pitchers couldn't buy a strike!"`;
  } else if (rawDev >= 3.0) {
    verdict = `"Expanded the zone into a ${fmt1(csPct)}% Called-Strike barn door with a ${fmt1(kPct)}% strikeout rate — batters needed an oar!"`;
  } else if (outerCs >= 3) {
    verdict = `"Called ${outerCs} strikes in the outer >1.2σ perimeter ring (${fmt1(outerCsPct)}% fringe CS rate) — stringer coordinates went off the rails!"`;
  } else if (ejections > 0) {
    verdict = `"Called a ${fmt1(csPct)}% strike zone (${rawDev >= 0 ? "+" : ""}${fmt1(rawDev)}% vs. AA average) with ${ejections} ejection${ejections > 1 ? "s" : ""} and ${runsPerGame.toFixed(1)} runs per game!"`;
  } else if (bbPct >= 13.5 || runsPerGame >= 14.0) {
    verdict = `"Tight ${fmt1(csPct)}% called-strike zone fueled a ${fmt1(bbPct)}% walk parade and ${runsPerGame.toFixed(1)} combined runs per game!"`;
  }

  return {
    csPct,
    rawDev,
    absDev,
    outerTaken,
    outerCs,
    outerCsPct,
    ejections,
    kPct,
    bbPct,
    runsPerGame,
    chaosScore,
    mCount,
    zoneTag,
    verdict,
  };
}

function buildHawkEyeBadUmpCardHtml(u, idx, yrLabel) {
  const verdict = MIRIAM_VERDICTS[idx % MIRIAM_VERDICTS.length];
  const mCount = Math.max(3, miriamCount(u.tol_acc_pct));
  const pips = Array.from(
    { length: mCount },
    () => `<img src="./favicon.png" alt="Miriam" class="miriam-pip" width="18" height="18" />`
  ).join("");
  const lvls = (u.all_levels || u.levels || []).filter((l) => l !== "AA");

  return `
    <article class="baseball-card" data-ump="${u.umpire_id}" data-card-lvl="">
      <div>
        <div class="card-series-bar">
          <span>GRUMPIRE TOPPS-MISS #${String(idx + 1).padStart(2, "0")}</span>
          <span>${yrLabel}</span>
        </div>

        <div class="card-portrait-frame">
          <span class="card-level-pennant">${(lvls.length ? lvls : u.levels).join(" / ")}</span>
          <img src="${umpAvatarUrl(u.umpire_id, u.umpire_name)}" alt="${u.umpire_name}" class="card-ump-photo" loading="lazy" />
          <div class="miriam-disapproval-seal" title="Miriam Disapproves!">
            <img src="./icon.png" alt="Disapproving Miriam" />
            <div class="seal-caption">Miriam<br/>Disapproves!</div>
          </div>
        </div>

        <div class="card-name-ribbon">
          <span class="card-ump-name">${u.umpire_name}</span>
          <span class="grump-pill">${pips}</span>
        </div>
      </div>

      <div class="card-back-stats">
        <div class="card-stats-grid">
          <div class="card-stat-box">
            <span>Tol Acc%</span>
            <strong style="color:#dc2626">${fmt1(u.tol_acc_pct)}%</strong>
          </div>
          <div class="card-stat-box">
            <span>Raw Acc%</span>
            <strong>${fmt1(u.acc_pct)}%</strong>
          </div>
          <div class="card-stat-box">
            <span>Missed Calls</span>
            <strong style="color:#b91c1c">${(u.missed || 0).toLocaleString()}</strong>
          </div>
          <div class="card-stat-box">
            <span>Mean Miss</span>
            <strong>${u.mean_miss_in}"</strong>
          </div>
          <div class="card-stat-box">
            <span>ABS Overturns</span>
            <strong style="color:#7c3aed">${u.overturns}/${u.challenges}</strong>
          </div>
          <div class="card-stat-box">
            <span>Σ ΔRE24</span>
            <strong style="color:#15803d">+${u.re_impact}</strong>
          </div>
        </div>
        <div class="card-scouting-report">
          <strong>Miriam's Scouting Report (${u.games} G · ${u.taken.toLocaleString()} Pitches):</strong> ${verdict}
        </div>
      </div>
    </article>
  `;
}

function buildAaBadUmpCardHtml(u, idx, yrLabel) {
  const m = computeAaChaosMetrics(u);
  const pips = Array.from(
    { length: m.mCount },
    () => `<img src="./favicon.png" alt="Miriam" class="miriam-pip" width="18" height="18" />`
  ).join("");
  const devStr = `${m.rawDev >= 0 ? "+" : ""}${fmt1(m.rawDev)}%`;
  const devColor = m.absDev >= 4.0 ? "#dc2626" : "#d97706";

  return `
    <article class="baseball-card" data-ump="${u.umpire_id}" data-card-lvl="AA">
      <div>
        <div class="card-series-bar" style="background:#1e3a8a;color:#fef08a">
          <span>GRUMPIRE DOUBLE-A #${String(idx + 1).padStart(2, "0")}</span>
          <span>${yrLabel} · AA</span>
        </div>

        <div class="card-portrait-frame">
          <span class="card-level-pennant" style="background:#1d4ed8;color:#fff">${m.zoneTag}</span>
          <img src="${umpAvatarUrl(u.umpire_id, u.umpire_name)}" alt="${u.umpire_name}" class="card-ump-photo" loading="lazy" />
          <div class="miriam-disapproval-seal" title="Miriam Disapproves of this AA Zone!">
            <img src="./icon.png" alt="Disapproving Miriam" />
            <div class="seal-caption">Miriam<br/>Disapproves!</div>
          </div>
        </div>

        <div class="card-name-ribbon">
          <span class="card-ump-name">${u.umpire_name}</span>
          <span class="grump-pill" title="${m.mCount}/5 Miriam AA Zone-Chaos Rating">${pips}</span>
        </div>
      </div>

      <div class="card-back-stats">
        <div class="card-stats-grid">
          <div class="card-stat-box" title="Called Strike Percentage (Called Strikes / Taken Pitches)">
            <span>Called Strike%</span>
            <strong style="color:#1d4ed8">${fmt1(m.csPct)}%</strong>
          </div>
          <div class="card-stat-box" title="Deviation from the 31.2% Double-A Called Strike average">
            <span>Zone vs AA Avg</span>
            <strong style="color:${devColor}">${devStr}</strong>
          </div>
          <div class="card-stat-box" title="Called strikes outside ±1.2 SD in venue-normalized Gameday stringer coordinates">
            <span>Fringe CS (&gt;1.2σ)</span>
            <strong style="color:#b91c1c">${m.outerCs} (${fmt1(m.outerCsPct)}%)</strong>
          </div>
          <div class="card-stat-box" title="Strikeout percentage across completed plate appearances">
            <span>Strikeout K%</span>
            <strong style="color:#7c3aed">${fmt1(m.kPct)}%</strong>
          </div>
          <div class="card-stat-box" title="Walk percentage across completed plate appearances">
            <span>Walk Rate BB%</span>
            <strong style="color:#d97706">${fmt1(m.bbPct)}%</strong>
          </div>
          <div class="card-stat-box" title="Combined runs per game and ejections">
            <span>Runs/G · Ej</span>
            <strong style="color:#15803d">${m.runsPerGame.toFixed(1)} · ${m.ejections} Ej</strong>
          </div>
        </div>
        <div class="card-scouting-report">
          <strong>Miriam's AA Scouting Report (${u.games} G · ${u.taken.toLocaleString()} Taken · No Hawk-Eye):</strong> ${m.verdict}
        </div>
      </div>
    </article>
  `;
}

function getTopAaBadUmps(sourceList, minP) {
  const q = state.searchQuery || "";
  const aaRows = (sourceList || [])
    .filter((u) => {
      if (!u.levels?.includes("AA")) return false;
      if (q && !u.umpire_name.toLowerCase().includes(q)) return false;
      if (state.photoOnly && !state.avatarIndex?.[String(u.umpire_id)]?.photo) return false;
      return true;
    })
    .map((u) => getUmpireViewRow(u, "AA"))
    .filter((u) => u.taken >= Math.min(minP, 150));

  const pool = aaRows.length
    ? aaRows
    : (state.leaderboardByYear["ALL"] || state.leaderboard || [])
        .filter((u) => u.levels?.includes("AA"))
        .map((u) => getUmpireViewRow(u, "AA"));

  return [...pool]
    .sort((a, b) => computeAaChaosMetrics(b).chaosScore - computeAaChaosMetrics(a).chaosScore)
    .slice(0, 12);
}

function renderBadUmpsCards(filteredRows) {
  if (!els.badUmpsGrid) return;
  const lvl = els.levelFilter.value;
  const titleEl = document.getElementById("badUmpsTitle");
  const descEl = document.getElementById("badUmpsDesc");
  const aaSectionEl = document.getElementById("badUmpsAaSection");
  const aaGridEl = document.getElementById("badUmpsAaGrid");

  document.querySelectorAll("#badUmpsLevelPills [data-bu-lvl]").forEach((p) => {
    p.classList.toggle("active", p.dataset.buLvl === lvl);
  });

  const yrLabel = state.selectedYear === "ALL" ? "2023–2026" : state.selectedYear;
  const minP = Number(els.minPitches.value) || 0;

  if (lvl === "AA") {
    if (titleEl) titleEl.textContent = "MIRIAM'S HALL OF SHAME — DOUBLE-A (AA) WILD ZONE EDITION";
    if (descEl) {
      descEl.textContent =
        "Double-A ballparks do not have Hawk-Eye optical tracking — these 12 cards spotlight the wildest Called-Strike % zone deviations from the 31.2% AA norm, outer-perimeter stringer called strikes (>1.2σ), walk-fests, and ejections. Click any card to inspect their 6×6 Venue-Normalized Heatmap.";
    }
    if (aaSectionEl) aaSectionEl.classList.add("hidden");

    const worstAa = getTopAaBadUmps(state.leaderboard, minP);
    els.badUmpsGrid.innerHTML = worstAa.map((u, idx) => buildAaBadUmpCardHtml(u, idx, yrLabel)).join("");
  } else {
    if (titleEl) {
      titleEl.textContent =
        lvl === "ALL"
          ? "MIRIAM'S HALL OF SHAME — SERIES 1 TRADING CARDS (AAA & FSL)"
          : `MIRIAM'S HALL OF SHAME — ${lvl} TRADING CARDS`;
    }
    if (descEl) {
      descEl.textContent =
        "The Worst of the Worst Home Plate Umpires (Ranked by Lowest Tolerance-Adjusted Hawk-Eye Accuracy). Click any card to inspect their full game log or scroll down for the Double-A (AA) Wild Zone Edition.";
    }

    const heOnly = filteredRows.filter((u) => u.tol_acc_pct !== null && u.tol_acc_pct !== undefined);
    const minFloor = Math.max(minP, 150);
    let worst = [...heOnly]
      .filter((u) => u.taken >= minFloor)
      .sort((a, b) => a.tol_acc_pct - b.tol_acc_pct || a.acc_pct - b.acc_pct || (b.missed || 0) - (a.missed || 0))
      .slice(0, 12);

    if (!worst.length) {
      worst = [...heOnly]
        .sort((a, b) => a.tol_acc_pct - b.tol_acc_pct || (b.missed || 0) - (a.missed || 0))
        .slice(0, 12);
    }

    els.badUmpsGrid.innerHTML = worst.map((u, idx) => buildHawkEyeBadUmpCardHtml(u, idx, yrLabel)).join("");

    if (aaSectionEl && aaGridEl) {
      if (lvl === "ALL") {
        const worstAa = getTopAaBadUmps(state.leaderboard, minP);
        aaGridEl.innerHTML = worstAa.map((u, idx) => buildAaBadUmpCardHtml(u, idx, yrLabel)).join("");
        aaSectionEl.classList.toggle("hidden", worstAa.length === 0);
      } else {
        aaSectionEl.classList.add("hidden");
      }
    }
  }

  document.querySelectorAll("#badUmpsView .baseball-card").forEach((card) => {
    card.addEventListener("click", () => {
      const cardLvl = card.dataset.cardLvl || (els.levelFilter.value !== "ALL" ? els.levelFilter.value : null);
      openUmpireModal(card.dataset.ump, cardLvl);
    });
  });
}

async function applyYearSelection(yearKey, reloadSlate = true) {
  state.selectedYear = yearKey;
  if (!state.leaderboardByYear[yearKey]) {
    const file = yearKey === "ALL" ? "./data/umpires/leaderboard.json" : `./data/umpires/leaderboard_${yearKey}.json`;
    try {
      state.leaderboardByYear[yearKey] = await getJSON(file);
    } catch {
      state.leaderboardByYear[yearKey] = state.leaderboardByYear["ALL"] || [];
    }
  }
  state.leaderboard = state.leaderboardByYear[yearKey] || [];

  const totalsMap = state.manifest.totals_by_year || {};
  const t = totalsMap[yearKey] || state.manifest.totals;
  const label = yearKey === "ALL" ? "All Seasons" : `${yearKey} Season`;
  els.totals.textContent = `${label} · ${t.games.toLocaleString()} Games · ${t.pitches.toLocaleString()} Taken Pitches · ${t.umpires.toLocaleString()} Umpires`;

  const datesForYear = state.manifest.available_dates.filter((d) => yearKey === "ALL" || d.startsWith(yearKey));
  const prevDate = els.dateSelect.value;
  els.dateSelect.innerHTML = datesForYear.map((d) => `<option value="${d}">${d}</option>`).join("");

  renderLeaderboard();
  if (reloadSlate && datesForYear.length) {
    const nextDate = datesForYear.includes(prevDate) ? prevDate : datesForYear[0];
    els.dateSelect.value = nextDate;
    await loadDateSlate(nextDate);
  }
}

// Ballpark Organ Synthesizer ("Take Me Out to the Ball Game" in C Harmonic Minor - Grumpire Funeral/Villain Waltz with 3/4 Oom-Pah-Pah accompaniment)
const organ = {
  ctx: null,
  muted: false,
  playing: false,
  timer: null,
  noteIdx: 0,
  beatCount: 0,
  // Transposed from C Major to C Harmonic Minor (Eb = 311.13 Hz, Ab = 415.30 Hz, B natural = 493.88 Hz, F# dim = 369.99 Hz)
  // Minor Chords: Cm = [261.63, 311.13, 392.00], G7b9 = [246.94, 349.23, 415.30], Fm = [261.63, 349.23, 415.30],
  //               Ddim7 = [293.66, 349.23, 415.30], Ab7 = [261.63, 311.13, 415.30], G7 = [246.94, 349.23, 392.00]
  melody: [
    // m.1-4: "Take me out to the ball game," (Cm -> G7b9)
    [261.63, 2, 130.81, [261.63, 311.13, 392.00]],
    [523.25, 1, 130.81, [261.63, 311.13, 392.00]],
    [415.30, 1, 130.81, [261.63, 311.13, 392.00]],
    [392.00, 1, 130.81, [261.63, 311.13, 392.00]],
    [311.13, 1, 130.81, [261.63, 311.13, 392.00]],
    [392.00, 3, 98.00,  [246.94, 349.23, 415.30]],
    [293.66, 3, 98.00,  [246.94, 349.23, 415.30]],

    // m.5-8: "Take me out with the crowd;" (Cm -> G7b9)
    [261.63, 2, 130.81, [261.63, 311.13, 392.00]],
    [523.25, 1, 130.81, [261.63, 311.13, 392.00]],
    [415.30, 1, 130.81, [261.63, 311.13, 392.00]],
    [392.00, 1, 130.81, [261.63, 311.13, 392.00]],
    [311.13, 1, 130.81, [261.63, 311.13, 392.00]],
    [392.00, 6, 98.00,  [246.94, 349.23, 415.30]],

    // m.9-12: "Buy me some pea-nuts and Crack-er Jack," (Fm -> Ddim7 -> Fm)
    [415.30, 1, 174.61, [261.63, 349.23, 415.30]],
    [392.00, 1, 174.61, [261.63, 349.23, 415.30]],
    [415.30, 1, 174.61, [261.63, 349.23, 415.30]],
    [311.13, 1, 146.83, [293.66, 349.23, 415.30]],
    [349.23, 1, 146.83, [293.66, 349.23, 415.30]],
    [392.00, 1, 146.83, [293.66, 349.23, 415.30]],
    [415.30, 2, 174.61, [261.63, 349.23, 415.30]],
    [349.23, 1, 174.61, [261.63, 349.23, 415.30]],
    [293.66, 3, 146.83, [293.66, 349.23, 415.30]],

    // m.13-16: "I don't care if I nev-er get back," (Ddim7 -> G7b9)
    [415.30, 2, 146.83, [293.66, 349.23, 415.30]],
    [415.30, 1, 146.83, [293.66, 349.23, 415.30]],
    [415.30, 1, 146.83, [293.66, 349.23, 415.30]],
    [493.88, 1, 146.83, [293.66, 349.23, 415.30]],
    [523.25, 1, 146.83, [293.66, 349.23, 415.30]],
    [587.33, 1, 98.00,  [246.94, 349.23, 415.30]],
    [493.88, 1, 98.00,  [246.94, 349.23, 415.30]],
    [415.30, 1, 98.00,  [246.94, 349.23, 415.30]],
    [392.00, 3, 98.00,  [246.94, 349.23, 415.30]],

    // m.17-20: "Let me root, root, root for the home team," (Cm -> G7b9)
    [261.63, 2, 130.81, [261.63, 311.13, 392.00]],
    [523.25, 1, 130.81, [261.63, 311.13, 392.00]],
    [415.30, 1, 130.81, [261.63, 311.13, 392.00]],
    [392.00, 1, 130.81, [261.63, 311.13, 392.00]],
    [311.13, 1, 130.81, [261.63, 311.13, 392.00]],
    [392.00, 3, 98.00,  [246.94, 349.23, 415.30]],
    [293.66, 2, 98.00,  [246.94, 349.23, 415.30]],
    [293.66, 1, 98.00,  [246.94, 349.23, 415.30]],

    // m.21-24: "If they don't win it's a shame," (Cm -> Ab7 -> Fm)
    [261.63, 2, 130.81, [261.63, 311.13, 392.00]],
    [293.66, 1, 130.81, [261.63, 311.13, 392.00]],
    [311.13, 1, 103.83, [261.63, 311.13, 415.30]],
    [349.23, 1, 103.83, [261.63, 311.13, 415.30]],
    [392.00, 1, 103.83, [261.63, 311.13, 415.30]],
    [415.30, 6, 174.61, [261.63, 349.23, 415.30]],

    // m.25-28: "For it's ONE! TWO! THREE strikes, you're out," (Fm -> Cm -> Ddim7 -> G7b9)
    [415.30, 2, 174.61, [261.63, 349.23, 415.30]],
    [493.88, 1, 174.61, [261.63, 349.23, 415.30]],
    [523.25, 3, 130.81, [261.63, 311.13, 392.00]], // "ONE!" (Cm)
    [523.25, 3, 130.81, [261.63, 311.13, 392.00]], // "TWO!" (Cm)
    [523.25, 1, 146.83, [293.66, 349.23, 415.30]], // "THREE" (Ddim7)
    [493.88, 1, 146.83, [293.66, 349.23, 415.30]], // "strikes,"
    [415.30, 1, 146.83, [293.66, 349.23, 415.30]], // "you're" (Ab!)
    [392.00, 1, 98.00,  [246.94, 349.23, 415.30]], // "out,"
    [369.99, 1, 98.00,  [246.94, 349.23, 415.30]], // chromatic F# neighbor
    [392.00, 1, 98.00,  [246.94, 349.23, 415.30]],

    // m.29-32: "At the old ball game!" (Ab7 -> G7b9 -> Cm dramatic minor resolution)
    [415.30, 3, 103.83, [261.63, 311.13, 415.30]], // "At" (Ab!)
    [493.88, 3, 98.00,  [246.94, 349.23, 415.30]], // "the" (B natural over G7b9)
    [523.25, 6, 130.81, [261.63, 311.13, 392.00]], // "old ball game!" (Cm)
    [0,      3, 0,      []],
  ],
  updateBtn() {
    const btn = document.getElementById("organToggleBtn");
    if (!btn) return;
    if (this.muted) {
      btn.textContent = "🔊 Play Organ";
      btn.classList.remove("active");
    } else {
      btn.textContent = "🔇 Mute Organ";
      btn.classList.add("active");
    }
  },
  voicePipe(freq, startTime, durSec, gainVal, vibratoHz = 5.8, vibratoDepth = 2.8) {
    if (!this.ctx || freq <= 0) return;
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.0005, startTime);
    master.gain.linearRampToValueAtTime(gainVal, startTime + 0.02);
    master.gain.setValueAtTime(gainVal * 0.9, startTime + Math.max(0.03, durSec - 0.04));
    master.gain.exponentialRampToValueAtTime(0.0005, startTime + durSec);

    // Warm low-pass filter so the organ sounds like wooden stadium pipes rather than raw buzz
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2400, startTime);
    master.connect(filter);
    filter.connect(this.ctx.destination);

    // Rotary Leslie speaker vibrato LFO
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.setValueAtTime(vibratoHz, startTime);
    lfoGain.gain.setValueAtTime(vibratoDepth, startTime);
    lfo.connect(lfoGain);
    lfo.start(startTime);
    lfo.stop(startTime + durSec + 0.03);

    // Hammond theater organ drawbar harmonics (8', 4', 2 2/3', 2', 1 3/5')
    [
      [1.0, 0.50, "sine"],
      [2.0, 0.32, "triangle"],
      [3.0, 0.14, "sine"],
      [4.0, 0.10, "sine"],
      [5.0, 0.05, "sine"],
    ].forEach(([mult, weight, type]) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * mult, startTime);
      lfoGain.connect(osc.frequency);
      g.gain.setValueAtTime(weight, startTime);
      osc.connect(g);
      g.connect(master);
      osc.start(startTime);
      osc.stop(startTime + durSec + 0.03);
    });
  },
  scheduleStep(freq, beats, bassHz, chordNotes, beatSec) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const durSec = beats * beatSec;

    // 1. Lead theater organ melody voice
    if (freq > 0) {
      this.voicePipe(freq, now, durSec * 0.92, 0.065, 6.0, 3.2);
      // Add upper calliope octave shimmer
      this.voicePipe(freq * 2, now, durSec * 0.88, 0.018, 6.0, 5.5);
    }

    // 2. 3/4 Waltz "Oom-Pah-Pah" left-hand accompaniment (beat 0 = Bass "Oom", beats 1 & 2 = Staccato Chord "Pah-Pah")
    for (let b = 0; b < beats; b++) {
      const bStart = now + b * beatSec;
      const measureBeat = (this.beatCount + b) % 3;
      if (measureBeat === 0 && bassHz > 0) {
        // Deep pedal bass "Oom" on beat 1 of the 3/4 measure
        this.voicePipe(bassHz, bStart, beatSec * 0.75, 0.055, 0.5, 0.2);
      } else if (measureBeat > 0 && chordNotes && chordNotes.length) {
        // Bouncy staccato "Pah" chord on beats 2 & 3 of the 3/4 measure
        chordNotes.forEach((cFreq) => {
          this.voicePipe(cFreq, bStart, beatSec * 0.45, 0.016, 5.5, 1.5);
        });
      }
    }
  },
  step() {
    if (this.muted) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    const [freq, beats, bassHz, chordNotes] = this.melody[this.noteIdx];
    const beatSec = 0.27; // Lively ballpark waltz tempo (~220 quarter-notes/min, ~74 dotted-half measures/min)
    const durSec = beats * beatSec;
    if (this.ctx.state === "running") {
      this.scheduleStep(freq, beats, bassHz, chordNotes, beatSec);
      this.beatCount += beats;
      this.noteIdx = (this.noteIdx + 1) % this.melody.length;
      if (this.noteIdx === 0) this.beatCount = 0;
    }
    this.timer = setTimeout(() => this.step(), durSec * 1000);
  },
  start() {
    if (this.playing) return;
    this.playing = true;
    this.updateBtn();
    this.step();
    const unlock = () => {
      if (this.ctx && this.ctx.state === "suspended" && !this.muted) {
        this.ctx.resume();
      }
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
  },
  toggle() {
    this.muted = !this.muted;
    if (this.muted) {
      if (this.timer) clearTimeout(this.timer);
      if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
    } else {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      this.step();
    }
    this.updateBtn();
  },
};

async function init() {
  setupTabs();
  try {
    state.manifest = await getJSON("./data/manifest.json");
    try {
      state.avatarIndex = await getJSON("./data/avatars/index.json");
    } catch {
      state.avatarIndex = {};
    }
    state.leaderboardByYear["ALL"] = await getJSON("./data/umpires/leaderboard.json");

    const years = state.manifest.available_years || ["2026"];
    if (els.yearSelect) {
      els.yearSelect.innerHTML = [
        ...(years.length > 1 ? [`<option value="ALL">All Seasons (${years[years.length - 1]}–${years[0]})</option>`] : []),
        ...years.map((y) => `<option value="${y}">${y}</option>`),
      ].join("");
    }

    const defaultYear = years.length > 1 ? "ALL" : (years[0] || "ALL");
    if (els.yearSelect) els.yearSelect.value = defaultYear;
    await applyYearSelection(defaultYear, true);
  } catch {
    els.totals.textContent = "No data ingested yet — run pipeline/ingest.py first.";
  }
}

init();
