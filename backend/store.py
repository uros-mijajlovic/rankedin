"""Firestore access (Admin SDK). All DB access goes through here; clients never
touch Firestore directly — every write is validated by the API first.

Collections:
  users/{uid}          -> { linkedinUrn, name, contributed, resultCount, syncCompletedAt, updatedAt }
  scan/{urn}           -> { <game>: {lo, hi, mp}, updatedAt }
  results/{uid}__{g}__{pz}      -> { uid, name, game, pz, sec, rank, hint, miss }   (deep personal history)
  observations/{g}__{pz}__{key} -> { game, pz, name, sec, rank, hint, miss, srcUid } (last-14-day field, incl. non-members)

Idempotency: deterministic document ids mean a re-uploaded batch overwrites the
same docs (no duplicates), so an interrupted sync can be re-run safely.

Scan ranges: `scan[game] = {lo, hi, mp}` means "every puzzle number in [lo, hi]
has already been *looked at* for this person" — including the days they did not
play, which leave no result row behind. Without it a re-sync would re-fetch all
several hundred puzzles per game every single time, since only played days show
up in the cursor. `mp` is the highest puzzle they actually played (used to
anchor the everyone-boards pass without reading the cursor).

Resume state is keyed by **LinkedIn URN, not uid**: sign-in is anonymous, so the
same person gets a fresh uid in every browser / cleared profile / incognito
window. Keyed by uid, each of those would re-sweep their whole history from
scratch. The cursor is likewise unioned across every session of the same URN.
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
SCAN = "rk_scan"


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(s))[:120]


def link_user(uid, urn, name):
    _db.collection(USERS).document(uid).set(
        {"linkedinUrn": urn, "name": name, "updatedAt": firestore.SERVER_TIMESTAMP},
        merge=True)
    adopt_prior_contribution(uid, urn)


def adopt_prior_contribution(uid, urn):
    """Unlock a fresh anonymous session for someone who already contributed under an
    earlier session. Needed now that a re-sync uploads almost nothing: without this,
    a returning person could never reach CONTRIB_MIN in the new session and would sit
    behind the give-to-get gate forever."""
    if not urn:
        return False
    q = _db.collection(RESULTS).where("urn", "==", urn).select(["game"]).limit(CONTRIB_MIN)
    if sum(1 for _ in q.stream()) < CONTRIB_MIN:
        return False
    _db.collection(USERS).document(uid).set(
        {"contributed": True, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    return True


def get_user(uid):
    doc = _db.collection(USERS).document(uid).get()
    return doc.to_dict() if doc.exists else None


def get_cursor(uid, urn=None):
    """Per-game puzzle numbers already stored for this *person* (for resume/skip).

    Unions this session's rows with every row carrying the same LinkedIn URN, so a
    fresh anonymous session inherits what earlier sessions already contributed."""
    seen = {}

    def _collect(q):
        for d in q.select(["game", "pz"]).stream():
            r = d.to_dict()
            seen.setdefault(r["game"], set()).add(r["pz"])

    _collect(_db.collection(RESULTS).where("uid", "==", uid))
    if urn:
        _collect(_db.collection(RESULTS).where("urn", "==", urn))
    return {g: sorted(pzs) for g, pzs in seen.items()}


def _scan_key(uid, urn=None):
    return _safe(urn) if urn else "uid_" + _safe(uid)


def get_scan_doc(uid, urn=None):
    """Raw scan doc, or None if this person has never had one. `None` vs an empty
    doc matters: a doc with no ranges left is a deliberate reset, which must NOT be
    re-seeded from stored results."""
    doc = _db.collection(SCAN).document(_scan_key(uid, urn)).get()
    return doc.to_dict() or {} if doc.exists else None


def scan_ranges(doc):
    """Per-game swept ranges {game: {lo, hi, mp}} out of a scan doc (drops timestamps)."""
    return {k: v for k, v in (doc or {}).items() if isinstance(v, dict)}


def merge_scan(uid, entry, urn=None):
    """Widen one game's swept range. The client only ever checkpoints a segment
    adjacent to (or overlapping) what it was told it already had, so min/max
    merging keeps the range contiguous."""
    game = _safe(entry["game"])
    lo, hi, mp = int(entry["lo"]), int(entry["hi"]), int(entry.get("mp") or 0)
    if lo < 1 or hi < lo:
        return
    ref = _db.collection(SCAN).document(_scan_key(uid, urn))

    @firestore.transactional
    def _tx(tx):
        snap = ref.get(transaction=tx)
        old = ((snap.to_dict() or {}).get(game) if snap.exists else None) or {}
        merged = {
            "lo": min(int(old.get("lo", lo)), lo),
            "hi": max(int(old.get("hi", hi)), hi),
            "mp": max(int(old.get("mp", 0)), mp),
        }
        tx.set(ref, {game: merged, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    _tx(_db.transaction())


def reset_scan(uid, urn=None):
    """Forget the swept ranges so the next sync does a full deep re-scan. Overwrites
    the doc rather than deleting it, so it isn't immediately re-seeded from results."""
    _db.collection(SCAN).document(_scan_key(uid, urn)).set(
        {"resetAt": firestore.SERVER_TIMESTAMP})


def swept_to_bottom(urn):
    """True if any session of this person finished a full sweep. The pre-range client
    only sent /complete after sweeping every game from today's puzzle down to #1, so
    a completed old sync proves puzzle 1 was reached."""
    if not urn:
        return False
    q = _db.collection(USERS).where("linkedinUrn", "==", urn).select(["syncCompletedAt"])
    return any(d.to_dict().get("syncCompletedAt") for d in q.stream())


def seed_scan(uid, urn, cursor, completed):
    """Derive swept ranges for someone who synced before ranges existed, so they don't
    pay for one more full sweep.

    The old client swept top→1 contiguously, so everything between a person's oldest
    and newest stored result was provably looked at. If a sync also completed, the
    sweep reached #1, so the range starts there."""
    scan = {}
    for game, pzs in cursor.items():
        if not pzs:
            continue
        scan[_safe(game)] = {"lo": 1 if completed else min(pzs), "hi": max(pzs), "mp": max(pzs)}
    if scan:
        _db.collection(SCAN).document(_scan_key(uid, urn)).set(
            dict(scan, updatedAt=firestore.SERVER_TIMESTAMP), merge=True)
    return scan


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
