// @ts-check
/**
 * Central runtime-flag registry + shared reader (remediation plan Phase 0.6).
 *
 * Reader precedence: URL `?name=1`/`?name=0` → localStorage `serenity.<name>`
 * ('1'/'0') → default. The installed Electron app loads from file:// with no
 * query string, so localStorage is the toggle a user has in the DevTools
 * console (`localStorage.setItem('serenity.lockEvents','0')` + reload); the
 * URL param wins in dev. This is the exact semantics of the former
 * `readNetFlag` (ffa-p2p-game-state.js) / `readOnlineNetFlag`
 * (OnlineMultiplayerMode.js) clones, now defined once.
 *
 * Registry policy (enforced by tests/unit/flag-registry.test.js):
 * - kind 'permanent-ops': quality tiers, debug/diagnostics, a11y, capture
 *   harness knobs. Exempt from expiry governance. Theme-local URL knobs
 *   (forceWebGL, no*, seed/fixedDt/playback, …) stay declared in their themes
 *   and are NOT listed here — they are permanent-ops by convention.
 * - kind 'refactor': temporary migration/rollback levers. Every entry MUST
 *   declare either a dated `expiry` (new Movement C flags) or a
 *   `graduationBar` (pre-existing flags whose graduation criteria live in the
 *   remediation plan, e.g. §6A.1). A dated expiry in the past fails CI — the
 *   "time bomb" that stops release flags outliving their purpose.
 * - CAP: at most 2 refactor flags with dated expiries may be active at once
 *   (Movement C ground rule — code paths double per flag).
 *
 * Call sites remain authoritative for defaults today (they pass defaultOn);
 * registry defaults are documentary until call sites migrate to
 * `readFlag(name)`. Where both exist they must agree.
 *
 * @typedef {Object} FlagDecl
 * @property {string} name            URL param / localStorage suffix
 * @property {boolean|string|null} default
 * @property {string} purpose
 * @property {'permanent-ops'|'refactor'} kind
 * @property {string} [expiry]        ISO date — required for NEW refactor flags
 * @property {string} [graduationBar] plan §ref defining when the flag graduates
 * @property {string} [reader]        'flags' (this module) | 'local' (own idiom, not yet migrated)
 */

/**
 * Resolve a runtime feature flag.
 * @param {string} name
 * @param {boolean} [defaultOn] - falls back to the registry default, else false.
 * @returns {boolean}
 */
export function readFlag(name, defaultOn = registryDefault(name)) {
    if (typeof window === 'undefined') return defaultOn;
    const search = (window.location && window.location.search) || '';
    if (new RegExp(`[?&]${name}=1\\b`).test(search)) return true;
    if (new RegExp(`[?&]${name}=0\\b`).test(search)) return false;
    try {
        const ls = window.localStorage && window.localStorage.getItem(`serenity.${name}`);
        if (ls === '1') return true;
        if (ls === '0') return false;
    } catch (e) { /* localStorage unavailable — fall through to default */ }
    return defaultOn;
}

/** @type {FlagDecl[]} */
export const FLAG_REGISTRY = [
    // ── Netcode (read via readFlag in ffa-p2p-game-state.js / OnlineMultiplayerMode.js) ──
    {
        name: 'simTickNetcode', default: false, purpose: '60Hz fixed sim-tick netcode (host accumulator + jitter-buffer rate)', kind: 'refactor', graduationBar: 'plan §5.3 subsumes it — fold into the unified fixed tick, then delete', reader: 'flags',
    },
    {
        name: 'adaptiveInputJitter', default: false, purpose: 'adaptive host InputJitterBuffer mode', kind: 'refactor', graduationBar: 'plan §6A.1 flag matrix soak + pinning test', reader: 'flags',
    },
    {
        name: 'lockEvents', default: false, purpose: 'reliable authoritative board snap on every piece lock', kind: 'refactor', graduationBar: 'plan §6A.1 (conflicts with snapshot interpolator while off)', reader: 'flags',
    },
    {
        name: 'authoritativeAttacks', default: false, purpose: 'host-authoritative attack resolution', kind: 'refactor', graduationBar: 'plan §6B.1 — requires Phase 5 determinism', reader: 'flags',
    },
    {
        name: 'deterministicGarbage', default: false, purpose: 'deterministic garbage seeding', kind: 'refactor', graduationBar: 'plan §6A.1 flag matrix soak', reader: 'flags',
    },
    {
        name: 'localBoardHold', default: true, purpose: 'anti-flicker: keep locally-predicted board until host acks latest input', kind: 'refactor', graduationBar: 'rollback lever — delete with plan §6B.3 input-stream remote boards', reader: 'flags',
    },
    {
        name: 'holdStats', default: true, purpose: 'extend local-board hold to score/lines/level + garbage queue', kind: 'refactor', graduationBar: 'rollback lever — delete with plan §6B.3', reader: 'flags',
    },
    {
        name: 'peerLocalSim', default: true, purpose: 'PEER-OWNS-BOARD full local sim on peer (Quadra model)', kind: 'refactor', graduationBar: 'rollback lever — becomes the only path in plan §6B.3, then delete', reader: 'flags',
    },
    {
        name: 'opponentClearEvents', default: true, purpose: 'grid-free GAME_LINES_CLEAR flash on opponent mini-boards', kind: 'refactor', graduationBar: 'rollback lever — plan §6A.1', reader: 'flags',
    },
    {
        name: 'garbageIdempotent', default: true, purpose: 'dedupe garbage adopt by attackId:lineIndex', kind: 'refactor', graduationBar: 'rollback lever — plan §6A.1', reader: 'flags',
    },
    {
        name: 'garbageDrainAll', default: true, purpose: 'drain entire garbage queue per spawn (local-MP parity)', kind: 'refactor', graduationBar: 'rollback lever — plan §6A.1', reader: 'flags',
    },
    {
        name: 'downloadJoin', default: false, purpose: 'drop-in mid-match join via state download', kind: 'refactor', graduationBar: 'plan §6A.6 join/resync state machine graduates it', reader: 'flags',
    },
    {
        name: 'migrationEpoch', default: false, purpose: 'host-migration epoch fencing', kind: 'refactor', graduationBar: 'plan §6A.1 flag matrix soak', reader: 'flags',
    },
    {
        name: 'readyBarrier', default: false, purpose: 'all-players-ready round-restart syncpoint', kind: 'refactor', graduationBar: 'plan §6A.6 (Quadra #12 reseed barrier)', reader: 'flags',
    },
    {
        name: 'adaptiveInterp', default: false, purpose: 'adaptive snapshot-interpolation delay', kind: 'refactor', graduationBar: 'plan §6A.1 flag matrix soak', reader: 'flags',
    },
    {
        name: 'netDiag', default: true, purpose: '1/sec 📡 [NET] peer network-health console summary', kind: 'permanent-ops', reader: 'flags',
    },
    {
        name: 'netEventLog', default: true, purpose: 'in-memory net event ring log (512 entries)', kind: 'permanent-ops', reader: 'flags',
    },
    {
        name: 'desyncCheck', default: true, purpose: 'peer-local-sim divergence backstop (digest compare → forceLocal resync); plan §1.2', kind: 'permanent-ops', reader: 'flags',
    },

    // ── Boot / intro (local readers in main.js / boot-warp-transition.js / intro-animation.js) ──
    {
        name: 'noThemeWarm', default: false, purpose: 'kill-switch: skip pre-intro theme WebGPU warm', kind: 'refactor', graduationBar: 'plan §4.7 boot state machine replaces the warm choreography', reader: 'local',
    },
    {
        name: 'noBootWarp', default: false, purpose: 'disable WebGPU hyperspace boot reveal', kind: 'refactor', graduationBar: 'plan §4.7 — graduate to permanent-ops a11y toggle or delete', reader: 'local',
    },
    {
        name: 'introV2', default: true, purpose: 'intro v2 vs legacy intro', kind: 'refactor', graduationBar: 'delete legacy intro after one stable release on v2', reader: 'local',
    },
    {
        name: 'winterLegacy', default: false, purpose: 'force legacy WebGL winter scene vs Wonderland rebuild', kind: 'refactor', graduationBar: 'delete after Wonderland ships a full release without regression', reader: 'local',
    },

    // ── Odyssey (local readers in OdysseyMode.js / OdysseyBoardController.js / LevelNodeManager.js) ──
    {
        name: 'odysseyKeepBoard', default: true, purpose: 'keep WebGPU board resident across level entry/return', kind: 'refactor', graduationBar: 'Odyssey masterplan — delete the non-resident path after a stable release', reader: 'local',
    },
    {
        name: 'odysseyChapterEvict', default: false, purpose: 'chapter LRU eviction (built, default-off; masterplan #1 flip)', kind: 'refactor', graduationBar: 'Odyssey masterplan §assets — flip default-on after eviction soak', reader: 'local',
    },
    {
        name: 'odysseyCoreInstanced', default: true, purpose: 'instanced level-node cores vs legacy per-node meshes', kind: 'refactor', graduationBar: 'delete legacy per-node path after a stable release', reader: 'local',
    },
    {
        name: 'odysseySerialInit', default: false, purpose: 'fully-serial create→compile chain (driver insurance)', kind: 'refactor', graduationBar: 'delete if unused after Odyssey loading work (plan memo) completes', reader: 'local',
    },
    {
        name: 'odysseyFastStartOff', default: false, purpose: 'disable fast-start warm scope (warm all chapters pre-reveal)', kind: 'refactor', graduationBar: 'Odyssey masterplan — delete with the warm-scope decision', reader: 'local',
    },
    {
        name: 'odysseyBgWarm', default: true, purpose: 'background render-warm of chapters (kill-switch when 0)', kind: 'refactor', graduationBar: 'Odyssey masterplan background-load jank item', reader: 'local',
    },
    {
        name: 'odysseyDomeCullOff', default: false, purpose: 'rollback: disable global atmosphere-dome culling', kind: 'refactor', graduationBar: 'delete after dome culling survives a stable release', reader: 'local',
    },
    {
        name: 'odysseyLightsFirst', default: false, purpose: 'lights-before-compile ordering experiment (cold-start suspect)', kind: 'refactor', graduationBar: 'Odyssey masterplan cold-start item — decide and delete', reader: 'local',
    },
    {
        name: 'odysseyEagerWindowOff', default: false, purpose: 'disable startup chapter-window restriction', kind: 'refactor', graduationBar: 'Odyssey masterplan loading item', reader: 'local',
    },
    {
        name: 'odysseyWarpPreinit', default: 'defer', purpose: 'warp transition pre-init timing A/B (immediate|defer|off)', kind: 'refactor', graduationBar: 'A/B lever — pick a winner and delete', reader: 'local',
    },
    {
        name: 'owmDirtyCheck', default: true, purpose: 'opponent mini-board dirty-check repaint skip (rollback when 0)', kind: 'refactor', graduationBar: 'delete after a stable release with dirty-check on', reader: 'local',
    },

    // ── Movement C / Phase 5 (declared BEFORE the phase starts — plan §Movement C
    // ground rule (a): every transform ships dark on main behind a registry flag) ──
    {
        name: 'rngV2', default: false, purpose: 'sfc32 per-subsystem PRNG (src/core/rng.js) replaces the LCG as the sim randomness source — plan §5.6', kind: 'refactor', graduationBar: 'plan §5.10 differential gate clean over the 50-session soak, then the §5.0 cutover ladder; delete legacy LCG + flag together', reader: 'local',
    },
    {
        name: 'fixedTick', default: false, purpose: '60Hz fixed-tick simulation (integer accumulators, unified clamp) — plan §5.3', kind: 'refactor', graduationBar: 'plan §5.0 cutover ladder: differential gate → online-MP default-on → solo → one release with legacy rollback → delete legacy + flag together', reader: 'local',
    },
    {
        name: 'cascadeShadow', default: false, purpose: 'production differential: run the pure §5.2 resolveCascade in shadow against legacy processPhysics on every lock, diff end-state + hole masks, log divergence — plan §5.10', kind: 'refactor', graduationBar: 'plan §5.10 legacy-deletion gate (≥50 clean sessions, ≥5 human) → resolver cutover replaces legacy processPhysics; flag dies with the legacy path', reader: 'flags',
    },
];

/** @param {string} name @returns {boolean} */
function registryDefault(name) {
    const decl = FLAG_REGISTRY.find((f) => f.name === name);
    return typeof decl?.default === 'boolean' ? decl.default : false;
}
