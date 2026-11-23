const state = {
  manifest: null,
  leaderboard: [],
  activeGame: null,
  pitchFilter: "ALL", // ALL | MISSED | CHAL
};

const els = {
  totals: document.getElementById("seasonTotals"),
  dateSelect: document.getElementById("dateSelect"),
  dateControls: document.getElementById("dateControls"),
  leaderControls: document.getElementById("leaderControls"),
  slateView: document.getElementById("slateView"),
  leaderboardView: document.getElementById("leaderboardView"),
  gamesList: document.getElementById("gamesList"),
  scorecardPanel: document.getElementById("scorecardPanel"),
  leaderboardBody: document.getElementById("leaderboardBody"),
  levelFilter: document.getElementById("levelFilter"),
  minPitches: document.getElementById("minPitches"),
};

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.view;
      const isSlate = target === "slateView";
      els.slateView.classList.toggle("hidden", !isSlate);
      els.dateControls.classList.toggle("hidden", !isSlate);
      els.leaderboardView.classList.toggle("hidden", isSlate);
      els.leaderControls.classList.toggle("hidden", isSlate);
    });
  });

  els.dateSelect.addEventListener("change", () => loadDateSlate(els.dateSelect.value));
  els.levelFilter.addEventListener("change", renderLeaderboard);
  els.minPitches.addEventListener("input", renderLeaderboard);
}

async function loadDateSlate(dateStr) {
  if (!dateStr) return;
  els.gamesList.innerHTML = `<div class="empty-state">Loading ${dateStr}…</div>`;
  const data = await getJSON(`./data/dates/${dateStr}.json`);

  if (!data.games.length) {
    els.gamesList.innerHTML = `<div class="empty-state">No tracked AAA or FSL games on ${dateStr}.</div>`;
    return;
  }

  els.gamesList.innerHTML = data.games.map((g) => `
    <article class="game-card" data-pk="${g.game_pk}">
      <div class="card-top">
        <span class="matchup">${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs}</span>
        <span class="badge">${g.level}</span>
      </div>
      <div class="ump-line">HP Umpire: <strong>${g.umpire_name}</strong> · ${g.venue}</div>
      <div class="metrics-strip">
        <div class="metric-cell"><span>Raw Acc</span><strong>${g.acc_pct}%</strong></div>
        <div class="metric-cell"><span>Tol Acc</span><strong>${g.tol_acc_pct}%</strong></div>
        <div class="metric-cell"><span>Missed</span><strong>${g.missed}/${g.taken}</strong></div>
        <div class="metric-cell"><span>ABS Ovt</span><strong>${g.overturns}/${g.challenges}</strong></div>
      </div>
    </article>
  `).join("");

  els.gamesList.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("click", () => selectGame(card.dataset.pk, card));
  });

  const firstCard = els.gamesList.querySelector(".game-card");
  if (firstCard) selectGame(firstCard.dataset.pk, firstCard);
}

async function selectGame(gamePk, cardEl) {
  els.gamesList.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
  if (cardEl) cardEl.classList.add("selected");

  state.activeGame = await getJSON(`./data/games/${gamePk}.json`);
  renderScorecard();
}

function renderScorecard() {
  const g = state.activeGame;
  if (!g) return;

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

  els.scorecardPanel.innerHTML = `
    <div class="sc-header">
      <h2>${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs} · ${g.umpire_name}</h2>
      <div class="sc-sub">${g.date} · ${g.venue} · CS Acc ${g.cs_acc_pct}% · CB Acc ${g.cb_acc_pct}% · Σ ΔRE24 ${g.re_impact}</div>
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
        <rect x="${hx.toFixed(1)}" y="${hy.toFixed(1)}" width="${hw.toFixed(1)}" height="${hh.toFixed(1)}" rx="10" fill="none" stroke="#5e5d59" stroke-dasharray="4 3" stroke-width="1.2"/>
        <rect x="${zx.toFixed(1)}" y="${zy.toFixed(1)}" width="${zw.toFixed(1)}" height="${zh.toFixed(1)}" fill="#141413" fill-opacity="0.04" stroke="#141413" stroke-width="2"/>
        ${circles}
      </svg>

      <div class="pitch-readout">
        <div class="legend">
          <div><span class="dot-key" style="background:#dc2626"></span>Called Strike on True Ball</div>
          <div><span class="dot-key" style="background:#d97706"></span>Called Ball on True Strike</div>
          <div><span class="dot-key" style="border:2px solid #7c3aed"></span>Overturned by ABS Challenge</div>
          <div><span class="dot-key" style="background:#15803d;opacity:0.45"></span>Correct Initial Call</div>
        </div>
        <div id="hoverDetail">Hover any pitch dot to inspect batter, count, initial call, and miss distance.</div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Inn</th><th>Cnt</th><th>Batter</th><th>Initial</th><th>Miss (in)</th><th>ABS</th><th>ΔRE24</th></tr>
        </thead>
        <tbody>
          ${worstMisses.length ? worstMisses.map((m) => `
            <tr>
              <td>${m.inn}</td>
              <td>${m.cnt}</td>
              <td>${m.bat}</td>
              <td>${m.init.toUpperCase()}</td>
              <td>${m.err_in}"</td>
              <td>${m.ovt ? "Overturned" : (m.chal ? "Upheld" : "Unchallenged")}</td>
              <td>+${m.re.toFixed(3)}</td>
            </tr>
          `).join("") : `<tr><td colspan="7">Zero missed calls recorded.</td></tr>`}
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

  const detailEl = document.getElementById("hoverDetail");
  els.scorecardPanel.querySelectorAll(".pitch-dot").forEach((dot) => {
    dot.addEventListener("mouseenter", () => {
      const p = filtered[Number(dot.dataset.idx)];
      detailEl.innerHTML = `
        <strong>${p.inn} · ${p.cnt}</strong> · ${p.bat} vs. ${p.pit}<br/>
        Initial: <strong>${p.init.toUpperCase()}</strong> | Hawk-Eye: <strong>${p.true.toUpperCase()}</strong><br/>
        Edge margin: <strong>${p.margin_in}"</strong> ${p.ovt ? "· <strong>ABS OVERTURNED</strong>" : ""}
      `;
    });
  });
}

function renderLeaderboard() {
  const lvl = els.levelFilter.value;
  const minP = Number(els.minPitches.value) || 0;

  const rows = state.leaderboard.filter((u) => {
    if (u.taken < minP) return false;
    if (lvl !== "ALL" && !u.levels.includes(lvl)) return false;
    return true;
  });

  els.leaderboardBody.innerHTML = rows.map((u, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${u.umpire_name}</strong></td>
      <td>${u.levels.join(", ")}</td>
      <td>${u.games}</td>
      <td>${u.taken}</td>
      <td><strong>${u.acc_pct}%</strong></td>
      <td>${u.tol_acc_pct}%</td>
      <td>${u.missed}</td>
      <td>${u.mean_miss_in}"</td>
      <td>${u.overturns}/${u.challenges} (${u.overturn_pct}%)</td>
      <td>${u.re_impact}</td>
    </tr>
  `).join("");
}

async function init() {
  setupTabs();
  try {
    state.manifest = await getJSON("./data/manifest.json");
    state.leaderboard = await getJSON("./data/umpires/leaderboard.json");

    const t = state.manifest.totals;
    els.totals.textContent = `${t.games} Games · ${t.pitches.toLocaleString()} Taken Pitches · ${t.umpires} Umpires`;

    els.dateSelect.innerHTML = state.manifest.available_dates
      .map((d) => `<option value="${d}">${d}</option>`)
      .join("");

    renderLeaderboard();
    if (state.manifest.latest_date) {
      await loadDateSlate(state.manifest.latest_date);
    }
  } catch {
    els.totals.textContent = "No data ingested yet — run pipeline/ingest.py first.";
  }
}

init();
