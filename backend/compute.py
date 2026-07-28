"""
IQ + ELO computation over the stitched, multi-member dataset, plus the richer
stats (hint-free leaderboard, head-to-head, awards, records/form).

IDENTITY is keyed by the LinkedIn profile URN (globally unique) — NOT by name — so
two different people who happen to share a name are never merged, and one person is
never split across spelling/accent variants. The name is only a display label.
Rows without a URN (older data) fall back to an accent-folded name key.

Score model: per round, each player's time becomes a z-score of log-time against
that round's field; per-game skill = mean daily z shrunk n/(n+3); IQ = 100 + 15·z
(clamped). ELO = Bradley-Terry over same-round head-to-heads, scaled to 1500.
"""
import math, unicodedata, statistics
from collections import defaultdict, Counter

GAME_SLUG = {1: "pinpoint", 2: "crossclimb", 3: "queens", 4: "wend",
             5: "tango", 6: "mini-sudoku", 7: "zip", 8: "patches"}
SLUG_ORDER = ["queens", "tango", "mini-sudoku", "zip", "patches", "wend", "crossclimb", "pinpoint"]
RANK_MIN = 10
SHRINK_K = 3


def _canon(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().split())


def _ident(row):
    """Stable identity for a person: their LinkedIn URN if we have it, else a
    name-based fallback (only merges name variants when no URN exists)."""
    u = row.get("urn")
    if u:
        return "u:" + str(u)
    return "n:" + _canon(row.get("name", ""))


def _bradley_terry(pairwins, players):
    idx = {p: i for i, p in enumerate(players)}
    n = len(players)
    if n == 0:
        return {}
    W = [1.0] * n
    N = defaultdict(float)
    for (i, j), w in pairwins.items():
        W[idx[i]] += w
        N[(idx[i], idx[j])] += w
        N[(idx[j], idx[i])] += w
    p = [1.0] * n
    for _ in range(200):
        newp = [0.0] * n
        for i in range(n):
            denom = 2.0 / (p[i] + 1.0)
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


def _core(rounds, label, me_id):
    """Pipeline over `rounds` (ident -> value). `label` maps ident -> display name."""
    games_out, ids_seen = {}, set()
    overall_num, overall_den = defaultdict(float), defaultdict(float)
    z_by = defaultdict(list)
    all_pair = defaultdict(float)      # global head-to-heads across every game → overall ELO

    for g in [s for s in SLUG_ORDER if s in rounds]:
        skill = defaultdict(list)
        pairwins = defaultdict(float)
        stat = defaultdict(lambda: {"n": 0, "hf": 0, "fl": 0, "win": 0, "ct": 0, "sec": []})
        pool = set()
        for pz, field in rounds[g].items():
            entries = [(i, v) for i, v in field.items()]
            if not entries:
                continue
            contested = len(entries) >= 2
            fastest = min(v["sec"] for _, v in entries)
            for i, v in entries:
                pool.add(i); ids_seen.add(i)
                st = stat[i]; st["n"] += 1; st["sec"].append(v["sec"])
                if v.get("hint"): st["hf"] += 1
                if v.get("hint") and v.get("miss"): st["fl"] += 1
                if contested:
                    st["ct"] += 1
                    if v["sec"] == fastest: st["win"] += 1
            if len(entries) >= 3:
                logs = [math.log(v["sec"]) for _, v in entries]
                mu = sum(logs) / len(logs)
                var = sum((x - mu) ** 2 for x in logs) / len(logs)
                sd = math.sqrt(var) if var > 1e-9 else 1.0
                for (i, _), lg in zip(entries, logs):
                    z = -(lg - mu) / sd
                    skill[i].append(z); z_by[i].append(z)
            for a in range(len(entries)):
                for b in range(a + 1, len(entries)):
                    ia, va = entries[a]; ib, vb = entries[b]
                    if va["sec"] < vb["sec"]: pairwins[(ia, ib)] += 1; all_pair[(ia, ib)] += 1
                    elif vb["sec"] < va["sec"]: pairwins[(ib, ia)] += 1; all_pair[(ib, ia)] += 1
                    else:
                        pairwins[(ia, ib)] += 0.5; pairwins[(ib, ia)] += 0.5
                        all_pair[(ia, ib)] += 0.5; all_pair[(ib, ia)] += 0.5
        elo = _bradley_terry(pairwins, sorted(pool))
        rows = []
        for i in sorted(pool):
            zs = skill.get(i, [])
            n = len(zs)
            s_adj = (sum(zs) / n if n else 0.0) * n / (n + SHRINK_K)
            iq = max(60.0, min(145.0, 100 + 15 * s_adj))
            st = stat[i]; days = st["n"]
            rows.append({"name": label[i], "iq": round(iq, 1), "elo": round(elo.get(i, 1500)),
                         "days": days, "avg": round(sum(st["sec"]) / len(st["sec"])) if st["sec"] else None,
                         "best": min(st["sec"]) if st["sec"] else None,
                         "hintFree": round(st["hf"] / days, 3) if days else 0,
                         "flawless": round(st["fl"] / days, 3) if days else 0,
                         "winRate": round(st["win"] / st["ct"], 3) if st["ct"] else None,
                         "wins": st["win"], "contested": st["ct"], "me": i == me_id})
            if n > 0:
                overall_num[i] += s_adj * max(n, 1)
                overall_den[i] += max(n, 1)
        rows.sort(key=lambda r: -r["elo"])
        games_out[g] = {"players": rows, "nplayers": len(rows)}

    overall_elo = _bradley_terry(all_pair, sorted(ids_seen))
    players_out = {}
    for i in ids_seen:
        s = overall_num[i] / overall_den[i] if overall_den.get(i) else 0.0
        iq = max(60.0, min(145.0, 100 + 15 * s))
        ngames = sum(1 for g in games_out if any(r["name"] == label[i] for r in games_out[g]["players"]))
        players_out[label[i]] = {"overallIQ": round(iq, 1), "overallElo": round(overall_elo.get(i, 1500)),
                                 "games": ngames, "me": i == me_id}
    return games_out, players_out, z_by


def compute_dashboard(results, observations, me_name, me_urn=None):
    all_rows = list(results) + list(observations)

    # name votes per identity → a display name; disambiguate names shared by 2+ idents
    votes = defaultdict(Counter)
    for r in all_rows:
        if r.get("name"):
            votes[_ident(r)][r["name"]] += 1
    name_of = {}
    for i, c in votes.items():
        name_of[i] = max(c.items(), key=lambda kv: (kv[1], sum(ord(x) > 127 for x in kv[0]), len(kv[0])))[0]
    by_name = defaultdict(list)
    for i, nm in name_of.items():
        by_name[nm].append(i)
    label = {}
    for nm, ids in by_name.items():
        if len(ids) == 1:
            label[ids[0]] = nm
        else:  # same display name, different people → tag with a short id suffix
            for i in ids:
                suffix = i.split(":")[-1][-4:]
                label[i] = f"{nm} ·{suffix}"

    me_id = ("u:" + me_urn) if me_urn else ("n:" + _canon(me_name))
    if me_id not in label:
        label[me_id] = name_of.get(me_id, me_name)

    # build rounds keyed by identity
    rounds = defaultdict(lambda: defaultdict(dict))
    def ingest(rows, authoritative):
        for r in rows:
            sec = r.get("sec")
            if sec is None or int(sec) <= 0:      # skip missing / zero-second (invalid) solves
                continue
            g, pz, i = r["game"], int(r["pz"]), _ident(r)
            slot = rounds[g][pz]
            if i in slot and slot[i].get("auth") and not authoritative:
                continue
            slot[i] = {"sec": int(sec), "hint": r.get("hint"), "miss": r.get("miss"), "auth": authoritative}
    ingest(observations, False)
    ingest(results, True)

    # transition safety: if the requester's URN-key has no data yet but their
    # name-key does (older, pre-URN data), identify them by name for this request.
    present = set()
    for g in rounds:
        for pz in rounds[g]:
            present |= set(rounds[g][pz].keys())
    name_id = "n:" + _canon(me_name)
    if me_id not in present and name_id in present:
        me_id = name_id
        label.setdefault(me_id, name_of.get(me_id, me_name))

    games_out, players_out, z_all = _core(rounds, label, me_id)

    # ---- hint-free leaderboard: rerun on hint-free solves only ----
    hf_rounds = defaultdict(lambda: defaultdict(dict))
    for g, days in rounds.items():
        for pz, field in days.items():
            keep = {i: v for i, v in field.items() if v.get("hint")}
            if keep:
                hf_rounds[g][pz] = keep
    _, hf_players, _ = _core(hf_rounds, label, me_id)
    hf_count = defaultdict(int)
    for g in hf_rounds:
        for pz, field in hf_rounds[g].items():
            for i in field:
                hf_count[i] += 1
    hintFreeBoard = []
    hf_count_by_label = defaultdict(int)
    for i, c in hf_count.items():
        hf_count_by_label[label[i]] += c
    for nm, v in hf_players.items():
        if hf_count_by_label[nm] > 0:
            hintFreeBoard.append({"name": nm, "elo": v["overallElo"], "rounds": hf_count_by_label[nm], "me": v["me"]})
    hintFreeBoard.sort(key=lambda r: -r["elo"])

    # ---- head-to-head: me vs everyone ----
    h2h = defaultdict(lambda: {"w": 0, "l": 0, "t": 0})
    for g, days in rounds.items():
        for pz, field in days.items():
            if me_id not in field:
                continue
            mine = field[me_id]["sec"]
            for i, v in field.items():
                if i == me_id:
                    continue
                if mine < v["sec"]: h2h[i]["w"] += 1
                elif mine > v["sec"]: h2h[i]["l"] += 1
                else: h2h[i]["t"] += 1
    h2h_list = sorted([{"name": label[i], **rec} for i, rec in h2h.items()],
                      key=lambda r: -(r["w"] + r["l"] + r["t"]))

    # ---- circle awards (players with >= RANK_MIN total rounds) ----
    tot = defaultdict(lambda: {"n": 0, "hf": 0, "fl": 0})
    for g in games_out:
        for r in games_out[g]["players"]:
            t = tot[r["name"]]; t["n"] += r["days"]
            t["hf"] += round(r["hintFree"] * r["days"]); t["fl"] += round(r["flawless"] * r["days"])
    elig = [nm for nm, t in tot.items() if t["n"] >= RANK_MIN]
    def _award(scorer, fmt):
        best = None
        for nm in elig:
            val = scorer(nm)
            if val is None:
                continue
            if best is None or val > best[1]:
                best = (nm, val)
        return {"name": best[0], "val": fmt(best[1])} if best else None
    zlabel = defaultdict(list)
    for i, zs in z_all.items():
        zlabel[label[i]].extend(zs)
    consistency = {nm: -statistics.pstdev(zlabel[nm]) for nm in elig if len(zlabel[nm]) >= 8}
    awards = {
        "noHints": _award(lambda nm: tot[nm]["hf"] / tot[nm]["n"], lambda v: str(round(v * 100)) + "%"),
        "flawless": _award(lambda nm: tot[nm]["fl"] / tot[nm]["n"], lambda v: str(round(v * 100)) + "%"),
        "grinder": _award(lambda nm: tot[nm]["n"], lambda v: str(v) + " rounds"),
        "consistent": (lambda b: {"name": b[0], "val": "±" + str(round(-b[1], 2))} if b else None)(
            max(consistency.items(), key=lambda kv: kv[1]) if consistency else None),
    }

    # ---- my records + form ----
    my_records = {}
    for g in games_out:
        me_row = next((r for r in games_out[g]["players"] if r["me"]), None)
        if me_row and me_row["best"] is not None:
            my_records[g] = me_row["best"]
    deltas, wsum = [], 0
    for g, days in rounds.items():
        zlist = []
        for pz in sorted(days):
            field = days[pz]
            if me_id not in field or len(field) < 3:
                continue
            logs = {i: math.log(v["sec"]) for i, v in field.items()}
            mu = sum(logs.values()) / len(logs); sd = statistics.pstdev(list(logs.values())) or 1.0
            zlist.append(-(logs[me_id] - mu) / sd)
        if len(zlist) >= 6:
            h = len(zlist) // 2
            d = (sum(zlist[h:]) / len(zlist[h:])) - (sum(zlist[:h]) / len(zlist[:h]))
            deltas.append(d * len(zlist)); wsum += len(zlist)
    form = (sum(deltas) / wsum) if wsum else 0.0
    form_label = "improving" if form > 0.12 else ("cooling off" if form < -0.12 else "steady")

    me_rows = [r for g in games_out for r in games_out[g]["players"] if r["me"]]
    tw = sum(r["wins"] for r in me_rows); tn = sum(r["days"] for r in me_rows); tc = sum(r["contested"] for r in me_rows)
    meExtra = {
        "hintFree": round(sum(r["hintFree"] * r["days"] for r in me_rows) / tn, 3) if tn else 0,
        "flawless": round(sum(r["flawless"] * r["days"] for r in me_rows) / tn, 3) if tn else 0,
        "winRate": round(tw / tc, 3) if tc else None,
        "records": my_records, "form": round(form, 3), "formLabel": form_label,
    }

    trend = defaultdict(list)
    for g in rounds:
        for pz, field in rounds[g].items():
            v = field.get(me_id)
            if v and v.get("auth"):
                trend[g].append([pz, v["sec"], None])
    for g in trend:
        trend[g].sort()

    me_label = label.get(me_id, me_name)
    return {"games": games_out, "players": players_out, "myTrend": trend, "me": me_label,
            "hintFreeBoard": hintFreeBoard, "h2h": h2h_list, "awards": awards, "meExtra": meExtra}
