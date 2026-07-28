// Renders the IQ + ELO dashboard from the /api/leaderboard payload.
const GAME_ORDER = ["queens", "tango", "mini-sudoku", "zip", "patches", "wend", "crossclimb"];
const NICE = { queens: "Queens", tango: "Tango", "mini-sudoku": "Mini Sudoku", zip: "Zip", patches: "Patches", wend: "Wend", crossclimb: "Crossclimb" };
const RANK_MIN = 10;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
const ordSr = n => n + ".";

export function renderDashboard(D, root) {
  const iqColor = iq => iq >= 100 ? css('--hi') : css('--lo');
  const meName = Object.keys(D.players).find(p => D.players[p].me) || D.me;
  const meRec = D.players[meName];
  if (!meRec) { root.innerHTML = '<div class="wrap"><div class="empty">Not enough data yet. Sync and come back.</div></div>'; return; }
  const meOverall = meRec.overallIQ;

  const playerObs = {};
  GAME_ORDER.forEach(g => (((D.games[g] || {}).players) || []).forEach(r => { playerObs[r.name] = (playerObs[r.name] || 0) + r.days; }));

  root.innerHTML = `<div class="wrap">
    <div class="eyebrow">🧠 Rankedin · Cognitive profile</div>
    <h1 style="margin-top:10px">Your profile</h1>
    <p class="conf" style="max-width:70ch;margin-top:12px">IQ and ELO from real solve times, pooled from everyone who connected. Each day is a field: your time becomes a <b style="color:var(--ink2)">z-score</b> against everyone who played that round, then mapped to an IQ scale (mean 100, SD 15). Everything is relative to <b style="color:var(--ink2)">your circle</b>. Only players with 10+ rounds are ranked.</p>

    <div class="hero" style="margin-top:24px">
      <div class="card iqbig" id="iqbig"></div>
      <div class="card curvewrap"><canvas id="bell" width="720" height="240"></canvas><div class="caption">Your circle's IQ distribution · your position marked</div></div>
    </div>
    <div class="stats" id="stats"></div>

    <div class="h2">Skill shape across games</div>
    <div class="grid2">
      <div class="card radarcard"><canvas id="radar" width="520" height="440"></canvas></div>
      <div class="gamecards" id="gamecards"></div>
    </div>

    <div class="h2">IQ + ELO of every player</div>
    <div class="conf" style="margin:-4px 0 12px">"Rounds" = rounds played in the available window. Anyone with fewer than 10 is shown but not ranked.</div>
    <div class="tabs" id="tabs"></div>
    <div class="tablewrap"><table id="lb"><thead></thead><tbody></tbody></table></div>

    <div class="h2">Circle awards</div>
    <div class="awards" id="awards"></div>

    <div class="h2">Hint-free leaderboard</div>
    <div class="conf" style="margin:-4px 0 12px">Skill measured <b style="color:var(--ink2)">only from solves where no hints were used</b> — the purist ranking. A hint-assisted time never counts here.</div>
    <div class="tablewrap"><table id="hflb"><thead></thead><tbody></tbody></table></div>

    <div class="h2">Your head-to-head</div>
    <div class="h2hgrid" id="h2h"></div>

    <div class="h2">Your records &amp; form</div>
    <div id="records"></div>

    <div class="h2">Your journey · all-time solve times</div>
    <div class="spark-grid" id="sparks"></div>
  </div>`;

  const $ = s => root.querySelector(s);

  // hero
  const pct = Math.round(phi((meOverall - 100) / 15) * 100);
  $("#iqbig").innerHTML = `<div class="lab">Overall IQ · your circle</div>
    <div class="num" style="color:${iqColor(meOverall)}">${meOverall.toFixed(1)}</div>
    <div class="pct">Sharper than <b>${pct}%</b> of your circle · top ${100 - pct}%</div>`;

  // stats
  const per = GAME_ORDER.map(g => ({ g, p: (D.games[g] || { players: [] }).players.find(r => r.me) })).filter(o => o.p);
  if (per.length) {
    const best = per.reduce((a, b) => b.p.iq > a.p.iq ? b : a);
    const worst = per.reduce((a, b) => b.p.iq < a.p.iq ? b : a);
    let puz = 0, wins = 0;
    for (const g in D.myTrend) { puz += D.myTrend[g].length; }
    const cells = [
      ["Best game", NICE[best.g], best.p.iq.toFixed(0)],
      ["Weakest", NICE[worst.g], worst.p.iq.toFixed(0)],
      ["Games", per.length, ""],
      ["Rounds total", puz.toLocaleString(), ""],
    ];
    $("#stats").innerHTML = cells.map(c => `<div class="stat"><div class="k">${c[0]}</div><div class="v">${c[1]} ${c[2] ? `<small>IQ ${c[2]}</small>` : ''}</div></div>`).join("");
  }

  drawBell($("#bell"), meOverall, iqColor);
  drawRadar($("#radar"), D, iqColor);
  buildGameCards($("#gamecards"), D, iqColor);
  buildLB(root, D, playerObs);
  buildAwards($("#awards"), D);
  buildHintFree(root, D, iqColor);
  buildH2H($("#h2h"), D);
  buildRecords($("#records"), D, iqColor);
  buildSparks($("#sparks"), D);

  const redraw = () => { drawBell($("#bell"), meOverall, iqColor); drawRadar($("#radar"), D, iqColor); };
  const mo = new MutationObserver(redraw);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(redraw, 150); });
}

function drawBell(c, meOverall, iqColor) {
  const x = c.getContext('2d'); const W = c.width, H = c.height, padL = 8, padR = 8, padB = 30, padT = 14;
  x.clearRect(0, 0, W, H);
  const lo = 55, hi = 145, X = iq => padL + (iq - lo) / (hi - lo) * (W - padL - padR);
  const Yv = v => padT + (1 - v) * (H - padT - padB), g = v => Math.exp(-0.5 * Math.pow((v - 100) / 15, 2));
  const grad = x.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, css('--lo')); grad.addColorStop(.5, css('--accent')); grad.addColorStop(1, css('--hi'));
  x.beginPath(); x.moveTo(X(lo), Yv(0)); for (let iq = lo; iq <= hi; iq += .5) x.lineTo(X(iq), Yv(g(iq))); x.lineTo(X(hi), Yv(0)); x.closePath();
  x.globalAlpha = .16; x.fillStyle = grad; x.fill(); x.globalAlpha = 1;
  x.beginPath(); for (let iq = lo; iq <= hi; iq += .5) { const px = X(iq), py = Yv(g(iq)); iq === lo ? x.moveTo(px, py) : x.lineTo(px, py); } x.strokeStyle = css('--accent'); x.lineWidth = 2; x.stroke();
  x.fillStyle = css('--ink3'); x.font = '10px ' + css('--mono'); x.textAlign = 'center';
  [70, 85, 100, 115, 130].forEach(t => { x.strokeStyle = css('--line'); x.beginPath(); x.moveTo(X(t), Yv(0)); x.lineTo(X(t), Yv(0) + 4); x.stroke(); x.fillText(t, X(t), Yv(0) + 16); });
  const mx = X(meOverall);
  x.strokeStyle = iqColor(meOverall); x.lineWidth = 2; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(mx, Yv(g(meOverall))); x.lineTo(mx, Yv(0)); x.stroke(); x.setLineDash([]);
  x.beginPath(); x.arc(mx, Yv(g(meOverall)), 4.5, 0, 7); x.fillStyle = iqColor(meOverall); x.fill();
  x.fillStyle = css('--ink'); x.font = 'bold 12px ' + css('--mono'); x.textAlign = mx > W - 60 ? 'right' : 'left';
  x.fillText('YOU ' + meOverall.toFixed(1), mx + (mx > W - 60 ? -8 : 8), Yv(g(meOverall)) - 6);
}

function drawRadar(c, D, iqColor) {
  const x = c.getContext('2d'); const W = c.width, H = c.height, cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) / 2 - 54;
  x.clearRect(0, 0, W, H);
  const games = GAME_ORDER.filter(g => { const me = (D.games[g] || { players: [] }).players.find(r => r.me); return me && me.days >= RANK_MIN; });
  const N = games.length; if (N < 3) { x.fillStyle = css('--ink3'); x.font = '12px ' + css('--mono'); x.textAlign = 'center'; x.fillText('Radar needs 3+ games with 10+ rounds', cx, cy); return; }
  const lo = 80, hi = 125, rr = iq => R * (Math.max(lo, Math.min(hi, iq)) - lo) / (hi - lo);
  [85, 100, 115].forEach(v => { x.beginPath(); for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + i / N * 2 * Math.PI, r = rr(v), px = cx + r * Math.cos(a), py = cy + r * Math.sin(a); i === 0 ? x.moveTo(px, py) : x.lineTo(px, py); } x.closePath(); x.strokeStyle = css('--line'); x.lineWidth = v === 100 ? 1.6 : 1; x.stroke(); });
  x.font = '10px ' + css('--mono');
  games.forEach((g, i) => { const a = -Math.PI / 2 + i / N * 2 * Math.PI, ex = cx + R * Math.cos(a), ey = cy + R * Math.sin(a); x.beginPath(); x.moveTo(cx, cy); x.lineTo(ex, ey); x.strokeStyle = css('--line'); x.stroke(); const lx = cx + (R + 22) * Math.cos(a), ly = cy + (R + 22) * Math.sin(a); x.fillStyle = css('--ink2'); x.textAlign = Math.abs(Math.cos(a)) < .3 ? 'center' : (Math.cos(a) > 0 ? 'left' : 'right'); x.textBaseline = 'middle'; const iq = D.games[g].players.find(r => r.me).iq; x.fillText(NICE[g], lx, ly); x.fillStyle = iqColor(iq); x.font = 'bold 10px ' + css('--mono'); x.fillText(iq.toFixed(0), lx, ly + 12); x.font = '10px ' + css('--mono'); });
  x.beginPath(); games.forEach((g, i) => { const a = -Math.PI / 2 + i / N * 2 * Math.PI, iq = D.games[g].players.find(r => r.me).iq, r = rr(iq), px = cx + r * Math.cos(a), py = cy + r * Math.sin(a); i === 0 ? x.moveTo(px, py) : x.lineTo(px, py); }); x.closePath();
  x.fillStyle = css('--accent'); x.globalAlpha = .16; x.fill(); x.globalAlpha = 1; x.strokeStyle = css('--accent'); x.lineWidth = 2; x.stroke();
  games.forEach((g, i) => { const a = -Math.PI / 2 + i / N * 2 * Math.PI, iq = D.games[g].players.find(r => r.me).iq, r = rr(iq), px = cx + r * Math.cos(a), py = cy + r * Math.sin(a); x.beginPath(); x.arc(px, py, 3.5, 0, 7); x.fillStyle = iqColor(iq); x.fill(); x.strokeStyle = css('--panel'); x.lineWidth = 2; x.stroke(); });
}

function buildGameCards(host, D, iqColor) {
  host.innerHTML = "";
  GAME_ORDER.forEach(g => {
    const gp = (D.games[g] || { players: [] }).players; const me = gp.find(r => r.me); if (!me) return;
    const rank = gp.findIndex(r => r.me) + 1, delta = me.iq - 100;
    const div = document.createElement("div"); div.className = "gc";
    div.innerHTML = `<div class="gname">${NICE[g]}</div>
      <div class="giq" style="color:${iqColor(me.iq)}">${me.iq.toFixed(0)}</div>
      <canvas width="300" height="68"></canvas>
      <div class="row"><span>ELO <b>${me.elo}</b></span><span><b>${ordSr(rank)}</b>/${gp.length}</span></div>
      <div class="row" style="margin-top:3px"><span class="pill" style="background:${delta >= 0 ? 'var(--hi-wash)' : 'var(--lo-wash)'};color:${delta >= 0 ? 'var(--hi)' : 'var(--lo)'}">${delta >= 0 ? '+' : ''}${delta.toFixed(0)} IQ</span><span>${me.days < RANK_MIN ? '<span style="color:var(--lo)">' + me.days + ' · low</span>' : me.days + ' rds'}</span></div>`;
    host.appendChild(div);
    const c = div.querySelector("canvas"), x = c.getContext("2d"), W = c.width, H = c.height;
    const lo = 60, hi = 140, X = iq => 4 + (iq - lo) / (hi - lo) * (W - 8), g2 = v => Math.exp(-0.5 * Math.pow((v - 100) / 15, 2)), Y = v => 6 + (1 - v) * (H - 18);
    x.beginPath(); x.moveTo(X(lo), Y(0)); for (let iq = lo; iq <= hi; iq++) x.lineTo(X(iq), Y(g2(iq))); x.lineTo(X(hi), Y(0)); x.closePath(); x.fillStyle = css('--accent'); x.globalAlpha = .10; x.fill(); x.globalAlpha = 1;
    x.beginPath(); for (let iq = lo; iq <= hi; iq++) { const px = X(iq), py = Y(g2(iq)); iq === lo ? x.moveTo(px, py) : x.lineTo(px, py); } x.strokeStyle = css('--ink3'); x.stroke();
    const mx = X(me.iq); x.strokeStyle = iqColor(me.iq); x.lineWidth = 2; x.beginPath(); x.moveTo(mx, Y(g2(me.iq))); x.lineTo(mx, Y(0)); x.stroke(); x.beginPath(); x.arc(mx, Y(g2(me.iq)), 3, 0, 7); x.fillStyle = iqColor(me.iq); x.fill();
  });
}

function buildLB(root, D, playerObs) {
  const iqColor = iq => iq >= 100 ? css('--hi') : css('--lo');
  const LB = { cur: 'overall', sort: 'iq', dir: -1 };
  const tabsHost = root.querySelector("#tabs");
  function tabs() {
    const t = [['overall', 'Overall'], ...GAME_ORDER.map(g => [g, NICE[g]])];
    tabsHost.innerHTML = t.map(x => `<button class="tab${x[0] === LB.cur ? ' on' : ''}" data-g="${x[0]}">${x[1]}</button>`).join("");
    tabsHost.querySelectorAll(".tab").forEach(b => b.onclick = () => { LB.cur = b.dataset.g; LB.sort = LB.cur === 'overall' ? 'iq' : 'elo'; LB.dir = -1; tabs(); render(); });
  }
  function rowsFor() {
    if (LB.cur === 'overall') return Object.entries(D.players).map(([name, v]) => ({ name, iq: v.overallIQ, elo: null, me: v.me, n: playerObs[name] || 0 }));
    return (D.games[LB.cur] || { players: [] }).players.map(r => ({ name: r.name, iq: r.iq, elo: r.elo, me: r.me, avg: r.avg, n: r.days }));
  }
  function render() {
    const overall = LB.cur === 'overall';
    const cols = overall ? [['rk', '#'], ['nm', 'Player', 'l'], ['iqv', 'IQ'], ['dv', 'Rounds']]
      : [['rk', '#'], ['nm', 'Player', 'l'], ['iqv', 'IQ'], ['elov', 'ELO'], ['dv', 'Rounds'], ['dv', 'Avg']];
    root.querySelector("#lb thead").innerHTML = '<tr>' + cols.map(c => { const key = c[0] === 'iqv' ? 'iq' : c[0] === 'elov' ? 'elo' : null; return `<th class="${c[2] === 'l' ? 'l' : ''}${key && LB.sort === key ? ' on' : ''}" ${key ? `data-sort="${key}"` : ''}>${c[1]}${key ? (LB.sort === key ? (LB.dir < 0 ? ' ▾' : ' ▴') : ' ') : ''}</th>`; }).join('') + '</tr>';
    let rows = rowsFor(); rows.sort((a, b) => { const va = a[LB.sort] ?? -1, vb = b[LB.sort] ?? -1; return (va - vb) * LB.dir; });
    const ranked = rows.filter(r => r.n >= RANK_MIN), unranked = rows.filter(r => r.n < RANK_MIN);
    const cell = (r, rk) => { const muted = rk === null; const tds = [`<td class="rk">${rk === null ? '–' : rk}</td>`, `<td class="nm l">${r.name}</td>`, `<td class="iqv" style="color:${muted ? 'var(--ink3)' : iqColor(r.iq)}">${r.iq.toFixed(1)}</td>`]; if (!overall) tds.push(`<td class="elov">${muted ? '<span style="color:var(--ink3)">' + r.elo + '</span>' : r.elo}</td>`); tds.push(`<td class="dv">${r.n}</td>`); if (!overall) tds.push(`<td class="dv">${r.avg ? Math.floor(r.avg / 60) + ':' + String(r.avg % 60).padStart(2, '0') : '—'}</td>`); return `<tr class="${r.me ? 'me' : ''}${muted ? ' muted' : ''}">${tds.join('')}</tr>`; };
    let html = ranked.map((r, i) => cell(r, i + 1)).join('');
    if (unranked.length) { html += `<tr class="divider"><td colspan="${cols.length}">Not enough rounds (&lt; ${RANK_MIN}) — unranked</td></tr>`; html += unranked.map(r => cell(r, null)).join(''); }
    root.querySelector("#lb tbody").innerHTML = html;
    root.querySelectorAll("#lb th[data-sort]").forEach(th => th.onclick = () => { const k = th.dataset.sort; if (LB.sort === k) LB.dir *= -1; else { LB.sort = k; LB.dir = -1; } render(); });
  }
  tabs(); render();
}

function buildSparks(host, D) {
  host.innerHTML = "";
  GAME_ORDER.forEach(g => {
    const t = (D.myTrend || {})[g]; if (!t || t.length < 3) return;
    const secs = t.map(r => r[1]); const w = Math.max(3, Math.round(t.length / 20)); const roll = [];
    for (let i = 0; i < t.length; i++) { const a = t.slice(Math.max(0, i - w), i + 1).map(r => r[1]).sort((p, q) => p - q); roll.push(a[Math.floor(a.length / 2)]); }
    const best = Math.min(...secs);
    const div = document.createElement("div"); div.className = "sp";
    div.innerHTML = `<div class="top"><span class="gname">${NICE[g]}</span><span class="n">${t.length} partija</span></div>
      <canvas width="440" height="112"></canvas>
      <div class="mm"><span>best <b>${Math.floor(best / 60)}:${String(best % 60).padStart(2, '0')}</b></span><span>higher = faster</span></div>`;
    host.appendChild(div);
    const c = div.querySelector("canvas"), x = c.getContext("2d"), W = c.width, H = c.height, pad = 6;
    const mn = Math.min(...roll), mx = Math.max(...roll), X = i => pad + i / (t.length - 1) * (W - 2 * pad), Y = v => pad + (v - mn) / ((mx - mn) || 1) * (H - 2 * pad);
    x.beginPath(); x.moveTo(X(0), H - pad); roll.forEach((v, i) => x.lineTo(X(i), Y(v))); x.lineTo(X(t.length - 1), H - pad); x.closePath();
    const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, css('--accent')); gr.addColorStop(1, 'transparent'); x.fillStyle = gr; x.globalAlpha = .14; x.fill(); x.globalAlpha = 1;
    x.beginPath(); roll.forEach((v, i) => { const px = X(i), py = Y(v); i === 0 ? x.moveTo(px, py) : x.lineTo(px, py); }); x.strokeStyle = css('--accent'); x.lineWidth = 2; x.stroke();
    const li = t.length - 1; x.beginPath(); x.arc(X(li), Y(roll[li]), 3, 0, 7); x.fillStyle = css('--accent'); x.fill();
  });
}

// ---------- Circle awards ----------
function buildAwards(host, D) {
  const A = D.awards || {};
  const defs = [["🧼", "No-Hints Hero", "noHints"], ["💎", "Flawless", "flawless"], ["🏋️", "Grinder", "grinder"], ["🎯", "Most Consistent", "consistent"]];
  host.innerHTML = defs.map(([emo, title, key]) => {
    const a = A[key]; if (!a) return "";
    return `<div class="award"><div class="aw-emo">${emo}</div><div class="aw-body"><div class="aw-title">${title}</div><div class="aw-name">${a.name}</div><div class="aw-val">${a.val}</div></div></div>`;
  }).join("") || '<div class="conf">Awards appear once a few players have 10+ rounds.</div>';
}

// ---------- Hint-free leaderboard ----------
function buildHintFree(root, D, iqColor) {
  const rows = D.hintFreeBoard || [];
  root.querySelector("#hflb thead").innerHTML = '<tr><th>#</th><th class="l">Player</th><th>Hint-free IQ</th><th>Hint-free rounds</th></tr>';
  const ranked = rows.filter(r => r.rounds >= 10), rest = rows.filter(r => r.rounds < 10);
  const cell = (r, rk) => `<tr class="${r.me ? 'me' : ''}${rk === null ? ' muted' : ''}">
    <td class="rk">${rk === null ? '–' : rk}</td><td class="nm l">${r.name}</td>
    <td class="iqv" style="color:${rk === null ? 'var(--ink3)' : iqColor(r.iq)}">${r.iq.toFixed(1)}</td>
    <td class="dv">${r.rounds}</td></tr>`;
  let html = ranked.map((r, i) => cell(r, i + 1)).join("");
  if (rest.length) { html += `<tr class="divider"><td colspan="4">Not enough hint-free rounds (&lt; 10) — unranked</td></tr>`; html += rest.map(r => cell(r, null)).join(""); }
  root.querySelector("#hflb tbody").innerHTML = html || '<tr><td colspan="4" style="padding:20px;color:var(--ink3)">No hint-free data yet.</td></tr>';
}

// ---------- Head-to-head ----------
function buildH2H(host, D) {
  const list = (D.h2h || []).filter(h => (h.w + h.l + h.t) >= 3);
  if (!list.length) { host.innerHTML = '<div class="conf">Head-to-head appears once you share opponents on the same puzzles.</div>'; return; }
  const rec = h => h.w - h.l;
  const nemesis = list.reduce((a, b) => rec(b) < rec(a) ? b : a);
  const victim = list.reduce((a, b) => rec(b) > rec(a) ? b : a);
  const tag = h => h === nemesis && rec(h) < 0 ? '<span class="h2h-tag nem">nemesis</span>' : (h === victim && rec(h) > 0 ? '<span class="h2h-tag vic">favourite win</span>' : '');
  host.innerHTML = list.slice(0, 12).map(h => {
    const tot = h.w + h.l + h.t, wp = 100 * h.w / tot, lp = 100 * h.l / tot, tp = 100 * h.t / tot;
    const good = h.w >= h.l;
    return `<div class="h2h-row">
      <div class="h2h-name">${h.name}${tag(h)}</div>
      <div class="h2h-bar"><i style="width:${wp}%" class="w"></i><i style="width:${tp}%" class="t"></i><i style="width:${lp}%" class="l"></i></div>
      <div class="h2h-rec"><b style="color:${good ? 'var(--hi)' : 'var(--lo)'}">${h.w}</b>–${h.l}${h.t ? '–' + h.t : ''}</div>
    </div>`;
  }).join("");
}

// ---------- Records & form ----------
function buildRecords(host, D, iqColor) {
  const m = D.meExtra || {};
  const pctOrDash = v => v == null ? "—" : Math.round(v * 100) + "%";
  const arrow = m.form > 0.12 ? "↗" : (m.form < -0.12 ? "↘" : "→");
  const formColor = m.form > 0.12 ? "var(--hi)" : (m.form < -0.12 ? "var(--lo)" : "var(--ink2)");
  const tiles = [
    ["Form", `<span style="color:${formColor}">${arrow} ${m.formLabel || "steady"}</span>`],
    ["Win rate", pctOrDash(m.winRate)],
    ["Hint-free", pctOrDash(m.hintFree)],
    ["Flawless", pctOrDash(m.flawless)],
  ];
  const recs = m.records || {};
  const recChips = GAME_ORDER.filter(g => recs[g] != null).map(g =>
    `<div class="rec-chip"><span class="rc-g">${NICE[g]}</span><b>${Math.floor(recs[g] / 60)}:${String(recs[g] % 60).padStart(2, '0')}</b></div>`).join("");
  host.innerHTML = `
    <div class="stats" style="margin-top:0">${tiles.map(t => `<div class="stat"><div class="k">${t[0]}</div><div class="v" style="font-size:22px">${t[1]}</div></div>`).join("")}</div>
    <div class="rec-label">Personal records — fastest solve per game</div>
    <div class="rec-grid">${recChips || '<span class="conf">No records yet.</span>'}</div>`;
}
