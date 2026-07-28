"""
IQ + ELO computation over the stitched, multi-member dataset.

Identity is keyed by LinkedIn display name (the everyone-board names equal each
member's own profile name, so a member's observed rows and their deep personal
history merge automatically). A member's authoritative `results` row wins over an
`observation` for the same (game, pz, name).

- Per-round skill: z-score of log(time) within that round's field (lower time = higher z).
- Per-game IQ: mean daily z, shrunk by n/(n+3) toward 0, then 100 + 15*z (clamped).
- ELO: Bradley-Terry fit over all same-round head-to-heads, scaled to a 1500 center.
"""
import math, unicodedata
from collections import defaultdict, Counter


def _canon(s):
    """Accent/case-insensitive key so 'Uros Mijajlovic' and 'Uroš Mijajlović' merge."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().split())


def _name_map(*rowsets):
    """canon -> preferred display spelling (most frequent; ties prefer the one with
    diacritics, then the longer)."""
    variants = defaultdict(Counter)
    for rows in rowsets:
        for r in rows:
            n = r.get("name")
            if n:
                variants[_canon(n)][n] += 1
    out = {}
    for c, counter in variants.items():
        out[c] = max(counter.items(), key=lambda kv: (kv[1], sum(ord(ch) > 127 for ch in kv[0]), len(kv[0])))[0]
    return out

GAME_SLUG = {1: "pinpoint", 2: "crossclimb", 3: "queens", 4: "wend",
             5: "tango", 6: "mini-sudoku", 7: "zip", 8: "patches"}
SLUG_ORDER = ["queens", "tango", "mini-sudoku", "zip", "patches", "wend", "crossclimb", "pinpoint"]
RANK_MIN = 10          # rounds required to be ranked
SHRINK_K = 3           # small-sample shrinkage constant


def _bradley_terry(pairwins, players):
    """pairwins[(i,j)] = wins of i over j (0.5 each for ties). Returns {name: elo}."""
    idx = {p: i for i, p in enumerate(players)}
    n = len(players)
    if n == 0:
        return {}
    W = [1.0] * n                       # +1 virtual win prior vs an average opponent
    N = defaultdict(float)
    for (i, j), w in pairwins.items():
        W[idx[i]] += w
        N[(idx[i], idx[j])] += w
        N[(idx[j], idx[i])] += w
    p = [1.0] * n
    for _ in range(200):
        newp = [0.0] * n
        for i in range(n):
            denom = 2.0 / (p[i] + 1.0)   # prior term
            for j in range(n):
                if i == j:
                    continue
                nij = N[(i, j)]
                if nij > 0:
                    denom += nij / (p[i] + p[j])
            newp[i] = W[i] / denom if denom > 0 else p[i]
        gm = math.exp(sum(math.log(max(x, 1e-9)) for x in newp) / n)
        p = [x / gm for x in newp]
    return {players[i]: 1500 + 400 * math.log10(max(p[i], 1e-9)) for i in range(n)}


def compute_dashboard(results, observations, me_name):
    """
    results/observations: iterables of dicts with keys
        name, game (slug), pz (int), sec (int), rank (int|None), hint (0/1), miss (0/1)
    Returns the dashboard payload shape consumed by the web viz.
    """
    # merge accent/spelling variants of the same person to one display name
    nmap = _name_map(results, observations)
    disp = lambda n: nmap.get(_canon(n), n)
    me_name = disp(me_name)

    # rounds[game][pz][name] = {sec, hint, miss}; results override observations
    rounds = defaultdict(lambda: defaultdict(dict))
    def ingest(rows, authoritative):
        for r in rows:
            g, pz, name = r["game"], int(r["pz"]), disp(r["name"])
            sec = r.get("sec")
            if sec is None:
                continue
            slot = rounds[g][pz]
            if name in slot and slot[name].get("auth") and not authoritative:
                continue
            slot[name] = {"sec": int(sec), "hint": r.get("hint"), "miss": r.get("miss"), "auth": authoritative}
    ingest(observations, False)
    ingest(results, True)

    games_out, players_seen = {}, set()
    overall_num, overall_den = defaultdict(float), defaultdict(float)

    for g in [s for s in SLUG_ORDER if s in rounds]:
        skill = defaultdict(list)      # name -> [daily z]
        pairwins = defaultdict(float)
        secs_by = defaultdict(list)
        pool = set()
        for pz, field in rounds[g].items():
            entries = [(n, v["sec"]) for n, v in field.items()]
            for n, _ in entries:
                pool.add(n)
                players_seen.add(n)
            for n, s in entries:
                secs_by[(g, n)].append(s)
            if len(entries) >= 3:
                logs = [math.log(s) for _, s in entries]
                mu = sum(logs) / len(logs)
                var = sum((x - mu) ** 2 for x in logs) / len(logs)
                sd = math.sqrt(var) if var > 1e-9 else 1.0
                for (n, _), lg in zip(entries, logs):
                    skill[n].append(-(lg - mu) / sd)
            for a in range(len(entries)):
                for b in range(a + 1, len(entries)):
                    na, sa = entries[a]; nb, sb = entries[b]
                    if sa < sb: pairwins[(na, nb)] += 1
                    elif sb < sa: pairwins[(nb, na)] += 1
                    else: pairwins[(na, nb)] += 0.5; pairwins[(nb, na)] += 0.5
        elo = _bradley_terry(pairwins, sorted(pool))
        rows = []
        for name in sorted(pool):
            zs = skill.get(name, [])
            n = len(zs)
            s = sum(zs) / n if n else 0.0
            s_adj = s * n / (n + SHRINK_K)
            iq = max(60.0, min(145.0, 100 + 15 * s_adj))
            secs = secs_by[(g, name)]
            days = len(secs)
            rows.append({"name": name, "iq": round(iq, 1), "elo": round(elo.get(name, 1500)),
                         "days": days, "avg": round(sum(secs) / len(secs)) if secs else None,
                         "best": min(secs) if secs else None, "me": name == me_name})
            if n > 0:
                overall_num[name] += s_adj * max(n, 1)
                overall_den[name] += max(n, 1)
        rows.sort(key=lambda r: -r["elo"])
        games_out[g] = {"players": rows, "nplayers": len(rows)}

    players_out = {}
    for name in players_seen:
        if overall_den.get(name):
            s = overall_num[name] / overall_den[name]
        else:
            s = 0.0
        iq = max(60.0, min(145.0, 100 + 15 * s))
        ngames = sum(1 for g in games_out if any(r["name"] == name for r in games_out[g]["players"]))
        players_out[name] = {"overallIQ": round(iq, 1), "games": ngames, "me": name == me_name}

    # my personal trend (deep history) from authoritative results
    trend = defaultdict(list)
    for g in rounds:
        for pz, field in rounds[g].items():
            v = field.get(me_name)
            if v and v.get("auth"):
                trend[g].append([pz, v["sec"], None])
    for g in trend:
        trend[g].sort()

    return {"games": games_out, "players": players_out, "myTrend": trend, "me": me_name}
