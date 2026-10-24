/**
 * Cut the captured shots, the title layer and the music edit into the finished trailer with ffmpeg.
 *
 * The edit is the `edit` list in trailer-config.mjs: each entry holds one shot on screen from its
 * `at` time to the next entry's, entering with a cut or a crossfade. Crossfades straddle the cut
 * point (half before, half after), so every cut still lands on the beat it was placed on.
 *
 * Usage: node scripts/trailer/assemble.mjs [--out=artifacts/trailer] [--crf=17]
 *   --preview          half size, fast encode, written as trailer-preview.mp4 (for checking a cut)
 *   --shots=DIR        read the clips from DIR instead of OUT/shots
 */
/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAILER } from './trailer-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...value] = a.slice(2).split('=');
    return [key, value.join('=') || true];
}));
const OUT = path.resolve(ROOT, String(args.out || 'artifacts/trailer'));
const PREVIEW = Boolean(args.preview);
const CRF = Number(args.crf || (PREVIEW ? 26 : 17));
const SHOTS = path.resolve(ROOT, String(args.shots || path.join(OUT, 'shots')));
const { fps } = TRAILER;
const width = PREVIEW ? TRAILER.width / 2 : TRAILER.width;
const height = PREVIEW ? TRAILER.height / 2 : TRAILER.height;
const frame = 1 / fps;
const snap = (t) => Math.round(t * fps) / fps;

/**
 * Camera moves made in post: zoom `z` and centre offset `dx`/`dy` (fractions of the frame) at
 * the start and end of the entry, eased in between. Done with ffmpeg's perspective filter, which
 * resamples at sub-pixel positions, so slow pushes and drifts glide instead of stepping a pixel
 * at a time. Zooms stay small (≤ 6 %) so the game's own pixels are barely enlarged.
 */
export const MOVES = {
    push: { from: { z: 1.0, dx: 0, dy: 0 }, to: { z: 1.05, dx: 0, dy: 0 } },
    pushSlow: { from: { z: 1.0, dx: 0, dy: 0 }, to: { z: 1.035, dx: 0, dy: 0 } },
    pull: { from: { z: 1.05, dx: 0, dy: 0 }, to: { z: 1.0, dx: 0, dy: 0 } },
    driftLeft: { from: { z: 1.045, dx: 0.016, dy: 0 }, to: { z: 1.045, dx: -0.016, dy: 0 } },
    driftRight: { from: { z: 1.045, dx: -0.016, dy: 0 }, to: { z: 1.045, dx: 0.016, dy: 0 } },
    rise: { from: { z: 1.045, dx: 0, dy: 0.016 }, to: { z: 1.045, dx: 0, dy: -0.016 } },
};

/** The perspective filter for a move over `frames` frames, or '' for none. */
export function moveFilter(name, frames) {
    if (!name) return '';
    const move = MOVES[name];
    if (!move) throw new Error(`unknown camera move ${name}`);
    const n = Math.max(1, frames - 1);
    // Smoothstep on the frame index: the move starts and settles gently.
    const p = `(min(1,in/${n})*min(1,in/${n})*(3-2*min(1,in/${n})))`;
    const lerp = (a, b) => (a === b ? `${a}` : `(${a}+(${b - a})*${p})`);
    const z = lerp(move.from.z, move.to.z);
    const cx = `(W/2+W*${lerp(move.from.dx, move.to.dx)})`;
    const cy = `(H/2+H*${lerp(move.from.dy, move.to.dy)})`;
    const hw = `(W/(2*${z}))`;
    const hh = `(H/(2*${z}))`;
    const left = `${cx}-${hw}`;
    const right = `${cx}+${hw}`;
    const top = `${cy}-${hh}`;
    const bottom = `${cy}+${hh}`;
    const q = (expr) => `'${expr}'`;
    return `,perspective=x0=${q(left)}:y0=${q(top)}:x1=${q(right)}:y1=${q(top)}`
        + `:x2=${q(left)}:y2=${q(bottom)}:x3=${q(right)}:y3=${q(bottom)}`
        + ':interpolation=cubic:sense=source:eval=frame';
}

export function planEdit(edit, duration) {
    return edit.map((entry, i) => {
        const next = edit[i + 1];
        const start = snap(entry.at);
        const end = snap(next ? next.at : duration);
        const fadeIn = i === 0 ? 0 : (entry.fade || 0);
        const fadeOut = next ? (next.fade || 0) : 0;
        return {
            ...entry,
            start,
            end,
            fadeIn,
            fadeOut,
            // The clip runs from half its incoming crossfade before its cut to half its outgoing after.
            clipStart: start - fadeIn / 2,
            clipLength: snap((end + fadeOut / 2) - (start - fadeIn / 2)),
        };
    });
}

function run(cmd, cmdArgs) {
    console.log(`$ ${cmd} ${cmdArgs.map((a) => (/\s|;|\[/.test(a) ? JSON.stringify(a) : a)).join(' ')}`.slice(0, 600));
    const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${cmd} exited with ${result.status}`);
}

function main() {
    const duration = TRAILER.duration;
    const plan = planEdit(TRAILER.edit, duration);
    const inputs = [];
    const filters = [];

    plan.forEach((entry, i) => {
        const file = path.join(SHOTS, `${entry.shot}.mp4`);
        if (!existsSync(file)) throw new Error(`missing shot ${entry.shot} (${file}); run capture first`);
        inputs.push('-i', file);
        const from = entry.in || 0;
        const frames = Math.round(entry.clipLength * fps);
        filters.push(`[${i}:v]trim=start=${from.toFixed(4)}:duration=${entry.clipLength.toFixed(4)},`
            + `setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:flags=lanczos,setsar=1`
            + `${moveFilter(entry.move, frames)},format=yuv420p,settb=1/${fps}[v${i}]`);
    });

    // Chain: a crossfade (xfade) where an entry asks for one, else a straight cut (concat).
    let acc = 'v0';
    let accLength = plan[0].clipLength;
    for (let i = 1; i < plan.length; i += 1) {
        const entry = plan[i];
        const out = `c${i}`;
        if (entry.fadeIn > 0) {
            const offset = accLength - entry.fadeIn;
            filters.push(`[${acc}][v${i}]xfade=transition=${entry.transition || 'fade'}:`
                + `duration=${entry.fadeIn.toFixed(4)}:offset=${offset.toFixed(4)}[${out}]`);
            accLength = offset + entry.clipLength;
        } else {
            filters.push(`[${acc}][v${i}]concat=n=2:v=1:a=0,settb=1/${fps}[${out}]`);
            accLength += entry.clipLength;
        }
        acc = out;
    }

    // Title layer: a PNG sequence with alpha covering the whole trailer.
    const overlayIndex = plan.length;
    inputs.push('-thread_queue_size', '512', '-framerate', String(fps), '-i', path.join(OUT, 'overlay', '%05d.png'));
    filters.push(`[${acc}]trim=duration=${duration.toFixed(4)},setpts=PTS-STARTPTS[base]`);
    filters.push(`[${overlayIndex}:v]format=rgba,scale=${width}:${height},trim=duration=${duration.toFixed(4)},`
        + 'setpts=PTS-STARTPTS[ovl]');
    filters.push('[base][ovl]overlay=format=auto:shortest=1,format=yuv420p[vout]');

    // Music: the cut list from the track, joined on downbeats with 20 ms fades, then a tail fade.
    const musicIndex = overlayIndex + 1;
    inputs.push('-i', path.join(ROOT, TRAILER.music.file));
    const segs = TRAILER.music.segments;
    segs.forEach((seg, i) => {
        const len = seg.to - seg.from;
        filters.push(`[${musicIndex}:a]atrim=start=${seg.from}:end=${seg.to},asetpts=PTS-STARTPTS,`
            + `afade=t=in:d=0.02,afade=t=out:st=${(len - 0.02).toFixed(4)}:d=0.02[a${i}]`);
    });
    filters.push(`${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1,`
        + `atrim=duration=${duration.toFixed(4)},`
        + `afade=t=out:st=${(duration - TRAILER.music.fadeOut).toFixed(4)}:d=${TRAILER.music.fadeOut},`
        + 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]');

    mkdirSync(OUT, { recursive: true });
    const graphFile = path.join(OUT, 'edit.ffgraph');
    writeFileSync(graphFile, filters.join(';\n'));
    const target = path.join(OUT, PREVIEW ? 'trailer-preview.mp4' : TRAILER.outputName);
    run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'warning', '-stats',
        ...inputs,
        '-filter_complex_script', graphFile,
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', PREVIEW ? 'veryfast' : 'slow', '-crf', String(CRF), '-pix_fmt', 'yuv420p',
        '-profile:v', 'high', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '256k',
        '-movflags', '+faststart',
        '-t', duration.toFixed(4),
        target,
    ]);
    console.log(`trailer → ${path.relative(ROOT, target)} (${duration.toFixed(2)} s, ${width}×${height}, ${fps} fps)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
