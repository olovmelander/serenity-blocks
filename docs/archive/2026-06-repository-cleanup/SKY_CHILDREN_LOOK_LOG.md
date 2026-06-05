# Sky Children Look Log

## Purpose

Track style regressions and corrective parameter diffs during implementation.

Use this log for every snapshot review cycle described in:
- `docs/SKY_CHILDREN_ART_DIRECTION.md`
- `docs/SKY_CHILDREN_WEBGPU_THEME_PLAN.md`

## Logging Rules

- Record the exact shot ID/camera bookmark used for comparison.
- Record one concrete symptom per row.
- Include the corrective parameter diff or shader change that resolves the drift.
- Mark entries `closed` only after re-capture confirms the fix.

## Log Template

| Date | Build/Branch | Shot ID | Drift Symptom | Suspected Cause | Corrective Diff | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-02-16 | phase0-doc-lock | SC-SUN-02 | Initial baseline row for template lock | N/A | N/A | TBD | open |

## Status Vocabulary

- `open`: drift confirmed, fix not validated.
- `in-review`: fix implemented, awaiting recapture.
- `closed`: recapture verified, no further action.
