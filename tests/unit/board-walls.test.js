import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    applyPlayerColor, boardWallColor, deepenLightBlue, isLightBlue, parseCssColor, relativeLuminance, rgbToHsl,
    toHex, WALL_HUE_SHARE, WALL_LIFT,
} from '../../src/ui/board-walls.js';
import { PLAYER_COLORS as ONLINE_COLORS } from '../../src/core/constants.js';
import { PLAYER_COLORS as LOCAL_SCHEMES } from '../../src/core/multi-player-state.js';

// The rule: a board's near-black field never stands in a light-blue frame.

/** The stylesheets' own mix: 82 % colour, 18 % cream, in sRGB, before any deepening. */
function plainMix(color) {
    const c = parseCssColor(color);
    const k = parseCssColor(WALL_LIFT);
    const mix = (a, b) => a * WALL_HUE_SHARE + b * (1 - WALL_HUE_SHARE);
    return toHex({ r: mix(c.r, k.r), g: mix(c.g, k.g), b: mix(c.b, k.b) });
}

describe('board walls: colour rule', () => {
    it('reads hex and rgb() colours, and nothing else', () => {
        const rgba = (r, g, b, a) => ({
            r, g, b, a,
        });
        expect(parseCssColor('#9ee8ed')).toEqual(rgba(158, 232, 237, 1));
        expect(parseCssColor('#fff')).toEqual(rgba(255, 255, 255, 1));
        expect(parseCssColor('#00e5ff80')).toMatchObject({ r: 0, g: 229, b: 255 });
        expect(parseCssColor('rgba(255, 246, 233, 0.22)')).toEqual(rgba(255, 246, 233, 0.22));
        expect(parseCssColor('rgb(9 8 24 / 50%)')).toEqual(rgba(9, 8, 24, 0.5));
        for (const bad of ['', 'cyan', '#12', '#ggg', 'rgb(1, 2)', 'hsl(180 50% 50%)', null, 7]) {
            expect(parseCssColor(bad), String(bad)).toBeNull();
        }
    });

    it('calls the light blues light blue, and the game\'s other hues not', () => {
        const lightBlue = ['#00bfff', '#87ceeb', '#add8e6', '#9ee8ed', plainMix('#9ee8ed'), plainMix('#00e5ff')];
        const notLightBlue = ['#b8a4ff', '#f3d28d', '#ffac88', '#ff9cab', '#ff0000', '#00c853', '#f6d58a',
            plainMix('#3B82F6'), plainMix('#2979ff'), '#090818', '#ffffff'];
        for (const color of lightBlue) expect(isLightBlue(color), color).toBe(true);
        for (const color of notLightBlue) expect(isLightBlue(color), color).toBe(false);
        expect(isLightBlue('not a colour')).toBe(false);
    });

    it('paints the stylesheets\' mix, deepened only when it comes out light blue', () => {
        // Not light blue: exactly the mix the stylesheets draw.
        for (const color of ['#b8a4ff', '#f3d28d', '#ffac88', '#ff9cab', '#3B82F6', '#2979ff']) {
            expect(boardWallColor(color), color).toBe(plainMix(color));
        }
        // Light blue: same hue, same saturation, darker until it no longer is.
        for (const color of ['#00bfff', '#87ceeb', '#add8e6', '#9ee8ed', '#00e5ff']) {
            const mix = plainMix(color);
            const wall = boardWallColor(color);
            expect(isLightBlue(mix), color).toBe(true);
            expect(isLightBlue(wall), color).toBe(false);
            const [m, w] = [rgbToHsl(parseCssColor(mix)), rgbToHsl(parseCssColor(wall))];
            expect(Math.abs(w.h - m.h), color).toBeLessThan(4);
            expect(Math.abs(w.s - m.s), color).toBeLessThan(0.08);
            expect(w.l, color).toBeLessThan(m.l);
        }
        expect(boardWallColor('cyan')).toBeNull();
        expect(deepenLightBlue('#f3d28d')).toBe('#f3d28d');
        expect(deepenLightBlue('#8cd3ed')).toBe('#1e92bd');
    });

    it('never gives a player in either palette a light-blue wall; cyan keeps a deep cyan', () => {
        const colours = [...ONLINE_COLORS, ...LOCAL_SCHEMES.map((scheme) => scheme.primary)];
        expect(colours.length).toBeGreaterThanOrEqual(12);
        for (const color of colours) {
            const wall = boardWallColor(color);
            expect(wall, color).toMatch(/^#[0-9a-f]{6}$/);
            expect(isLightBlue(wall), `${color} -> ${wall}`).toBe(false);
        }
        expect(ONLINE_COLORS).toContain('#00e5ff');
        const cyan = boardWallColor('#00e5ff');
        expect(cyan).not.toBe(plainMix('#00e5ff'));
        expect(cyan).toBe('#0397a6');
        const { h } = rgbToHsl(parseCssColor(cyan));
        expect(h).toBeGreaterThan(180);
        expect(h).toBeLessThan(192);
        expect(relativeLuminance(parseCssColor(cyan))).toBeLessThan(0.25);
    });

    it('puts the colour and its wall on a card together', () => {
        const props = new Map();
        const card = {
            style: {
                setProperty: (name, value) => props.set(name, value),
                removeProperty: vi.fn((name) => props.delete(name)),
            },
        };
        applyPlayerColor(card, '#00e5ff');
        expect(props.get('--player-primary')).toBe('#00e5ff');
        expect(props.get('--player-wall')).toBe('#0397a6');
        // A colour it can't read: the stylesheet's mix draws the walls, never a stale wall.
        applyPlayerColor(card, 'cyan');
        expect(props.get('--player-primary')).toBe('cyan');
        expect(props.has('--player-wall')).toBe(false);
        expect(() => applyPlayerColor(null, '#00e5ff')).not.toThrow();
    });
});

// ---- The stylesheets' walls ---------------------------------------------------------------

const STYLES = path.resolve(__dirname, '../../public/styles');
const css = (file) => readFileSync(path.join(STYLES, file), 'utf8');

/** The sheets that draw the boards' walls today. main.css and multiplayer-ui.css still hold
 *  older frames on the same elements, but the keystone layers above clear or recolour them
 *  (border: 0, display: none, outline-color), so they are not scanned. */
const WALL_SHEETS = [
    'keystone-solo.css', 'keystone-versus.css', 'keystone-online.css', 'keystone-overlays.css',
    'stillfall.css', 'odyssey-flow.css',
];
/** The walls' own variables. */
const WALL_VARS = ['--sp-wall', '--lv-wall', '--ov-wall', '--ow-wall'];
/** The elements that are a board's frame, as the last part of a selector. */
const FRAME_SUBJECTS = [
    '#single-player-border', '.lv-well', '.ov-well', '.opponent-well', '.opponent-mini-board',
    '.spectator-spotlight-canvas', '.odyssey-duel-opponent__well', '.stillfall-well',
];
const FRAME_PAINT = /^(border(-(top|right|bottom|left))?(-color)?|outline(-color)?)$/;
/** Paints here that recolour an older frame in an unscanned sheet, so they must stay: the
 *  spectator's pick is outlined in multiplayer-ui.css in a peer's raw colour (teal by default). */
const OVERRIDES = [['.opponent-mini-board.spotlighted', 'outline-color']];
/** Hues a wall formula is drawn with, set by other rules (every value they take is tried). */
const HUE_VARS = ['--sp-hue', '--ody-bot-hue', '--atlas-hue-rgb'];
/** The field the walls stand round: a translucent wall is judged over it. */
const FIELD = { r: 9, g: 8, b: 24 };

/** The index of the parenthesis closing the one at `open`. */
function closing(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) return i;
    }
    throw new Error(`unbalanced: ${text}`);
}

/** Splits at `separator` outside parentheses. */
function splitTop(text, separator) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (depth === 0 && separator.test(text[i])) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
}

/** Every rule ({ sheet, selector, keyframes, decls }), at-rules opened. */
function rules(sheet) {
    const out = [];
    const walk = (body, keyframes) => {
        let i = 0;
        while (i < body.length) {
            const open = body.indexOf('{', i);
            if (open < 0) break;
            const prelude = body.slice(i, open).split(';').pop().trim();
            let depth = 1;
            let j = open + 1;
            for (; depth && j < body.length; j++) {
                if (body[j] === '{') depth++;
                else if (body[j] === '}') depth--;
            }
            const inner = body.slice(open + 1, j - 1);
            if (prelude.startsWith('@keyframes')) walk(inner, prelude.split(/\s+/)[1]);
            else if (prelude.startsWith('@')) walk(inner, null);
            else {
                const decls = splitTop(inner, /;/).map((decl) => {
                    const colon = decl.indexOf(':');
                    return [decl.slice(0, colon).trim(), decl.slice(colon + 1).replace(/!important/, '').trim()];
                });
                out.push({
                    sheet, selector: prelude.replace(/\s+/g, ' '), keyframes, decls,
                });
            }
            i = j;
        }
    };
    walk(css(sheet).replace(/\/\*[\s\S]*?\*\//g, ''), null);
    return out;
}

/** Replaces each var() with its value in `env`, else its fallback (outermost first). */
function substitute(value, env) {
    let out = value;
    for (let at = out.indexOf('var('); at >= 0; at = out.indexOf('var(')) {
        const end = closing(out, at + 3);
        const args = out.slice(at + 4, end);
        const comma = args.indexOf(',');
        const name = (comma < 0 ? args : args.slice(0, comma)).trim();
        const fallback = comma < 0 ? null : args.slice(comma + 1);
        const replacement = env.has(name) ? env.get(name) : fallback;
        if (replacement === null) throw new Error(`${name} has no value in ${value}`);
        out = out.slice(0, at) + replacement.trim() + out.slice(end + 1);
    }
    return out;
}

/** A colour from a substituted value: hex, rgb()/rgba(), transparent or color-mix(in srgb, …). */
function evaluate(value) {
    const text = value.trim();
    if (text === 'transparent') {
        return {
            r: 0, g: 0, b: 0, a: 0,
        };
    }
    if (text.startsWith('color-mix(')) {
        const [space, ...stops] = splitTop(text.slice('color-mix('.length, closing(text, 9)), /,/);
        expect(space, text).toBe('in srgb');
        const parsed = stops.map((stop) => {
            const share = /\s(\d+(?:\.\d+)?)%$/.exec(stop);
            return {
                color: evaluate(share ? stop.slice(0, share.index) : stop),
                p: share ? Number(share[1]) / 100 : null,
            };
        });
        const [a, b] = parsed;
        const pa = a.p ?? (b.p === null ? 0.5 : 1 - b.p);
        const pb = b.p ?? 1 - pa;
        const alpha = a.color.a * pa + b.color.a * pb;
        const channel = (k) => (alpha ? (a.color[k] * a.color.a * pa + b.color[k] * b.color.a * pb) / alpha : 0);
        return {
            r: channel('r'), g: channel('g'), b: channel('b'), a: alpha,
        };
    }
    const color = parseCssColor(text);
    if (!color) throw new Error(`can't read the colour ${text}`);
    return color;
}

/** Over the field, as the eye sees it. */
const overField = ({
    r, g, b, a,
}) => ({
    r: r * a + FIELD.r * (1 - a), g: g * a + FIELD.g * (1 - a), b: b * a + FIELD.b * (1 - a),
});

/** A shorthand's colour part (`3px solid var(--sp-wall)` -> `var(--sp-wall)`), or null. */
function paintColor(property, value) {
    if (property.endsWith('-color')) return value;
    const widthOrStyle = /^(-?[\d.]|none$|hidden$|solid$|dashed$|dotted$|double$)/;
    const rest = splitTop(value, /\s/).filter((token) => !widthOrStyle.test(token));
    expect(rest.length, `${property}: ${value}`).toBeLessThanOrEqual(1);
    return rest[0] ?? null;
}

/** A selector's last compound, per selector in a list. */
const subjects = (selector) => splitTop(selector, /,/).map((one) => one.split(/\s*[>+~]\s*|\s+/).pop());
/** Whether a compound is one of the frames (`.lv-well`, `#single-player-border.odyssey-goal-flare`). */
const frameOf = (subject) => FRAME_SUBJECTS.find((frame) => subject.startsWith(frame)
    && !/[\w-]/.test(subject.charAt(frame.length)));

describe('board walls: the stylesheets', () => {
    const all = WALL_SHEETS.flatMap(rules);
    const tokens = new Map(rules('keystone.css').filter((rule) => rule.selector === ':root')
        .flatMap((rule) => rule.decls).filter(([name]) => name.startsWith('--sb-')));
    const declared = (name) => all.flatMap((rule) => rule.decls.filter(([prop]) => prop === name)
        .map(([, value]) => ({ rule, value })));

    // A hue rule whose state has its own wall, not the hue's mix: the Infinity well (its rule
    // and its wall's rule differ only by a :not(:where(…)) that lets Odyssey keep its gold).
    const plainSelector = (selector) => selector.replace(/:not\(:where\([^()]*\)\)/g, '');
    const ownWalls = declared('--sp-wall').filter(({ value }) => !value.includes('--sp-hue'))
        .map(({ rule }) => plainSelector(rule.selector));
    const hueValues = new Map(HUE_VARS.map((name) => [name, declared(name)
        .filter(({ rule }) => name !== '--sp-hue' || !ownWalls.includes(rule.selector))
        .map(({ value }) => value)]));

    /** Every colour a value can paint: each hue it draws with, every value that hue takes. */
    function paints(value) {
        let envs = [new Map(tokens)];
        for (const name of HUE_VARS.filter((hue) => value.includes(`var(${hue}`))) {
            envs = envs.flatMap((env) => hueValues.get(name).map((hue) => new Map(env).set(name, hue)));
        }
        return envs.map((env) => {
            const resolved = substitute(value, env);
            return { resolved, color: toHex(overField(evaluate(resolved))) };
        });
    }

    it('finds every wall it guards (a rename must not hollow the scan out)', () => {
        for (const name of WALL_VARS) expect(declared(name).length, name).toBeGreaterThan(0);
        const framed = new Set(all.flatMap((rule) => subjects(rule.selector).map(frameOf).filter(Boolean)));
        expect([...framed].sort()).toEqual([...FRAME_SUBJECTS].sort());
        for (const [subject, property] of OVERRIDES) {
            const found = all.some((rule) => subjects(rule.selector).includes(subject)
                && rule.decls.some(([prop]) => prop === property));
            expect(found, `${subject} { ${property} }`).toBe(true);
        }
        for (const name of HUE_VARS) expect(hueValues.get(name).length, name).toBeGreaterThan(0);
        expect(tokens.get('--sb-aqua')).toBe('#9ee8ed');
    });

    it('draws no wall variable in a light blue', () => {
        const checked = [];
        for (const name of WALL_VARS) {
            for (const { rule, value } of declared(name)) {
                // A player's colour reaches the walls deepened: --player-wall comes first.
                if (value.includes('--player-primary')) expect(value, rule.selector).toMatch(/^var\(--player-wall,/);
                for (const { resolved, color } of paints(value)) {
                    checked.push(color);
                    expect(isLightBlue(color), `${rule.sheet} ${rule.selector} ${name}: ${resolved} = ${color}`)
                        .toBe(false);
                }
            }
        }
        expect(checked.length).toBeGreaterThanOrEqual(15);
    });

    it('frames no board in a light blue, keyframes included', () => {
        const frames = all.filter((rule) => !rule.keyframes && subjects(rule.selector).some(frameOf));
        const animations = new Set(frames.flatMap((rule) => rule.decls
            .filter(([prop]) => prop === 'animation' || prop === 'animation-name')
            .map(([, value]) => value.split(/\s+/)[0])));
        expect(animations.has('ody-goal-flare'), 'the Odyssey goal flare recolours the walls').toBe(true);
        const flares = all.filter((rule) => animations.has(rule.keyframes));
        let checked = 0;
        for (const rule of [...frames, ...flares]) {
            for (const [prop, value] of rule.decls.filter(([name]) => FRAME_PAINT.test(name))) {
                const color = paintColor(prop, value);
                if (!color) continue;
                checked++;
                // A wall variable is held by the test above.
                if (WALL_VARS.some((name) => color === `var(${name})`)) continue;
                if (color.includes('--player-primary')) expect(color, rule.selector).toMatch(/^var\(--player-wall,/);
                for (const { resolved, color: painted } of paints(color)) {
                    const where = `${rule.sheet} ${rule.keyframes ?? ''} ${rule.selector} ${prop}`;
                    expect(isLightBlue(painted), `${where}: ${resolved} = ${painted}`).toBe(false);
                }
            }
        }
        expect(checked).toBeGreaterThanOrEqual(10);
    });

    it('gives Infinity its aqua deepened: boardWallColor(--sb-aqua)', () => {
        expect(boardWallColor('#9ee8ed')).toBe('#249597');
        const infinity = '.single-player-stage[data-board=\'well\'].infinity-mode-active';
        const hue = declared('--sp-hue').find(({ rule }) => rule.selector === infinity);
        expect(hue?.value).toBe('var(--sb-aqua)');
        const wall = declared('--sp-wall').find(({ rule }) => plainSelector(rule.selector) === infinity);
        expect(wall?.value).toBe(boardWallColor(tokens.get('--sb-aqua')));
        expect(ownWalls).toContain(infinity);
    });
});
