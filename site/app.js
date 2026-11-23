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
  leaderboardViz: document.getElementById("leaderboardViz"),
  leaderboardBody: document.getElementById("leaderboardBody"),
  levelFilter: document.getElementById("levelFilter"),
  minPitches: document.getElementById("minPitches"),
  umpModal: document.getElementById("umpModal"),
  umpModalCard: document.getElementById("umpModalCard"),
  metricTipBar: document.getElementById("metricTipBar"),
  metricTipText: document.getElementById("metricTipText"),
};

function umpAvatarUrl(umpId) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${umpId}/headshot/67/current`;
}

function umpProfileLinks(umpId, umpName) {
  const apiUrl = `https://statsapi.mlb.com/api/v1/people/${umpId}`;
  const bRefUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(umpName)}`;
  const ccsUrl = `https://www.closecallsports.com/search?q=${encodeURIComponent(umpName)}`;
  return { apiUrl, bRefUrl, ccsUrl };
}

function accColor(pct) {
  if (pct < 89.5) return "#dc2626"; // High grump (red)
  if (pct < 92.5) return "#d97706"; // Mid (amber)
  return "#15803d";                 // Sharp (green)
}

function grumpBadge(pct) {
  if (pct < 89.5) {
    return `<span class="grump-pill" style="background:#fee2e2;color:#b91c1c" title="Rough zone (<89.5%)">😠 Rough</span>`;
  }
  if (pct < 92.5) {
    return `<span class="grump-pill" style="background:#fef3c7;color:#b45309" title="Shaky zone (89.5%–92.49%)">😐 Shaky</span>`;
  }
  return `<span class="grump-pill" style="background:#dcfce7;color:#15803d" title="Sharp zone (≥92.5%)">🎯 Sharp</span>`;
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
    };
    el.addEventListener("mouseenter", showTip);
    el.addEventListener("click", showTip);
  });
}

async function openUmpireModal(umpId) {
  if (!umpId || umpId === "unknown") return;
  els.umpModal.classList.remove("hidden");
  els.umpModalCard.innerHTML = `<div class="empty-state">Loading umpire profile #${umpId}…</div>`;

  try {
    const u = await getJSON(`./data/umpires/${umpId}.json`);
    const links = umpProfileLinks(u.umpire_id, u.umpire_name);
    const color = accColor(u.acc_pct);

    els.umpModalCard.innerHTML = `
      <div class="modal-top">
        <div class="modal-id-row">
          <img src="${umpAvatarUrl(u.umpire_id)}" alt="${u.umpire_name}" class="modal-avatar" />
          <div>
            <h2 style="font-size:1.35rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${u.umpire_name} ${grumpBadge(u.acc_pct)}
            </h2>
            <div class="sc-sub">MLB Official ID #${u.umpire_id} · Levels: ${u.levels.join(", ")} · ${u.games} Games (${u.taken.toLocaleString()} Taken Pitches)</div>
            <div class="ext-links">
              <a href="${links.apiUrl}" target="_blank" rel="noopener">MLB StatsAPI Profile ↗</a>
              <a href="${links.ccsUrl}" target="_blank" rel="noopener">Close Call Sports Audit ↗</a>
              <a href="${links.bRefUrl}" target="_blank" rel="noopener">Baseball-Reference Search ↗</a>
            </div>
          </div>
        </div>
        <button class="pill-btn" id="closeUmpModal">✕ Close</button>
      </div>

      <div class="sc-kpi-grid">
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>2026 Raw Acc</span><span>🎯</span></div>
          <div class="sc-kpi-val" style="color:${color}">${u.acc_pct}%</div>
          <div class="sc-sub">Tol Acc: ${u.tol_acc_pct}%</div>
        </div>
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>ABS Overturns</span><span>↺</span></div>
          <div class="sc-kpi-val" style="color:#7c3aed">${u.overturns}/${u.challenges} (${u.overturn_pct}%)</div>
          <div class="sc-sub">Total Missed: ${u.missed.toLocaleString()} (Mean ${u.mean_miss_in}")</div>
        </div>
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>Season Σ ΔRE24</span><span>⚡</span></div>
          <div class="sc-kpi-val" style="color:#dc2626">+${u.re_impact}</div>
          <div class="sc-sub">Cumulative expected runs swung</div>
        </div>
      </div>

      <h3 style="font-size:0.8rem;text-transform:uppercase;color:var(--muted);margin-bottom:8px">2026 Game Log (${u.game_log.length} Games — Click any game to open scorecard)</h3>
      <div class="table-wrap" style="max-height:360px;overflow-y:auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Lvl</th>
              <th>Matchup</th>
              <th>Taken</th>
              <th>Raw Acc%</th>
              <th>Missed</th>
              <th>ABS Ovt</th>
              <th>ΔRE24</th>
            </tr>
          </thead>
          <tbody>
            ${u.game_log.map((g) => `
              <tr class="ump-log-row" data-date="${g.date}" data-pk="${g.game_pk}" style="cursor:pointer">
                <td><strong>${g.date}</strong></td>
                <td>${g.level}</td>
                <td>${g.matchup}</td>
                <td>${g.taken}</td>
                <td><strong style="color:${accColor(g.acc_pct)}">${g.acc_pct}%</strong></td>
                <td>${g.missed}</td>
                <td>${g.overturns}</td>
                <td>+${g.re_impact}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById("closeUmpModal").addEventListener("click", () => {
      els.umpModal.classList.add("hidden");
    });

    els.umpModalCard.querySelectorAll(".ump-log-row").forEach((row) => {
      row.addEventListener("click", async () => {
        els.umpModal.classList.add("hidden");
        document.querySelector('[data-view="slateView"]').click();
        els.dateSelect.value = row.dataset.date;
        await loadDateSlate(row.dataset.date);
        const targetCard = els.gamesList.querySelector(`.game-card[data-pk="${row.dataset.pk}"]`);
        if (targetCard) selectGame(row.dataset.pk, targetCard);
      });
    });
  } catch {
    els.umpModalCard.innerHTML = `<div class="empty-state">Could not load umpire #${umpId}.</div>`;
  }
}

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

  if (els.umpModal) {
    els.umpModal.addEventListener("click", (e) => {
      if (e.target === els.umpModal) els.umpModal.classList.add("hidden");
    });
  }
  bindTooltipTargets(document);
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
    const color = accColor(g.acc_pct);
    const barW = Math.max(0, Math.min(100, ((g.acc_pct - 75) / 25) * 100)).toFixed(1);
    return `
    <article class="game-card" data-pk="${g.game_pk}">
      <div class="card-top">
        <span class="matchup">${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs}</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${grumpBadge(g.acc_pct)}
          <span class="badge">${g.level}</span>
        </div>
      </div>
      <div class="ump-line">
        <img src="${umpAvatarUrl(g.umpire_id)}" alt="" class="ump-avatar" loading="lazy" />
        HP Umpire: <button type="button" class="ump-link" data-ump="${g.umpire_id}">${g.umpire_name}</button> · ${g.venue}
      </div>
      <div class="metrics-strip">
        <div class="metric-cell" data-tip="Raw Acc: Percentage of taken pitches where the initial call matched the 2D Hawk-Eye strike zone."><span>Raw Acc <b class="th-info-badge">?</b></span><strong style="color:${color}">${g.acc_pct}%</strong></div>
        <div class="metric-cell" data-tip="Tol Acc (±0.20&quot;): Accuracy excluding borderline pitches within ±0.20 inches of the zone edge."><span>Tol Acc <b class="th-info-badge">?</b></span><strong>${g.tol_acc_pct}%</strong></div>
        <div class="metric-cell" data-tip="Missed: Total initial ball/strike calls that disagreed with Hawk-Eye out of all taken pitches."><span>Missed <b class="th-info-badge">?</b></span><strong>${g.missed}/${g.taken}</strong></div>
        <div class="metric-cell" data-tip="ABS Ovt: Calls overturned by an ABS challenge out of total challenges in this game."><span>ABS Ovt <b class="th-info-badge">?</b></span><strong style="color:#7c3aed">${g.overturns}/${g.challenges}</strong></div>
      </div>
      <div class="card-meter" title="Raw accuracy gauge (${g.acc_pct}%)">
        <div class="card-meter-fill" style="width:${barW}%;background:${color}"></div>
      </div>
    </article>
  `;
  }).join("");

  els.gamesList.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".ump-link")) return;
      selectGame(card.dataset.pk, card);
    });
  });

  els.gamesList.querySelectorAll(".ump-link").forEach((btn) => {
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
          <img src="${umpAvatarUrl(g.umpire_id)}" alt="" class="ump-avatar" />
          <span>${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs} · <button type="button" class="ump-link" data-ump="${g.umpire_id}">${g.umpire_name}</button></span>
        </h2>
        ${grumpBadge(g.acc_pct)}
      </div>
      <div class="sc-sub">${g.date} · ${g.venue} · Mean Miss ${g.mean_miss_in}" · Unchallenged Misses: ${g.unchallenged_misses}</div>
    </div>

    <div class="sc-kpi-grid">
      <div class="sc-kpi-box" data-tip="Called Strike Acc: Percentage of pitches the umpire initially called a STRIKE that genuinely clipped or entered the Hawk-Eye zone.">
        <div class="sc-kpi-label"><span>Called Strike Acc <b class="th-info-badge">?</b></span><span>🎯</span></div>
        <div class="sc-kpi-val" style="color:${accColor(g.cs_acc_pct)}">${g.cs_acc_pct}%</div>
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${g.cs_acc_pct}%;background:${accColor(g.cs_acc_pct)}"></div></div>
      </div>
      <div class="sc-kpi-box" data-tip="Called Ball Acc: Percentage of pitches the umpire initially called a BALL that were genuinely outside the Hawk-Eye zone.">
        <div class="sc-kpi-label"><span>Called Ball Acc <b class="th-info-badge">?</b></span><span>👁️</span></div>
        <div class="sc-kpi-val" style="color:${accColor(g.cb_acc_pct)}">${g.cb_acc_pct}%</div>
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
              <td>${m.bat}</td>
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

  els.scorecardPanel.querySelectorAll(".ump-link").forEach((btn) => {
    btn.addEventListener("click", () => openUmpireModal(btn.dataset.ump));
  });

  bindTooltipTargets(els.scorecardPanel);

  const detailEl = document.getElementById("hoverDetail");
  els.scorecardPanel.querySelectorAll(".pitch-dot").forEach((dot) => {
    const showDetail = () => {
      const p = filtered[Number(dot.dataset.idx)];
      detailEl.innerHTML = `
        <strong>${p.inn} · ${p.cnt}</strong> · ${p.bat} vs. ${p.pit}<br/>
        Initial: <strong>${p.init.toUpperCase()}</strong> | Hawk-Eye: <strong>${p.true.toUpperCase()}</strong><br/>
        Edge margin: <strong>${p.margin_in}"</strong> ${p.ovt ? "· <strong style='color:#7c3aed'>↺ ABS OVERTURNED</strong>" : ""}
      `;
    };
    dot.addEventListener("mouseenter", showDetail);
    dot.addEventListener("click", showDetail);
  });
}

function renderLeaderboard() {
  const lvl = els.levelFilter.value;
  const minP = Number(els.minPitches.value) || 0;

  // Sort worst accuracy first by default (ascending acc_pct, tie-break by most missed calls)
  const rows = state.leaderboard
    .filter((u) => {
      if (u.taken < minP) return false;
      if (lvl !== "ALL" && !u.levels.includes(lvl)) return false;
      return true;
    })
    .sort((a, b) => a.acc_pct - b.acc_pct || b.missed - a.missed);

  if (els.leaderboardViz && rows.length) {
    const grumpiest5 = rows.slice(0, 5);
    const mostOverturned5 = [...rows].sort((a, b) => b.overturns - a.overturns).slice(0, 5);
    const maxOvt = Math.max(1, ...mostOverturned5.map((u) => u.overturns));
    const highestRe5 = [...rows].sort((a, b) => b.re_impact - a.re_impact).slice(0, 5);
    const maxRe = Math.max(1, ...highestRe5.map((u) => u.re_impact));

    els.leaderboardViz.innerHTML = `
      <div class="viz-card">
        <h3>😠 Lowest Raw Accuracy (Bottom 5)</h3>
        ${grumpiest5.map((u) => {
          const w = Math.max(12, Math.min(100, ((96 - u.acc_pct) / 10) * 100)).toFixed(0);
          return `
            <div class="bar-row">
              <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
              <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#dc2626"></div></div>
              <strong>${u.acc_pct}%</strong>
            </div>
          `;
        }).join("")}
      </div>

      <div class="viz-card">
        <h3>↺ Most ABS Overturns (Top 5)</h3>
        ${mostOverturned5.map((u) => {
          const w = ((u.overturns / maxOvt) * 100).toFixed(0);
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
        <h3>⚡ Highest Cumulative ΔRE24 (Top 5)</h3>
        ${highestRe5.map((u) => {
          const w = ((u.re_impact / maxRe) * 100).toFixed(0);
          return `
            <div class="bar-row">
              <button type="button" class="ump-link bar-row-name" data-ump="${u.umpire_id}" title="${u.umpire_name}">${u.umpire_name}</button>
              <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#d97706"></div></div>
              <strong>${u.re_impact}</strong>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  const maxReRow = Math.max(1, ...rows.map((u) => u.re_impact));

  els.leaderboardBody.innerHTML = rows.map((u, idx) => {
    const color = accColor(u.acc_pct);
    const accBar = Math.max(0, Math.min(100, ((u.acc_pct - 80) / 18) * 100)).toFixed(0);
    const reBar = Math.min(100, (u.re_impact / maxReRow) * 100).toFixed(0);
    return `
    <tr>
      <td>${idx + 1}</td>
      <td>
        <img src="${umpAvatarUrl(u.umpire_id)}" alt="" class="ump-avatar" loading="lazy" />
        <button type="button" class="ump-link" data-ump="${u.umpire_id}">${u.umpire_name}</button>
      </td>
      <td>${grumpBadge(u.acc_pct)}</td>
      <td>${u.levels.join(", ")}</td>
      <td>${u.games.toLocaleString()}</td>
      <td>${u.taken.toLocaleString()}</td>
      <td>
        <div class="cell-bar-wrap">
          <strong style="color:${color};min-width:48px">${u.acc_pct}%</strong>
          <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${accBar}%;background:${color}"></div></div>
        </div>
      </td>
      <td>${u.tol_acc_pct}%</td>
      <td>${u.missed.toLocaleString()}</td>
      <td>${u.mean_miss_in}"</td>
      <td>
        <div class="cell-bar-wrap">
          <span>${u.overturns}/${u.challenges} (${u.overturn_pct}%)</span>
          <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${u.overturn_pct}%;background:#7c3aed"></div></div>
        </div>
      </td>
      <td>
        <div class="cell-bar-wrap">
          <span style="min-width:42px">${u.re_impact}</span>
          <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${reBar}%;background:#d97706"></div></div>
        </div>
      </td>
    </tr>
  `;
  }).join("");

  document.querySelectorAll("#leaderboardView .ump-link").forEach((btn) => {
    btn.addEventListener("click", () => openUmpireModal(btn.dataset.ump));
  });
}

async function init() {
  setupTabs();
  try {
    state.manifest = await getJSON("./data/manifest.json");
    state.leaderboard = await getJSON("./data/umpires/leaderboard.json");

    const t = state.manifest.totals;
    els.totals.textContent = `${t.games.toLocaleString()} Games · ${t.pitches.toLocaleString()} Taken Pitches · ${t.umpires.toLocaleString()} Umpires`;

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
