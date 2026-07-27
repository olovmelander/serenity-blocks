/**
 * Pure Stillwater performance-budget helpers shared by the production harness
 * and unit tests. A calibrated surface baseline and the absolute refresh-rate
 * ceiling are independent gates: passing one never suppresses the other.
 */

export function validatePerSurfaceBudgets(document) {
    const entries = document?.budgets?.frameP95Ms?.perSurface;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        return {
            ok: false,
            errors: ['budgets.frameP95Ms.perSurface must be an object.'],
        };
    }
    const errors = Object.entries(entries).flatMap(([surface, value]) => {
        if (value === null || (Number.isFinite(value) && value >= 0)) return [];
        return [`perSurface.${surface} must be null or a finite non-negative number.`];
    });
    return {
        ok: errors.length === 0,
        errors,
    };
}

export function evaluateStillwaterFrameBudget({
    candidateP95Ms,
    absoluteBudgetMs,
    baselineP95Ms = null,
    enforceBaseline = false,
    regressionTolerance = 0.1,
}) {
    const candidateMeasured = Number.isFinite(candidateP95Ms) && candidateP95Ms >= 0;
    const absoluteBudgetValid = Number.isFinite(absoluteBudgetMs) && absoluteBudgetMs >= 0;
    const baselineValid = Number.isFinite(baselineP95Ms) && baselineP95Ms >= 0;
    const regressionBudgetMs = baselineValid
        ? baselineP95Ms * (1 + regressionTolerance)
        : null;
    const absolutePass = candidateMeasured
        && absoluteBudgetValid
        && candidateP95Ms <= absoluteBudgetMs;
    const baselinePass = !enforceBaseline || (
        candidateMeasured
        && baselineValid
        && candidateP95Ms <= regressionBudgetMs
    );

    return {
        ok: absolutePass && baselinePass,
        candidateP95Ms: candidateMeasured ? candidateP95Ms : null,
        absoluteBudgetMs: absoluteBudgetValid ? absoluteBudgetMs : null,
        baselineP95Ms: baselineValid ? baselineP95Ms : null,
        regressionTolerance,
        regressionBudgetMs,
        absolutePass,
        baselineEnforced: enforceBaseline,
        baselinePass,
    };
}
