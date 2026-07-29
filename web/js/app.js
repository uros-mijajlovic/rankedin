import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { renderDashboard } from "/js/dashboard.js";
import { mountInstallDemo } from "/js/installdemo.js";

const CFG = window.RANKEDIN_CONFIG;
const auth = getAuth(initializeApp(CFG.firebase));

const $ = id => document.getElementById(id);
const screens = ["loading", "welcome", "install", "dashboard"];
function show(name) { screens.forEach(s => $("scr-" + s).classList.toggle("hidden", s !== name)); }

async function api(path, opts = {}) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(CFG.apiBase + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(path + " → " + res.status);
  return res.json();
}

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

$("btn-start").onclick = () => goInstall();
$("btn-resync").onclick = () => goInstall();

let mePoll = null;
function stopPoll() { if (mePoll) { clearInterval(mePoll); mePoll = null; } }

onAuthStateChanged(auth, async user => {
  stopPoll();
  if (!user) {                       // no session yet → create an anonymous one
    show("loading");
    try { await signInAnonymously(auth); } catch (e) { fatal(e); }
    return;                          // onAuthStateChanged re-fires with the new user
  }
  show("loading");
  let me;
  try { me = await api("/api/me"); }
  catch (e) { return fatal(e); }
  if (me.contributed) openDashboard(me);
  else openWelcome();
});

function fatal(e) {
  document.getElementById("scr-loading").innerHTML =
    '<div class="welcome"><div class="brandmark">😕</div><p class="lead">Could not connect (' + (e.message || e) + '). Refresh the page in a moment.</p></div>';
  show("loading");
}

function openWelcome() {
  $("welcome-mobile").classList.toggle("hidden", !isMobile);
  show("welcome");
}

let demoStop = null;
async function goInstall() {
  show("install");
  if (!demoStop) { try { demoStop = mountInstallDemo(document.getElementById("install-demo")); } catch (_) {} }
  try {
    const bm = await (await fetch("/bookmarklet.txt", { cache: "no-store" })).text();
    const link = $("bm-link");
    link.href = bm.trim();
    link.addEventListener("click", e => { e.preventDefault(); flashHint(); });
  } catch (_) {}
  wireFullScan();
  stopPoll();
  mePoll = setInterval(async () => {                 // detect the sync finishing in the other tab
    try { const me = await api("/api/me"); if (me.contributed) { stopPoll(); openDashboard(me); } } catch (_) {}
  }, 4000);
}

// A sync normally skips every puzzle range it has already swept. This clears that
// memory server-side so the next click of the bookmarklet re-reads everything.
let fullScanWired = false;
function wireFullScan() {
  if (fullScanWired) return;
  const a = $("btn-fullscan");
  if (!a) return;
  fullScanWired = true;
  a.addEventListener("click", async e => {
    e.preventDefault();
    a.textContent = "Arming…";
    try {
      await api("/api/contrib/scan/reset", { method: "POST" });
      $("rescan-line").textContent = "Full re-scan armed — click 🎮 Rankedin Sync now; it will take a few minutes.";
    } catch (err) {
      a.textContent = "Couldn't arm it (" + err.message + ") — try again";
    }
  });
}

function flashHint() {
  const h = document.querySelector("#scr-install .hint");
  if (h) { h.style.color = "var(--lo)"; h.textContent = "↑ Drag it to your bookmarks bar — don't click it here."; }
}

async function openDashboard(me) {
  stopPoll();
  show("dashboard");
  $("who").textContent = (me && me.linkedName) ? me.linkedName : "";
  $("dash-root").innerHTML = '<div class="wrap"><div class="empty"><div class="spinner" style="margin:0 auto"></div><p>Computing the leaderboard…</p></div></div>';
  try {
    const D = await api("/api/leaderboard");
    renderDashboard(D, $("dash-root"));
  } catch (e) {
    $("dash-root").innerHTML = '<div class="wrap"><div class="empty">Could not load the leaderboard (' + e.message + '). Try again in a moment.</div></div>';
  }
}
