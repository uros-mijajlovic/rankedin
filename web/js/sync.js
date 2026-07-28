import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const CFG = window.RANKEDIN_CONFIG;
const auth = getAuth(initializeApp(CFG.firebase));
const $ = id => document.getElementById(id);

let openerOrigin = null;           // captured from the first inbound LinkedIn message
let resCount = 0, obsCount = 0;

async function api(path, opts = {}) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(CFG.apiBase + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(path + " → " + res.status);
  return res.json();
}
async function apiRetry(path, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await api(path, opts); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
  }
  throw last;
}

function toOpener(type, payload) {
  const target = openerOrigin || "*";
  if (window.opener) window.opener.postMessage(Object.assign({ rk: 1, type }, payload), target);
}
function setBar(pct) { $("s-bar").style.width = Math.max(0, Math.min(100, pct)) + "%"; }

onAuthStateChanged(auth, async user => {
  if (!user) {                          // restore/create the shared anonymous session
    try { await signInAnonymously(auth); } catch (e) {
      $("s-title").textContent = "Error"; $("s-msg").textContent = "Couldn't open a session (" + e.message + ").";
    }
    return;
  }
  $("s-login").classList.add("hidden");
  $("s-title").textContent = "Connected ✓";
  $("s-msg").textContent = "Pulling your results from the LinkedIn tab…";
  $("s-box").classList.remove("hidden");
  toOpener("READY", {});                 // signal the bookmarklet we're up
});

window.addEventListener("message", async ev => {
  if (!ev.data || ev.data.rk !== 1) return;
  try { if (new URL(ev.origin).hostname.indexOf("linkedin.com") < 0) return; } catch (_) { return; }
  openerOrigin = ev.origin;
  const d = ev.data;

  if (d.type === "INIT") {
    try {
      await apiRetry("/api/user/link", { method: "POST", body: JSON.stringify({ urn: d.urn, name: d.name }) });
      const c = await apiRetry("/api/contrib/cursor", { method: "GET" });
      toOpener("CURSOR", { cursor: c.cursor || {} });
      $("s-note").textContent = "Resuming where I left off (skipping what's already saved).";
    } catch (e) {
      toOpener("CURSOR", { cursor: {} });   // fall back to full re-sync (idempotent)
    }
  }

  else if (d.type === "BATCH") {
    try {
      const r = await apiRetry("/api/contrib/results", {
        method: "POST",
        body: JSON.stringify({ results: d.results || [], observations: d.observations || [] })
      });
      resCount += (d.results || []).length;
      obsCount += (d.observations || []).length;
      $("s-res").textContent = resCount.toLocaleString();
      $("s-obs").textContent = obsCount.toLocaleString();
      setBar(Math.min(95, 10 + resCount / 20));
      toOpener("ACK", { id: d.id });
      if (r.contributed) $("s-note").textContent = "Unlocked ✓ you can go back to Rankedin anytime.";
    } catch (e) {
      toOpener("NACK", { id: d.id, error: e.message });
      $("s-box").classList.add("err"); $("s-dot").className = "dot-err";
      $("s-note").textContent = "Upload stalled — go back to LinkedIn and click Rankedin Sync again.";
    }
  }

  else if (d.type === "DONE") {
    try { await apiRetry("/api/contrib/complete", { method: "POST" }); } catch (_) {}
    setBar(100); $("s-dot").className = "dot-ok"; $("s-dot").textContent = "●";
    $("s-stage").textContent = "Done";
    $("s-title").textContent = "Synced ✅";
    $("s-msg").textContent = "Go back to the Rankedin tab — the leaderboard is unlocked.";
    $("s-hint").textContent = "You can close this window.";
  }
});
