"""Rankedin API — Cloud Run (FastAPI).

Flow:
  1. Web app authenticates the user with Firebase (Google sign-in) and sends the
     ID token as `Authorization: Bearer <token>` on every call.
  2. The /sync page relays the user's own LinkedIn data (pulled client-side by the
     bookmarklet) here in idempotent batches.
  3. /api/leaderboard is gated: it 403s until the user has contributed their data.
"""
import os, time, threading
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

import store, compute
from auth import verify

app = FastAPI(title="Rankedin API")

ALLOWED_ORIGINS = [o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o] or ["*"]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])


# ---- models ----
class LinkBody(BaseModel):
    urn: str
    name: str

class Row(BaseModel):
    game: str
    pz: int
    sec: int
    rank: Optional[int] = None
    hint: Optional[int] = 0
    miss: Optional[int] = 0

class ObsRow(Row):
    name: str

class ContribBody(BaseModel):
    results: List[Row] = []
    observations: List[ObsRow] = []


# ---- leaderboard cache (recompute at most every 60s) ----
_cache = {"at": 0, "data": None}
_lock = threading.Lock()

def _leaderboard_for(me_name):
    with _lock:
        if _cache["data"] is None or time.time() - _cache["at"] > 60:
            results, observations = store.load_dataset()
            _cache["raw"] = (results, observations)
            _cache["at"] = time.time()
            _cache["data"] = True
        results, observations = _cache["raw"]
    # me_name differs per user, so compute the "me" flag fresh (cheap vs the DB read)
    return compute.compute_dashboard(results, observations, me_name)


# ---- endpoints ----
@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/api/me")
def me(user=Depends(verify)):
    u = store.get_user(user["uid"]) or {}
    return {"uid": user["uid"], "email": user["email"],
            "linkedName": u.get("name"), "linkedinUrn": u.get("linkedinUrn"),
            "contributed": bool(u.get("contributed")), "resultCount": u.get("resultCount", 0),
            "syncCompletedAt": str(u.get("syncCompletedAt")) if u.get("syncCompletedAt") else None}

@app.post("/api/user/link")
def link(body: LinkBody, user=Depends(verify)):
    store.link_user(user["uid"], body.urn, body.name)
    return {"ok": True}

@app.get("/api/contrib/cursor")
def cursor(user=Depends(verify)):
    return {"cursor": store.get_cursor(user["uid"])}

@app.post("/api/contrib/results")
def contrib(body: ContribBody, user=Depends(verify)):
    u = store.get_user(user["uid"]) or {}
    name = u.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Call /api/user/link first")
    results = [r.dict() for r in body.results]
    observations = [o.dict() for o in body.observations]
    added = store.upsert_batch(user["uid"], name, results, observations)
    contributed = store.bump_and_maybe_unlock(user["uid"], added)
    return {"ok": True, "written": added, "contributed": contributed}

@app.post("/api/contrib/complete")
def complete(user=Depends(verify)):
    store.mark_complete(user["uid"])
    return {"ok": True}

@app.get("/api/leaderboard")
def leaderboard(user=Depends(verify)):
    u = store.get_user(user["uid"]) or {}
    if not u.get("contributed"):
        raise HTTPException(status_code=403, detail="Sync your own data first")
    return _leaderboard_for(u.get("name"))
