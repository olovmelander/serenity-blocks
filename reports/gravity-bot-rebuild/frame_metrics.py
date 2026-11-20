"""Timing gates for one packaged game, aggregated across its active bot seats."""
import math


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(fraction * len(values)) - 1)] if values else 0


def planning_gates(run):
    hz = run['requestedHz']
    p95_limit, p99_limit = {60: (2, 4), 165: (1.5, 2.5)}[hz]
    return {
        'planning p95': bool(run['times']) and percentile(run['times'], .95) <= p95_limit + 1e-6,
        'planning p99': bool(run['times']) and percentile(run['times'], .99) <= p99_limit + 1e-6,
        'every planner update within one frame': not run['overBudget'],
        'first legal plan on time at p95': bool(run['lateness']) and percentile(run['lateness'], .95) <= 1000 / hz + 1e-6,
    }
