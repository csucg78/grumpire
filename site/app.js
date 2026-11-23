const state = {
  manifest: null,
  avatarIndex: {},
  playerCache: {},
  leaderboardByYear: {},
  leaderboard: [],
  selectedYear: "2026",
  sortCol: "tol_acc_pct",
  sortAsc: true, // true = ascending (worst tol_acc_pct first)
  photoOnly: false,
  activeGame: null,
  pitchFilter: "ALL", // ALL | MISSED | CHAL
};

const els = {
  totals: document.getElementById("seasonTotals"),
  yearSelect: document.getElementById("yearSelect"),
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

function grumpBadge(pct) {
  let count = 1;
  if (pct < 88.5) count = 5;
  else if (pct < 90.0) count = 4;
  else if (pct < 91.5) count = 3;
  else if (pct < 93.0) count = 2;

  const pips = Array.from(
    { length: count },
    () => `<img src="./favicon.png" alt="Miriam" class="miriam-pip" width="20" height="20" />`
  ).join("");

  return `<span class="grump-pill" title="${count}/5 Miriam Grumpiness Rating (${fmt1(pct)}% Raw Acc — more Miriams = worse)" aria-label="${count} out of 5 Miriams">${pips}</span>`;
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
          <img id="modalUmpAvatar" src="${umpAvatarUrl(u.umpire_id, u.umpire_name)}" alt="${u.umpire_name}" class="modal-avatar" />
          <div>
            <h2 style="font-size:1.35rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${u.umpire_name} ${grumpBadge(u.acc_pct)}
            </h2>
            <div class="sc-sub">MLB Official ID #${u.umpire_id} · Levels: ${u.levels.join(", ")} · ${u.games} Games (${u.taken.toLocaleString()} Taken Pitches)</div>
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

      <div class="sc-kpi-grid">
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>2026 Raw Acc</span><span>🎯</span></div>
          <div class="sc-kpi-val" style="color:${color}">${fmt1(u.acc_pct)}%</div>
          <div class="sc-sub">Tol Acc: ${fmt1(u.tol_acc_pct)}%</div>
        </div>
        <div class="sc-kpi-box">
          <div class="sc-kpi-label"><span>ABS Overturns</span><span>↺</span></div>
          <div class="sc-kpi-val" style="color:#7c3aed">${u.overturns}/${u.challenges} (${fmt1(u.overturn_pct)}%)</div>
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
                <td><strong style="color:${accColor(g.acc_pct)}">${fmt1(g.acc_pct)}%</strong></td>
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

    fetchWikiUmpirePhoto(
      u.umpire_name,
      document.getElementById("modalUmpAvatar"),
      document.getElementById("modalExtLinks"),
      u.umpire_id
    );

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
  } catch {
    els.umpModalCard.innerHTML = `<div class="empty-state">Could not load umpire #${umpId}.</div>`;
  }
}

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

function activateView(target, updateHash = true) {
  const isSlate = target === "slateView";
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === target);
  });
  els.slateView.classList.toggle("hidden", !isSlate);
  els.dateControls.classList.toggle("hidden", !isSlate);
  if (els.metricTipBar) els.metricTipBar.classList.toggle("hidden", !isSlate);
  els.leaderboardView.classList.toggle("hidden", isSlate);
  els.leaderControls.classList.toggle("hidden", isSlate);

  if (updateHash) {
    const newHash = isSlate ? "#/slate" : "#/leaderboard";
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  }
}

function syncViewFromUrl() {
  const h = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  if (h.includes("leaderboard") || params.get("view") === "leaderboard") {
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
  els.levelFilter.addEventListener("change", renderLeaderboard);
  els.minPitches.addEventListener("input", renderLeaderboard);

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
    const color = accColor(g.tol_acc_pct);
    const barW = Math.max(0, Math.min(100, ((g.tol_acc_pct - 75) / 25) * 100)).toFixed(1);
    return `
    <article class="game-card" data-pk="${g.game_pk}">
      <div class="card-top">
        <span class="matchup">${g.away} ${g.away_runs} @ ${g.home} ${g.home_runs}</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${grumpBadge(g.tol_acc_pct)}
          <span class="badge">${g.level}</span>
        </div>
      </div>
      <div class="ump-line">
        <img src="${umpAvatarUrl(g.umpire_id, g.umpire_name)}" alt="${g.umpire_name}" class="ump-avatar" data-ump="${g.umpire_id}" loading="lazy" />
        HP Umpire: <button type="button" class="ump-link" data-ump="${g.umpire_id}">${g.umpire_name}</button> · ${g.venue}
      </div>
      <div class="metrics-strip">
        <div class="metric-cell" data-tip="Tol Acc (±0.20&quot;): Tolerance-adjusted accuracy excluding razor-thin borderline pitches within ±0.20 inches of the zone edge."><span>Tol Acc <b class="th-info-badge">?</b></span><strong style="color:${color}">${fmt1(g.tol_acc_pct)}%</strong></div>
        <div class="metric-cell" data-tip="Raw Acc: Strict unbuffered percentage of taken pitches matching the exact 0.00&quot; 2D Hawk-Eye strike zone."><span>Raw Acc <b class="th-info-badge">?</b></span><strong>${fmt1(g.acc_pct)}%</strong></div>
        <div class="metric-cell" data-tip="Missed: Total initial ball/strike calls that disagreed with Hawk-Eye out of all taken pitches."><span>Missed <b class="th-info-badge">?</b></span><strong>${g.missed}/${g.taken}</strong></div>
        <div class="metric-cell" data-tip="ABS Ovt: Calls overturned by an ABS challenge out of total challenges in this game."><span>ABS Ovt <b class="th-info-badge">?</b></span><strong style="color:#7c3aed">${g.overturns}/${g.challenges}</strong></div>
      </div>
      <div class="card-meter" title="Tolerance accuracy gauge (${fmt1(g.tol_acc_pct)}%)">
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
  if (pct < 88.5) return 5;
  if (pct < 90.0) return 4;
  if (pct < 91.5) return 3;
  if (pct < 93.0) return 2;
  return 1;
}

function renderLeaderboard() {
  const lvl = els.levelFilter.value;
  const minP = Number(els.minPitches.value) || 0;

  const filteredRows = state.leaderboard.filter((u) => {
    if (u.taken < minP) return false;
    if (lvl !== "ALL" && !u.levels.includes(lvl)) return false;
    if (state.photoOnly && !state.avatarIndex?.[String(u.umpire_id)]?.photo) return false;
    return true;
  });

  const col = state.sortCol || "tol_acc_pct";
  const dir = state.sortAsc ? 1 : -1;

  const rows = [...filteredRows].sort((a, b) => {
    if (col === "umpire_name") {
      return dir * a.umpire_name.localeCompare(b.umpire_name);
    }
    if (col === "levels") {
      return dir * a.levels.join(",").localeCompare(b.levels.join(","));
    }
    if (col === "rating") {
      const diff = miriamCount(a.tol_acc_pct) - miriamCount(b.tol_acc_pct);
      return diff !== 0 ? dir * diff : (a.tol_acc_pct - b.tol_acc_pct) * -dir;
    }
    const va = Number(a[col]) || 0;
    const vb = Number(b[col]) || 0;
    if (va !== vb) return dir * (va - vb);
    return b.missed - a.missed;
  });

  if (els.leaderboardViz && filteredRows.length) {
    const grumpiest5 = [...filteredRows].sort((a, b) => a.tol_acc_pct - b.tol_acc_pct || b.missed - a.missed).slice(0, 5);
    const mostOverturned5 = [...filteredRows].sort((a, b) => b.overturns - a.overturns).slice(0, 5);
    const maxOvt = Math.max(1, ...mostOverturned5.map((u) => u.overturns));
    const highestRe5 = [...filteredRows].sort((a, b) => b.re_impact - a.re_impact).slice(0, 5);
    const maxRe = Math.max(1, ...highestRe5.map((u) => u.re_impact));

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
        <h3>👍 Highest Cumulative ΔRE24 (Top 5)</h3>
        ${highestRe5.map((u) => {
          const w = ((u.re_impact / maxRe) * 100).toFixed(0);
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

  const maxReRow = Math.max(1, ...rows.map((u) => u.re_impact));

  els.leaderboardBody.innerHTML = rows.map((u, idx) => {
    const color = accColor(u.tol_acc_pct);
    const accBar = Math.max(0, Math.min(100, ((u.tol_acc_pct - 80) / 18) * 100)).toFixed(0);
    const reBar = Math.min(100, (u.re_impact / maxReRow) * 100).toFixed(0);
    return `
    <tr>
      <td>${idx + 1}</td>
      <td>
        <img src="${umpAvatarUrl(u.umpire_id, u.umpire_name)}" alt="${u.umpire_name}" class="ump-avatar" data-ump="${u.umpire_id}" loading="lazy" />
        <button type="button" class="ump-link" data-ump="${u.umpire_id}">${u.umpire_name}</button>
      </td>
      <td>${grumpBadge(u.tol_acc_pct)}</td>
      <td class="col-levels">${u.levels.join(", ")}</td>
      <td>${u.games.toLocaleString()}</td>
      <td>${u.taken.toLocaleString()}</td>
      <td>
        <div class="cell-bar-wrap">
          <strong style="color:${color};min-width:44px">${fmt1(u.tol_acc_pct)}%</strong>
          <div class="cell-bar-track"><div class="cell-bar-fill" style="width:${accBar}%;background:${color}"></div></div>
        </div>
      </td>
      <td>${fmt1(u.acc_pct)}%</td>
      <td>${u.missed.toLocaleString()}</td>
      <td>${u.mean_miss_in}"</td>
      <td>
        <div class="cell-bar-wrap">
          <span>${u.overturns}/${u.challenges} (${fmt1(u.overturn_pct)}%)</span>
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

  document.querySelectorAll("#leaderboardView [data-ump]").forEach((btn) => {
    btn.addEventListener("click", () => openUmpireModal(btn.dataset.ump));
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

// Ballpark Organ Synthesizer ("Take Me Out to the Ball Game" - 1908 Albert Von Tilzer waltz with 3/4 Oom-Pah-Pah accompaniment & Leslie vibrato)
const organ = {
  ctx: null,
  muted: false,
  playing: false,
  timer: null,
  noteIdx: 0,
  beatCount: 0,
  // Exact 3/4 waltz sheet music in C Major: [melodyHz, beats, bassRootHz, chordMidHzArray]
  // Chords: C = [261.63, 329.63, 392.00], G7 = [246.94, 349.23, 392.00], D7 = [293.66, 369.99, 440.00],
  //         A7 = [277.18, 329.63, 440.00], Dm = [293.66, 349.23, 440.00], F = [261.63, 349.23, 440.00], E7 = [246.94, 329.63, 415.30]
  melody: [
    // m.1-4: "Take me out to the ball game," (C -> G7)
    [261.63, 2, 130.81, [261.63, 329.63, 392.00]],
    [523.25, 1, 130.81, [261.63, 329.63, 392.00]],
    [440.00, 1, 130.81, [261.63, 329.63, 392.00]],
    [392.00, 1, 130.81, [261.63, 329.63, 392.00]],
    [329.63, 1, 130.81, [261.63, 329.63, 392.00]],
    [392.00, 3, 98.00,  [246.94, 349.23, 392.00]],
    [293.66, 3, 98.00,  [246.94, 349.23, 392.00]],

    // m.5-8: "Take me out with the crowd;" (C -> G7)
    [261.63, 2, 130.81, [261.63, 329.63, 392.00]],
    [523.25, 1, 130.81, [261.63, 329.63, 392.00]],
    [440.00, 1, 130.81, [261.63, 329.63, 392.00]],
    [392.00, 1, 130.81, [261.63, 329.63, 392.00]],
    [329.63, 1, 130.81, [261.63, 329.63, 392.00]],
    [392.00, 6, 98.00,  [246.94, 349.23, 392.00]],

    // m.9-12: "Buy me some pea-nuts and Crack-er Jack," (Dm -> A7 -> Dm)
    [440.00, 1, 146.83, [293.66, 349.23, 440.00]],
    [392.00, 1, 146.83, [293.66, 349.23, 440.00]],
    [440.00, 1, 146.83, [293.66, 349.23, 440.00]],
    [329.63, 1, 110.00, [277.18, 329.63, 440.00]],
    [349.23, 1, 110.00, [277.18, 329.63, 440.00]],
    [392.00, 1, 110.00, [277.18, 329.63, 440.00]],
    [440.00, 2, 146.83, [293.66, 349.23, 440.00]],
    [349.23, 1, 146.83, [293.66, 349.23, 440.00]],
    [293.66, 3, 146.83, [293.66, 349.23, 440.00]],

    // m.13-16: "I don't care if I nev-er get back," (D7 -> G7)
    [440.00, 2, 146.83, [293.66, 369.99, 440.00]],
    [440.00, 1, 146.83, [293.66, 369.99, 440.00]],
    [440.00, 1, 146.83, [293.66, 369.99, 440.00]],
    [493.88, 1, 146.83, [293.66, 369.99, 440.00]],
    [523.25, 1, 146.83, [293.66, 369.99, 440.00]],
    [587.33, 1, 98.00,  [246.94, 349.23, 392.00]],
    [493.88, 1, 98.00,  [246.94, 349.23, 392.00]],
    [440.00, 1, 98.00,  [246.94, 349.23, 392.00]],
    [392.00, 3, 98.00,  [246.94, 349.23, 392.00]],

    // m.17-20: "Let me root, root, root for the home team," (C -> G7)
    [261.63, 2, 130.81, [261.63, 329.63, 392.00]],
    [523.25, 1, 130.81, [261.63, 329.63, 392.00]],
    [440.00, 1, 130.81, [261.63, 329.63, 392.00]],
    [392.00, 1, 130.81, [261.63, 329.63, 392.00]],
    [329.63, 1, 130.81, [261.63, 329.63, 392.00]],
    [392.00, 3, 98.00,  [246.94, 349.23, 392.00]],
    [293.66, 2, 98.00,  [246.94, 349.23, 392.00]],
    [293.66, 1, 98.00,  [246.94, 349.23, 392.00]],

    // m.21-24: "If they don't win it's a shame," (C -> E7 -> Am/F)
    [261.63, 2, 130.81, [261.63, 329.63, 392.00]],
    [293.66, 1, 130.81, [261.63, 329.63, 392.00]],
    [329.63, 1, 123.47, [246.94, 329.63, 415.30]],
    [349.23, 1, 123.47, [246.94, 329.63, 415.30]],
    [392.00, 1, 123.47, [246.94, 329.63, 415.30]],
    [440.00, 6, 174.61, [261.63, 349.23, 440.00]],

    // m.25-28: "For it's ONE! TWO! THREE strikes, you're out," (F -> C -> D7 -> G7)
    [440.00, 2, 174.61, [261.63, 349.23, 440.00]],
    [493.88, 1, 174.61, [261.63, 349.23, 440.00]],
    [523.25, 3, 130.81, [261.63, 329.63, 392.00]], // "ONE!"
    [523.25, 3, 130.81, [261.63, 329.63, 392.00]], // "TWO!"
    [523.25, 1, 146.83, [293.66, 369.99, 440.00]], // "THREE"
    [493.88, 1, 146.83, [293.66, 369.99, 440.00]], // "strikes,"
    [440.00, 1, 146.83, [293.66, 369.99, 440.00]], // "you're"
    [392.00, 1, 98.00,  [246.94, 349.23, 392.00]], // "out,"
    [369.99, 1, 98.00,  [246.94, 349.23, 392.00]],
    [392.00, 1, 98.00,  [246.94, 349.23, 392.00]],

    // m.29-32: "At the old ball game!" + ballpark charge fanfare pause (A7 -> D7 -> G7 -> C)
    [440.00, 3, 110.00, [277.18, 329.63, 440.00]], // "At"
    [493.88, 3, 98.00,  [246.94, 349.23, 392.00]], // "the"
    [523.25, 6, 130.81, [261.63, 329.63, 392.00]], // "old ball game!"
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
