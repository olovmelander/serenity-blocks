/**
 * Architecture boundary rules (ARCHITECTURAL_REMEDIATION_PLAN.md Phase 3d,
 * layer 1). dependency-cruiser is the CI source of truth for import boundaries;
 * each rule cites the plan section / ADR it enforces.
 *
 * KNOWN-VIOLATIONS BASELINE: src/core already crosses the headless boundary in
 * exactly 9 files (measured 2026-07-10; OrbPortalTransitionDirector deleted
 * 2026-07-16 as unreachable dead code) — the six game-mode classes, the FFA
 * god-class, one odyssey transition director, and the steam invite manager.
 * They are carved out of `from` below so day one isn't red. Shrink-only: when a
 * file stops importing across the boundary, delete it from the carve-out; NEVER
 * add one. These files move to an adapters layer in Movement C (plan §4.6).
 */
const CORE_HEADLESS_KNOWN_VIOLATORS = '^src/core/('
    + 'game-modes/(InfinityMode|LocalMultiplayerMode|OdysseyMode|OnlineMultiplayerMode|SerenityMode|SinglePlayerMode)'
    + '|multiplayer/ffa-p2p-game-state'
    + '|odyssey/ThemeTransitionManager'
    + '|steam/steam-invite-manager'
    + ')\\.js$';

module.exports = {
    forbidden: [
        {
            name: 'core-stays-headless',
            comment: 'src/core is the deterministic simulation layer — it must not import UI, '
                + 'themes, rendering, playground, or audio. Rendering observes the sim; it never '
                + 'authors gameplay truth. Plan §1.3 target architecture / ADR-0004. The 10 known '
                + 'violators are carved out of `from` as the shrink-only baseline.',
            severity: 'error',
            from: {
                path: '^src/core/',
                pathNot: CORE_HEADLESS_KNOWN_VIOLATORS,
            },
            to: {
                path: '^src/(ui|themes|rendering|playground|audio)/',
                // constants.js imports the theme id LIST (data, not UI code).
                pathNot: '^src/themes/theme-registry\\.js$',
            },
        },
        {
            name: 'themes-are-islands',
            comment: 'A theme must not import ANOTHER theme — shared code lives in themes/shared '
                + 'or the base/registry/manager. The $1 back-reference excludes same-theme imports; '
                + 'only cross-theme edges are flagged. Plan §3d.',
            severity: 'error',
            from: {
                path: '^src/themes/([^/]+)/',
                // Known cross-theme imports (measured 2026-07-10) — shrink-only
                // baseline: winter/sim borrows a starlight TSL noise lib.
                // Delete an entry when the import is removed; never add one.
                // (sky-children-legacy entry removed 2026-07-16 with the deletion
                // of the unregistered sky-children v1 theme; pyrestorm-v2 entry
                // removed 2026-08-16 with the deletion of the theme itself.)
                pathNot: [
                    '^src/themes/winter/sim/snow-sim\\.js$',
                ],
            },
            to: {
                path: '^src/themes/([^/]+)/',
                pathNot: [
                    '^src/themes/$1/', // same theme — allowed
                    '^src/themes/shared/',
                    '^src/themes/base-theme\\.js$',
                    '^src/themes/theme-registry\\.js$',
                    '^src/themes/theme-manager\\.js$',
                ],
            },
        },
        {
            name: 'no-electron-in-renderer-src',
            comment: 'src/ (the renderer bundle) must never import electron or node built-ins — '
                + 'those belong in the electron/ main process. Plan §3d / platform boundary. '
                + 'Vitest files are exempt: they run in Node, never ship in the bundle, and the '
                + 'source-lint tests read src files off disk by design.',
            severity: 'error',
            from: {
                path: '^src/',
                pathNot: '\\.test\\.js$',
            },
            to: { path: '^(electron|node:.*|fs|path|child_process|os|net)$' },
        },
        {
            name: 'no-circular',
            comment: 'Circular imports (plan §3d) — count reached ZERO 2026-07-11 (game⇄physics and '
                + 'game⇄infinity-grid broken by moving markBoardDirty to board.js); now a hard gate.',
            severity: 'error',
            from: {},
            to: { circular: true },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default'],
        },
    },
};
