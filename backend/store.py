"""Firestore access (Admin SDK). All DB access goes through here; clients never
touch Firestore directly — every write is validated by the API first.

Collections:
  users/{uid}          -> { linkedinUrn, name, contributed, resultCount, syncCompletedAt, updatedAt }
  results/{uid}__{g}__{pz}      -> { uid, name, game, pz, sec, rank, hint, miss }   (deep personal history)
  observations/{g}__{pz}__{key} -> { game, pz, name, sec, rank, hint, miss, srcUid } (last-14-day field, incl. non-members)

Idempotency: deterministic document ids mean a re-uploaded batch overwrites the
same docs (no duplicates), so an interrupted sync can be re-run safely.
"""
import re, time
from google.cloud import firestore

_db = firestore.Client()
CONTRIB_MIN = 10          # results required before the dashboard unlocks

# Collections are prefixed so Rankedin can coexist safely in a shared Firestore
# database without colliding with any other app's collections.
USERS = "rk_users"
RESULTS = "rk_results"
OBS = "rk_observations"


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(s))[:120]


def link_user(uid, urn, name):
    _db.collection(USERS).document(uid).set(
        {"linkedinUrn": urn, "name": name, "updatedAt": firestore.SERVER_TIMESTAMP},
        merge=True)


def get_user(uid):
    doc = _db.collection(USERS).document(uid).get()
    return doc.to_dict() if doc.exists else None


def get_cursor(uid):
    """Per-game list of puzzle numbers already stored for this user (for resume/skip)."""
    out = {}
    q = _db.collection(RESULTS).where("uid", "==", uid).select(["game", "pz"])
    for d in q.stream():
        r = d.to_dict()
        out.setdefault(r["game"], []).append(r["pz"])
    return out


def upsert_batch(uid, name, urn, results, observations):
    """Idempotent upsert of a batch. Returns number of result rows written.
    Dedups by document id first — Firestore rejects writing the same doc twice in
    one commit — so a batch with repeats can't blow up a whole sync.
    `urn` is the syncing user's own LinkedIn profile id (stamped on their results);
    each observation carries the observed player's own urn."""
    docs = {}  # docid -> (collection, data)  (last write wins within a batch)
    n = 0
    for r in results:
        rid = f"{uid}__{_safe(r['game'])}__{int(r['pz'])}"
        docs[(RESULTS, rid)] = {
            "uid": uid, "name": name, "urn": urn, "game": r["game"], "pz": int(r["pz"]),
            "sec": int(r["sec"]), "rank": r.get("rank"),
            "hint": int(bool(r.get("hint"))), "miss": int(bool(r.get("miss"))),
        }
        n += 1
    for o in observations:
        key = o.get("urn") or o["name"]        # prefer urn so a person dedups across name spellings
        oid = f"{_safe(o['game'])}__{int(o['pz'])}__{_safe(key)}"
        docs[(OBS, oid)] = {
            "game": o["game"], "pz": int(o["pz"]), "name": o["name"], "urn": o.get("urn"),
            "sec": int(o["sec"]), "rank": o.get("rank"),
            "hint": int(bool(o.get("hint"))), "miss": int(bool(o.get("miss"))),
            "srcUid": uid,
        }
    batch = _db.batch()
    for (coll, did), data in docs.items():
        batch.set(_db.collection(coll).document(did), data)
    batch.commit()
    return n


def bump_and_maybe_unlock(uid, added):
    """Increment stored-result count; unlock (contributed=true) once past the minimum."""
    ref = _db.collection(USERS).document(uid)

    @firestore.transactional
    def _tx(tx):
        snap = ref.get(transaction=tx)
        data = snap.to_dict() if snap.exists else {}
        count = int(data.get("resultCount", 0)) + added
        contributed = data.get("contributed", False) or count >= CONTRIB_MIN
        tx.set(ref, {"resultCount": count, "contributed": contributed,
                     "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
        return contributed
    return _tx(_db.transaction())


def mark_complete(uid):
    _db.collection(USERS).document(uid).set(
        {"contributed": True, "syncCompletedAt": firestore.SERVER_TIMESTAMP}, merge=True)


def load_dataset():
    """Load all results + observations for the leaderboard compute. Fine for a
    friend-group scale (a few thousand docs); cached by the caller."""
    results, observations = [], []
    for d in _db.collection(RESULTS).stream():
        r = d.to_dict()
        results.append({"name": r["name"], "urn": r.get("urn"), "game": r["game"], "pz": r["pz"],
                        "sec": r["sec"], "rank": r.get("rank"), "hint": r.get("hint"), "miss": r.get("miss")})
    for d in _db.collection(OBS).stream():
        o = d.to_dict()
        observations.append({"name": o["name"], "urn": o.get("urn"), "game": o["game"], "pz": o["pz"],
                             "sec": o["sec"], "rank": o.get("rank"), "hint": o.get("hint"), "miss": o.get("miss")})
    return results, observations
