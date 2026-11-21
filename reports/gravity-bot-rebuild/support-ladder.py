"""Score matched native races and bootstrap the differences by whole bag."""

import argparse
import gzip
import json
import random
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


def finish(row, target):
    scores = [0, 0]
    for count, (ticks, deaths, attackers) in enumerate(row["rounds"], start=1):
        if len(deaths) != 2 or len(attackers) != 2 or ticks < 1 or ticks > 36_000:
            raise ValueError("Invalid round")
        for seat in range(2):
            if deaths[seat] == "1" and attackers[seat] == 1 - seat:
                scores[1 - seat] += 1
        if max(scores) >= target:
            if scores[0] == scores[1]:
                return None, "draw"
            high_seat = 0 if row["swap"] else 1
            return row["tier"] + int(scores[high_seat] == max(scores)), "decided"
        if deaths == "00" or count == 5 * target:
            return None, "censored"
    raise ValueError("Incomplete race")


def interval(samples):
    ordered = sorted(samples)
    return [round(ordered[int((len(ordered) - 1) * p)], 2) for p in (0.025, 0.975)]


def summarize(rows, first, count, tiers=range(6, 10), candidate="candidate"):
    index = {}
    for row in rows:
        key = (row["version"], row["tier"], row["seed"], row["swap"])
        if key in index:
            raise ValueError(f"Duplicate series {key}")
        index[key] = row
    result = []
    for tier in tiers:
        for target, field in [(3, "three"), (7, "seven")]:
            bag_points = defaultdict(list)
            outcomes = defaultdict(Counter)
            rounds = Counter()
            for version in ["previous", candidate]:
                for seed in range(first, first + count):
                    points = []
                    for swap in [False, True]:
                        row = index[version, tier, seed, swap]
                        winner, outcome = finish(row, target)
                        if winner != row[field]:
                            raise ValueError(f"Different adjudication for {tier} {seed} {swap} {version}")
                        rounds[version] += len(row["rounds"])
                        points.append(0.5 if winner is None else int(winner == tier + 1))
                        outcomes[version][outcome if winner is None else "win" if winner == tier + 1 else "loss"] += 1
                    bag_points[version].append(100 * mean(points))
            before = bag_points["previous"]
            after = bag_points[candidate]
            differences = [b - a for a, b in zip(before, after, strict=True)]
            rng = random.Random(91_101 + tier)
            draws = [[rng.randrange(count) for _ in range(count)] for _ in range(5000)]
            percent = {version: round(mean(points), 2) for version, points in bag_points.items()}
            result.append(dict(tier=tier, target=target, bags=count, percent=percent, outcomes=dict(outcomes),
                               delta=round(mean(differences), 2), sevenFragRounds=dict(rounds),
                               candidateCI=interval([sum(after[i] for i in draw) / count for draw in draws]),
                               deltaCI=interval([sum(differences[i] for i in draw) / count for draw in draws])))
    return result


def training_rates(rows, first, count):
    rows = [row for row in rows if first <= row["seed"] < first + count]
    indices = {(row["version"], row["tier"], row["seed"], row["swap"]): row for row in rows}
    results = []
    for version in sorted({row["version"] for row in rows}):
        bands = {}
        tiers = sorted({row["tier"] for row in rows if row["version"] == version})
        for tier in tiers:
            for target in [3, 7]:
                points = []
                for seed in range(first, first + count):
                    for swap in [False, True]:
                        row = indices[version, tier, seed, swap]
                        winner, _ = finish(row, target)
                        if row["three" if target == 3 else "seven"] != winner:
                            raise ValueError(f"Training outcome mismatch for {version} {tier} {seed} {swap}")
                        points.append(.5 if winner is None else int(winner == tier + 1))
                bands[f"{tier}-{tier + 1}/{target}"] = round(100 * mean(points), 2)
        largest_miss = max(max(0, 55 - p, p - 70) for p in bands.values())
        center_loss = mean((p - 62.5) ** 2 for p in bands.values())
        results.append(dict(version=version, points=bands, maximumMiss=round(largest_miss, 2),
                            centerLoss=round(center_loss, 3)))
    return sorted(results, key=lambda r: (r["maximumMiss"], r["centerLoss"], r["version"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--first", type=int, default=89801)
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--tiers", type=int, nargs="+", default=[6, 7, 8, 9])
    parser.add_argument("--candidate", default="candidate", help="Candidate name in the round archive")
    parser.add_argument("--training", action="store_true")
    args = parser.parse_args()
    opener = gzip.open if args.file.suffix == ".gz" else open
    with opener(args.file, "rt", encoding="utf-8") as source:
        rows = [json.loads(line) for line in source if line.strip()]
        result = training_rates(rows, args.first, args.count) if args.training else summarize(
            rows, args.first, args.count, args.tiers, args.candidate)
        print(json.dumps(result, indent=2))
