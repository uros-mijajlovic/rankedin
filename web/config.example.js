// Copy this file to web/config.js and fill in your own values.
// web/config.js is gitignored so real keys never land in the repo.
//
// The Firebase web apiKey is safe to expose in a client bundle by design
// (security comes from Auth + the backend, not from hiding it) — but this repo
// keeps the whole config out of version control anyway.
window.RANKEDIN_CONFIG = {
  firebase: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  },
  // Cloud Run service URL (no trailing slash)
  apiBase: "https://YOUR-CLOUD-RUN-URL.run.app",
  // Public URL of this app's /sync page
  syncUrl: "https://YOUR_HOSTING_DOMAIN/sync"
};
