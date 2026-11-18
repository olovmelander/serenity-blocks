#!/usr/bin/env node
/**
 * Sakura Twilight's cranes: what the two rest cameras see of every route (no GPU, no browser).
 *
 *   node scripts/sakura-crane-probe.mjs [--night <seconds>] [--seed <n>] [--write]
 *
 * It plans the night's routes again (sakura-crane-routes.js: planCraneRoutes) and says whether
 * the table the theme flies (CRANE_ROUTES) is still that plan; `--write` writes the plan into the
 * table. Then, for each route, it flies the widest skein along it and projects every bird through
 * the landscape (16:9) and the portrait (540 x 1100) rest cameras: how long any bird is in the
 * frame and in the framing's open sky; the share of the flight seen (the skein's seconds in the
 * open sky, bird for bird, of its seconds in the frame), how many of them count (the birds large
 * enough to be cranes), how many are against the mountain and mirrored in the lake; how far from
 * the side the birds are seen, the span a bird is drawn at, the nearest it comes, whether every
 * bird begins and ends outside the widest frame, and when (seconds after it sets out, for staging a
 * capture with ?cranes=fly&craneRoute=<n>&craneAge=<s>) it is in the frame and in each open
 * window. Last the timetable of a night: when each flight sets out, on which route and which
 * way, and the longest wait between two.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    CRANE_FLIGHT, CRANE_KINDS, CRANE_ROUTES, CRANE_SEED, CRANE_SKY, craneFlightPlace, craneGap, craneLens,
    craneRouteFor, craneSkeinSize, createCraneFlight, layCraneSkein, planCraneRoutes, scoreCraneRoute,
} from '../src/themes/sakura-twilight/sakura-crane-routes.js';

const MODULE = fileURLToPath(new URL('../src/themes/sakura-twilight/sakura-crane-routes.js', import.meta.url));
const KEYS = ['x', 'z', 'heading', 'turn', 'from', 'to', 'length'];

const arg = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    const value = at > 0 ? Number(process.argv[at + 1]) : NaN;
    return Number.isFinite(value) ? value : fallback;
};
const night = arg('night', 1800);
const seed = arg('seed', CRANE_SEED);
const f = (value, digits = 1) => value.toFixed(digits);

/** The table as the module holds it (the lines between its two markers). */
function tableText(routes) {
    const rows = routes.map((route) => `    {\n        kind: '${route.kind}',\n${
        KEYS.map((key) => `        ${key}: ${String(route[key])},`).join('\n')}\n    },`);
    return [
        '// <routes>',
        'export const CRANE_ROUTES = Object.freeze([',
        ...rows,
        '].map((route) => Object.freeze(route)));',
        '// </routes>',
    ].join('\n');
}

/** When (seconds after it sets out, flown forwards) the widest skein's middle bird is in the frame and in each open window. */
function stages(route, framing) {
    const lens = craneLens(framing);
    const flight = layCraneSkein(createCraneFlight(), route, CRANE_FLIGHT.most, 0x5eed, 0, false);
    const place = [0, 0, 0, 0, 0, 0];
    const spans = [['in frame', {
        x0: 0, x1: 1, y0: 0, y1: 1,
    }], ...CRANE_SKY[framing].map((window, index) => [`window ${index}`, window])];
    return spans.map(([name, w]) => {
        let from = null;
        let to = null;
        for (let age = 0; age <= flight.life; age += 0.1) {
            craneFlightPlace(flight, Math.floor(flight.count / 2), age, place);
            const at = lens.project(place[0], place[1], place[2]);
            if (at && at.x >= w.x0 && at.x <= w.x1 && at.y >= w.y0 && at.y <= w.y1) {
                if (from === null) from = age;
                to = age;
            }
        }
        return from === null ? `${name}: never` : `${name}: age ${f(from)}-${f(to)} s`;
    }).join(', ');
}

const began = performance.now();
const planned = planCraneRoutes();
const took = performance.now() - began;
const same = planned.length === CRANE_ROUTES.length && planned.every((route, index) => (
    route.kind === CRANE_ROUTES[index].kind
    && KEYS.every((key) => Math.abs(route[key] - CRANE_ROUTES[index][key]) < 1e-9)
));
console.log(`${planned.length} routes planned (of ${CRANE_KINDS.length} kinds) in ${f(took)} ms; `
    + `the table the theme flies ${same ? 'is this plan' : 'is NOT this plan'}`);
let routes = CRANE_ROUTES;
if (process.argv.includes('--write')) {
    const text = readFileSync(MODULE, 'utf8');
    const from = text.indexOf('// <routes>');
    const to = text.indexOf('// </routes>') + '// </routes>'.length;
    if (from < 0 || to < from) throw new Error('the routes table was not found in the module');
    writeFileSync(MODULE, text.slice(0, from) + tableText(planned) + text.slice(to));
    console.log(`wrote the plan into ${MODULE}`);
    routes = planned;
} else if (!same) {
    console.log('(what follows is the PLAN; run again with --write to make the table that plan)');
    routes = planned;
}

console.log('');
routes.forEach((route, index) => {
    const heading = ((route.heading * 180) / Math.PI).toFixed(0);
    const seen = scoreCraneRoute(route, true);
    console.log(`route ${index} (${route.kind}): from (${f(route.x, 0)}, ${f(route.from, 0)}, ${f(route.z, 0)}) `
        + `heading ${heading} deg, `
        + `turn ${route.turn ? `1/${f(1 / route.turn, 0)} m` : 'none'}, ${f(route.length, 0)} m, `
        + `to ${f(route.to, 0)} m high, ${f(route.length / CRANE_FLIGHT.speed)} s for its leader`
        + `${seen ? `, score ${f(seen.score, 2)}` : ': NO FLIGHT'}`);
    for (const framing of seen ? ['landscape', 'portrait'] : []) {
        const view = seen[framing];
        const windows = view.windows.map((seconds) => f(seconds)).join(' + ');
        const share = (100 * view.open) / Math.max(view.birds, 0.1);
        console.log(`    ${framing.padEnd(9)} birds in the frame for ${f(view.inFrame)} s, `
            + `in the open sky for ${f(view.seen)} s; of the skein's ${f(view.birds)} bird-seconds in the frame `
            + `${f(view.open)} (${windows}) are in the open sky = ${f(share, 0)} % of the flight seen, `
            + `${f(view.well)} at a crane's size, ${f(view.mountain)} against the mountain, `
            + `${f(view.mirror)} mirrored in the lake; side-on ${f(view.side, 2)}, `
            + `span ${f(view.span)} px (least ${f(view.least)}), nearest in frame ${f(view.nearest, 0)} m, `
            + `born outside ${view.born}, gone outside ${view.gone}`);
        console.log(`    ${''.padEnd(9)} ${stages(route, framing)}`);
    }
});

console.log('');
console.log(`a night of ${night} s (seed ${seed}):`);
const flight = createCraneFlight();
const choice = { route: 0, reversed: false };
let start = craneGap(seed, -1);
let longest = start;
let last = 0;
let flights = 0;
let longestLife = 0;
for (let number = 0; start < night; number += 1) {
    craneRouteFor(seed, number, routes.length, choice);
    const count = craneSkeinSize(seed, number, CRANE_FLIGHT.most);
    layCraneSkein(flight, routes[choice.route], count, seed, number, choice.reversed);
    console.log(`  flight ${String(number).padStart(2)} sets out at ${f(start).padStart(7)} s: route ${choice.route} `
        + `(${routes[choice.route].kind})${choice.reversed ? ' the other way' : ''}, ${count} birds in a `
        + `${flight.line ? 'line' : 'V'}, ${f(flight.life)} s in the air`);
    flights += 1;
    longestLife = Math.max(longestLife, flight.life);
    const gap = craneGap(seed, number);
    longest = Math.max(longest, gap);
    last = start;
    start += gap;
}
console.log(`  ${flights} flights; the longest wait from one setting out to the next ${f(longest)} s; `
    + `the longest flight ${f(longestLife)} s; the last set out at ${f(last)} s`);
