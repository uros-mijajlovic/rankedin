/*
 * Rankedin collector — runs as a bookmarklet ON linkedin.com.
 * It pulls the signed-in user's OWN game data from their own session and relays
 * it to the Rankedin /sync page via window.open + postMessage (LinkedIn's CSP
 * forbids fetching a third-party API directly, so the /sync page — same origin as
 * the app — does the upload). No LinkedIn credentials ever leave the browser.
 *
 * Build (scripts/build_bookmarklet.py) replaces __SYNC_URL__ / __SYNC_ORIGIN__.
 */
(function () {
  "use strict";
  var SYNC_URL = "__SYNC_URL__";
  var SYNC_ORIGIN = "__SYNC_ORIGIN__";
  var QID = "voyagerIdentityDashGameConnectionsEntities.a5fed1d462445e698d896bd5563fed9c";
  var ENDPAGE = "voyagerIdentityDashGameEndPage.b51bd3075ade52e7e7fb4e1e364df72f";
  var GAMES = { queens: 3, tango: 5, "mini-sudoku": 6, zip: 7, patches: 8, wend: 4, crossclimb: 2, pinpoint: 1 };
  var ORDER = ["queens", "tango", "mini-sudoku", "zip", "patches", "wend", "crossclimb", "pinpoint"];

  if (location.hostname.indexOf("linkedin.com") < 0) { alert("Otvori linkedin.com pa klikni Rankedin Sync."); return; }
  if (window.__rankedinRunning) { alert("Sinhronizacija već radi u drugom prozoru."); return; }
  window.__rankedinRunning = true;

  // ---- tiny overlay so the user knows not to close the tab ----
  var box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;background:#13162A;color:#ECEEF9;font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;border:1px solid #282D4C;border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.6);padding:16px 18px";
  box.innerHTML = "<div style='font-weight:700;margin-bottom:6px'>🧠 Rankedin Sync</div><div id='rk-msg' style='color:#9BA1C6'>Pokrećem…</div><div style='height:8px;background:#1A1E36;border-radius:5px;margin-top:10px;overflow:hidden'><i id='rk-bar' style='display:block;height:100%;width:0;background:#8B8CF7;transition:width .3s'></i></div><div id='rk-sub' style='color:#666C93;font:11px ui-monospace,monospace;margin-top:8px'></div>";
  document.body.appendChild(box);
  var elMsg = box.querySelector("#rk-msg"), elBar = box.querySelector("#rk-bar"), elSub = box.querySelector("#rk-sub");
  function ui(msg, pct, sub) { if (msg != null) elMsg.textContent = msg; if (pct != null) elBar.style.width = Math.round(pct) + "%"; if (sub != null) elSub.textContent = sub; }
  function fail(msg) { ui("⚠ " + msg, null, "Zatvori i klikni Rankedin Sync ponovo — nastavlja gde je stao."); box.style.borderColor = "#E8776A"; window.__rankedinRunning = false; }

  var csrf = (document.cookie.match(/JSESSIONID="?([^";]+)"?/) || [])[1];
  if (!csrf) { fail("Nisi ulogovan na LinkedIn."); return; }

  function api(path) {
    return fetch("https://www.linkedin.com/voyager/api/" + path, {
      credentials: "include",
      headers: { "csrf-token": csrf, "accept": "application/vnd.linkedin.normalized+json+2.1", "x-restli-protocol-version": "2.0.0" }
    });
  }
  function urn(t, p) { return "urn%3Ali%3Afsd_game%3A%28" + ME + "%2C" + t + "%2C" + p + "%29"; }

  var ME = null, MYNAME = null;

  async function getMe() {
    var r = await api("me"); var t = await r.text();
    var m = t.match(/ACoAA[A-Za-z0-9_-]+/); if (!m) throw new Error("me?");
    ME = m[0];
    var fn = (t.match(/"firstName":"([^"]{1,40})"/) || [])[1] || "";
    var ln = (t.match(/"lastName":"([^"]{1,40})"/) || [])[1] || "";
    MYNAME = (fn + " " + ln).trim();
  }

  async function getCurrent() {
    // one GameEndPage carousel lists every game's current puzzle number
    var r = await api("graphql?includeWebMetadata=true&variables=(gameUrn:" + urn(4, 1) + ")&queryId=" + ENDPAGE);
    var t = await r.text();
    var re = /fsd_game:\((?:[^,]+),(\d+),(\d+)\)/g, m, cur = {};
    while ((m = re.exec(t))) { var ty = +m[1], pz = +m[2]; if (!cur[ty] || pz > cur[ty]) cur[ty] = pz; }
    return cur;
  }

  async function board(type, pz, delta) {
    var v = "(gameUrn:" + urn(type, pz) + ",delta:" + delta + ",start:0,count:60)";
    var r = await api("graphql?includeWebMetadata=true&variables=" + v + "&queryId=" + QID);
    if (r.status !== 200) return null;
    var j = await r.json();
    var prof = {}, inc = j.included || [];
    for (var i = 0; i < inc.length; i++) { var e = inc[i]; if (e.entityUrn && e.firstName != null) prof[e.entityUrn] = (e.firstName + " " + (e.lastName || "")).trim(); }
    var coll = j.data && j.data.data && j.data.data.identityDashGameConnectionsEntitiesByOptedInToLeaderboardAndPlayed;
    var els = (coll && coll.elements) || [];
    return els.filter(function (e) { return e.ranking != null && e.gameScore && e.gameScore.timeElapsed != null; })
      .map(function (e) {
        var pid = e.playerDetails.player["*profile"];
        var idm = (pid.match(/ACoAA[A-Za-z0-9_-]+/) || [null])[0];   // the player's stable LinkedIn id
        return { rank: e.ranking, name: prof[pid] || "?", urn: idm, sec: e.gameScore.timeElapsed,
          hint: e.completionAttributes ? (e.completionAttributes.isHintFree ? 1 : 0) : 0,
          miss: e.completionAttributes ? (e.completionAttributes.isMistakeFree ? 1 : 0) : 0,
          mine: pid.indexOf(ME) >= 0 };
      });
  }

  // limited-concurrency map
  async function pool(items, n, fn) {
    var out = [], idx = 0;
    async function worker() { while (idx < items.length) { var i = idx++; out[i] = await fn(items[i], i); } }
    var w = []; for (var k = 0; k < n; k++) w.push(worker());
    await Promise.all(w); return out;
  }

  // ---- postMessage protocol with the /sync tab ----
  var win = null, ackWaiters = {}, ackId = 0, cursor = {}, ready = false, gotCursor = false;
  function send(type, payload) { win.postMessage(Object.assign({ rk: 1, type: type }, payload), SYNC_ORIGIN); }
  function sendBatch(results, observations) {
    return new Promise(function (resolve, reject) {
      var id = ++ackId; ackWaiters[id] = { resolve: resolve, reject: reject };
      send("BATCH", { id: id, results: results, observations: observations });
      setTimeout(function () { if (ackWaiters[id]) { delete ackWaiters[id]; reject(new Error("upload timeout")); } }, 30000);
    });
  }
  window.addEventListener("message", function (ev) {
    if (ev.origin !== SYNC_ORIGIN || !ev.data || ev.data.rk !== 1) return;
    var d = ev.data;
    if (d.type === "READY") { ready = true; }
    else if (d.type === "CURSOR") { cursor = d.cursor || {}; gotCursor = true; }
    else if (d.type === "ACK" && ackWaiters[d.id]) { ackWaiters[d.id].resolve(); delete ackWaiters[d.id]; }
    else if (d.type === "NACK" && ackWaiters[d.id]) { ackWaiters[d.id].reject(new Error(d.error || "upload failed")); delete ackWaiters[d.id]; }
    else if (d.type === "NEEDLOGIN") { ui("Uloguj se u otvorenom Rankedin prozoru pa čekaj…"); }
  });

  function waitFor(cond, ms) { return new Promise(function (res, rej) { var t0 = Date.now(); (function tick() { if (cond()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout")); setTimeout(tick, 200); })(); }); }

  async function run() {
    ui("Čitam nalog…", 2);
    await getMe();
    var cur = await getCurrent();

    ui("Otvaram Rankedin prozor…", 4);
    win = window.open(SYNC_URL, "rankedin_sync");
    if (!win) { fail("Dozvoli pop-up prozor i klikni ponovo."); return; }
    try { await waitFor(function () { return ready; }, 60000); }
    catch (e) { fail("Rankedin prozor se ne javlja. Uloguj se tamo pa probaj opet."); return; }

    send("INIT", { urn: ME, name: MYNAME });
    // ask what we already have (resume). If the cursor never arrives we just re-sync everything (idempotent).
    try { await waitFor(function () { return gotCursor; }, 20000); } catch (e) {}

    var games = ORDER.filter(function (g) { return cur[GAMES[g]]; });
    var totalUnits = games.length + 0.0001, done = 0;

    for (var gi = 0; gi < games.length; gi++) {
      var slug = games[gi], type = GAMES[slug], top = cur[type];
      var have = {}; (cursor[slug] || []).forEach(function (p) { have[p] = 1; });
      ui("Skupljam: " + slug, (done / totalUnits) * 100, "partije unazad od #" + top);

      // 1) my history: sweep pz from top down to 1, skipping what we have
      var pzs = []; for (var p = top; p >= 1; p--) if (!have[p]) pzs.push(p);
      var maxPlayed = 0, buf = [], BATCH = 40;
      await pool(pzs, 5, async function (pz) {
        var rows = await board(type, pz, 0);
        if (!rows) return;
        var mine = rows.find(function (r) { return r.mine; });
        if (mine) {
          if (pz > maxPlayed) maxPlayed = pz;
          buf.push({ game: slug, pz: pz, sec: mine.sec, rank: mine.rank, hint: mine.hint, miss: mine.miss });
          if (buf.length >= BATCH) { var b = buf; buf = []; await sendBatch(b, []); }
        }
      });
      if (buf.length) await sendBatch(buf, []);

      // 2) everyone-boards: last 14 days, anchored on a puzzle I actually played
      if (maxPlayed || (cursor[slug] && cursor[slug].length)) {
        var anchor = maxPlayed || Math.max.apply(null, cursor[slug]);
        var obs = [];
        for (var d = 0; d <= 13; d++) {
          var rows2 = await board(type, anchor, d);
          if (rows2 && rows2.length) {
            // convert delta-day to an approximate puzzle number for that game
            var apz = top - d;
            rows2.forEach(function (r) { obs.push({ game: slug, pz: apz, name: r.name, urn: r.urn, sec: r.sec, rank: r.rank, hint: r.hint, miss: r.miss }); });
          }
        }
        if (obs.length) await sendBatch([], obs);
      }
      done++; ui("Skupljam: " + slug, (done / totalUnits) * 100);
    }

    send("DONE", {});
    ui("Gotovo ✅ Vrati se na Rankedin karticu.", 100, "Možeš zatvoriti ovaj prozor.");
    window.__rankedinRunning = false;
  }

  run().catch(function (e) { fail(String(e && e.message || e)); });
})();
