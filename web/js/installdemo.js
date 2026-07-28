// A one-shot (manual-replay) animation of the install flow, shown on the install
// screen: a fake Chrome where a cursor drags the "Rankedin Sync" button up to the
// bookmarks bar, opens LinkedIn, clicks it, syncs — then reveals a PREVIEW of the
// leaderboard the user unlocks. Ends with a Replay button (no auto-loop).
export function mountInstallDemo(host) {
  host.innerHTML = `
  <div class="idemo">
    <div class="idemo-win">
      <div class="idemo-chrome">
        <span class="idemo-dot r"></span><span class="idemo-dot y"></span><span class="idemo-dot g"></span>
        <div class="idemo-tab"><span class="idemo-fav">🧠</span> Rankedin</div>
      </div>
      <div class="idemo-addr"><span class="idemo-lock">🔒</span><span id="id-url">rankedin.web.app</span></div>
      <div class="idemo-bm"><span class="idemo-bmlabel">Bookmarks</span><span id="id-bookmark" class="idemo-bookmark">🎮 Rankedin Sync</span></div>
      <div class="idemo-page" id="id-page">
        <div class="idemo-pg id-pg-rank" id="pg-rank">
          <div class="idemo-h">Add your results</div>
          <div class="idemo-sub">Drag the button up to the bar ↑</div>
          <div class="idemo-syncbtn" id="id-syncbtn">🎮 Rankedin Sync</div>
        </div>
        <div class="idemo-pg id-pg-li" id="pg-li">
          <div class="idemo-libar"><span class="idemo-in">in</span><div class="idemo-search"></div></div>
          <div class="idemo-card"></div><div class="idemo-card sm"></div>
        </div>
        <div class="idemo-pg id-pg-dash" id="pg-dash">
          <div class="idd-hero"><span>Your IQ</span><b>104</b><em>sharper than 59% of your circle</em></div>
          <div class="idd-board">
            <div class="idd-row"><span class="r">1</span><span class="n">🥇 Alex</span><b>112</b><i>ELO 1880</i></div>
            <div class="idd-row"><span class="r">2</span><span class="n">Jordan</span><b>111</b><i>1806</i></div>
            <div class="idd-row"><span class="r">3</span><span class="n">Taylor</span><b>105</b><i>1794</i></div>
            <div class="idd-row me"><span class="r">9</span><span class="n">YOU</span><b>104</b><i>1546</i></div>
          </div>
        </div>
      </div>
      <div class="idemo-ghost" id="id-ghost">🎮 Rankedin Sync</div>
      <div class="idemo-popup" id="id-popup">
        <div class="idemo-pop-t" id="id-pop-t">🔄 Syncing</div>
        <div class="idemo-pop-bar"><i id="id-popbar"></i></div>
        <div class="idemo-pop-s" id="id-pop-s">Pulling results…</div>
      </div>
      <svg class="idemo-cursor" id="id-cursor" viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l14 8-6 1.5L15 18l-2.5 1L9 12.5 4 15z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>
    </div>
    <div class="idemo-foot">
      <span class="idemo-cap" id="id-cap">This is how install works</span>
      <button class="idemo-replay" id="id-replay">▶ Replay</button>
    </div>
  </div>`;

  const $ = s => host.querySelector(s);
  const cursor = $("#id-cursor"), ghost = $("#id-ghost"), bookmark = $("#id-bookmark");
  const pgRank = $("#pg-rank"), pgLi = $("#pg-li"), pgDash = $("#pg-dash");
  const popup = $("#id-popup"), popbar = $("#id-popbar"), popT = $("#id-pop-t"), popS = $("#id-pop-s");
  const url = $("#id-url"), cap = $("#id-cap"), syncbtn = $("#id-syncbtn"), replay = $("#id-replay");

  const move = (x, y, ms = 700) => { cursor.style.transition = `transform ${ms}ms cubic-bezier(.4,.05,.2,1)`; cursor.style.transform = `translate(${x}px,${y}px)`; };
  const moveGhost = (x, y, ms = 700) => { ghost.style.transition = `transform ${ms}ms cubic-bezier(.4,.05,.2,1)`; ghost.style.transform = `translate(${x}px,${y}px)`; };
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  function reset() {
    timers.forEach(clearTimeout); timers.length = 0;
    cursor.style.transition = "none"; cursor.style.transform = "translate(560px,330px)";
    ghost.style.transition = "none"; ghost.style.opacity = 0; ghost.style.transform = "translate(250px,250px)";
    bookmark.classList.remove("show", "flash");
    pgRank.style.opacity = 1; pgLi.classList.remove("show"); pgDash.classList.remove("show");
    popup.classList.remove("show"); popbar.style.transition = "none"; popbar.style.width = "0%";
    popT.textContent = "🔄 Syncing"; popS.textContent = "Pulling results…";
    syncbtn.classList.remove("grabbed");
    url.textContent = "rankedin.web.app"; cap.textContent = "1 — Drag the button to the bar";
    replay.classList.remove("show");
  }

  function run() {
    reset();
    at(500, () => move(258, 250, 800));
    at(1350, () => { syncbtn.classList.add("grabbed"); ghost.style.opacity = 1; ghost.style.transition = "none"; ghost.style.transform = "translate(250px,244px)"; });
    at(1650, () => { move(360, 96, 1100); moveGhost(360, 92, 1100); });
    at(2800, () => { ghost.style.transition = "opacity .2s"; ghost.style.opacity = 0; bookmark.classList.add("show"); syncbtn.classList.remove("grabbed"); cap.textContent = "✓ Added to the bar"; });
    at(3500, () => { move(150, 60, 700); cap.textContent = "2 — Open LinkedIn"; });
    at(4250, () => typeUrl("linkedin.com/feed"));
    at(4400, () => { pgRank.style.opacity = 0; pgLi.classList.add("show"); });
    at(5000, () => { move(360, 96, 700); cap.textContent = "3 — Click Rankedin Sync"; });
    at(5750, () => { bookmark.classList.add("flash"); popup.classList.add("show"); });
    at(5850, () => bookmark.classList.remove("flash"));
    at(6050, () => { popbar.style.transition = "width 1900ms linear"; popbar.style.width = "100%"; });
    at(6600, () => popS.textContent = "Queens, Tango, Zip…");
    at(7900, () => { popS.textContent = "Done ✅"; popT.textContent = "✅ Synced"; });
    // reveal the reward — a preview of the leaderboard they unlock
    at(8700, () => {
      url.textContent = "rankedin.web.app";
      pgLi.classList.remove("show"); popup.classList.remove("show");
      pgDash.classList.add("show");
      cap.textContent = "🎉 This is what awaits you:";
      move(520, 330, 600);
    });
    at(9600, () => replay.classList.add("show"));
  }

  function typeUrl(text) {
    url.textContent = ""; let i = 0;
    const step = () => { if (i <= text.length) { url.textContent = text.slice(0, i); i++; at(38, step); } };
    step();
  }

  replay.addEventListener("click", run);
  run();
  return () => timers.forEach(clearTimeout);
}
