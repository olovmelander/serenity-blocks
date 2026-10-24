/**
 * Cut the captured shots, the title layer and the music edit into the finished trailer with ffmpeg.
 *
 * The edit is the `edit` list in trailer-config.mjs: each entry holds one shot on screen from its
 * `at` time to the next entry's, entering with a cut or a crossfade. Crossfades straddle the cut
 * point (half before, half after), so every cut still lands on the beat it was placed on.
 *
 * Three passes, each small enough for ffmpeg to schedule reliably (one graph holding every shot
 * stalled at its first crossfade):
 *   1. each entry is rendered to its own clip, frame-exact, with its camera move, and with its
 *      incoming crossfade blended from the previous shot's tail (never more than two inputs);
 *   2. the entry clips are joined without re-encoding (concat demuxer);
 *   3. the title layer and the music, rendered on its own, go on top in the final encode.
 *
 * Usage: node scripts/trailer/assemble.mjs [--out=artifacts/trailer] [--crf=17]
 *   --preview          half size, fast encode, written as trailer-preview.mp4 (for checking a cut)
 *   --shots=DIR        read the clips from DIR instead of OUT/shots
 */
/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import {
    existsSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
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
const snap = (t) => Math.round(t * fps) / fps;
const toFrames = (t) => Math.round(t * fps);

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

/**
 * The perspective filter for a move spread over `frames` frames, or '' for none. `first` is the
 * index within the move of the first frame this filter sees (a shot's tail inside the next
 * entry's crossfade carries on its move from there).
 */
export function moveFilter(name, frames, first = 0) {
    if (!name) return '';
    const move = MOVES[name];
    if (!move) throw new Error(`unknown camera move ${name}`);
    const n = Math.max(1, frames - 1);
    const k = `min(1,(in+${first})/${n})`;
    // Smoothstep on the frame index: the move starts and settles gently.
    const p = `(${k}*${k}*(3-2*${k}))`;
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
    const result = spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    if (result.status !== 0) {
        console.error(`$ ${cmd} ${cmdArgs.join(' ')}`.slice(0, 2000));
        throw new Error(`${cmd} exited with ${result.status}`);
    }
}

/** One shot's frames [first, first + count) of its clip, sized, with its move: a filter chain. */
function shotChain(input, entry, first, count, label) {
    const clipFrame = toFrames(entry.in || 0) + first;
    return `[${input}:v]fps=${fps},trim=start_frame=${clipFrame}:end_frame=${clipFrame + count},`
        + `setpts=PTS-STARTPTS,scale=${width}:${height}:flags=lanczos,setsar=1`
        + `${moveFilter(entry.move, toFrames(entry.clipLength), first)},format=yuv420p,settb=1/${fps}[${label}]`;
}

/**
 * Pass 1: entry i covers the trailer from half its incoming crossfade before its cut to half the
 * next entry's after; a crossfade's frames belong to the entry it fades into.
 */
function renderEntry(plan, i, file) {
    const entry = plan[i];
    // Its own frames stop where the next entry's crossfade starts (those are the next entry's).
    const count = toFrames(entry.clipLength - entry.fadeOut);
    const shotFile = (e) => {
        const f = path.join(SHOTS, `${e.shot}.mp4`);
        if (!existsSync(f)) throw new Error(`missing shot ${e.shot} (${f}); run capture first`);
        return f;
    };
    const filters = [shotChain(0, entry, 0, count, 'b')];
    const inputs = ['-i', shotFile(entry)];
    let out = 'b';
    if (entry.fadeIn > 0) {
        // The previous shot's last frames, where they overlap this one, faded out under it.
        const previous = plan[i - 1];
        const fade = toFrames(entry.fadeIn);
        const tailFirst = toFrames(previous.clipLength) - fade;
        inputs.push('-i', shotFile(previous));
        filters.push(shotChain(1, previous, tailFirst, fade, 'a'));
        filters.push(`[a][b]xfade=transition=${entry.transition || 'fade'}:duration=${(fade / fps).toFixed(4)}:offset=0[x]`);
        out = 'x';
    }
    run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...inputs,
        '-filter_complex', filters.join(';'),
        '-map', `[${out}]`, '-frames:v', String(count),
        '-c:v', 'libx264', '-preset', PREVIEW ? 'ultrafast' : 'veryfast', '-crf', PREVIEW ? '18' : '10',
        '-pix_fmt', 'yuv420p', '-g', String(fps), '-r', String(fps), file,
    ]);
    return count;
}

/** The music edit: the cut list from the track, joined on downbeats with 20 ms fades, a tail fade. */
function renderMusic(target, duration) {
    const segs = TRAILER.music.segments;
    const filters = segs.map((seg, i) => {
        const len = seg.to - seg.from;
        return `[0:a]atrim=start=${seg.from}:end=${seg.to},asetpts=PTS-STARTPTS,`
            + `afade=t=in:d=0.02,afade=t=out:st=${(len - 0.02).toFixed(4)}:d=0.02[a${i}]`;
    });
    filters.push(`${segs.map((_, i) => `[a${i}]`).join('')}concat=n=${segs.length}:v=0:a=1,`
        + `atrim=duration=${duration.toFixed(4)},`
        + `afade=t=out:st=${(duration - TRAILER.music.fadeOut).toFixed(4)}:d=${TRAILER.music.fadeOut},`
        + 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]');
    run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', path.join(ROOT, TRAILER.music.file),
        '-filter_complex', filters.join(';'),
        '-map', '[aout]', '-c:a', 'pcm_s24le', target,
    ]);
}

function main() {
    const duration = TRAILER.duration;
    const total = toFrames(duration);
    const plan = planEdit(TRAILER.edit, duration);
    const work = path.join(OUT, PREVIEW ? 'cut-preview' : 'cut');
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });

    // Pass 1.
    let frames = 0;
    const list = plan.map((entry, i) => {
        const file = path.join(work, `${String(i).padStart(2, '0')}-${entry.shot}.mp4`);
        frames += renderEntry(plan, i, file);
        console.log(`cut ${i + 1}/${plan.length}: ${entry.shot}`);
        return `file '${file.replace(/'/g, "'\\''")}'`;
    });
    if (frames !== total) throw new Error(`the cut is ${frames} frames, the trailer ${total}`);

    // Pass 2.
    writeFileSync(path.join(work, 'list.txt'), `${list.join('\n')}\n`);
    const picture = path.join(work, 'picture.mp4');
    run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-c', 'copy', picture,
    ]);

    // Pass 3.
    const music = path.join(work, 'music-edit.wav');
    renderMusic(music, duration);
    const target = path.join(OUT, PREVIEW ? 'trailer-preview.mp4' : TRAILER.outputName);
    run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'warning', '-stats',
        '-i', picture,
        '-thread_queue_size', '512', '-framerate', String(fps), '-i', path.join(OUT, 'overlay', '%05d.png'),
        '-i', music,
        '-filter_complex',
        `[1:v]format=rgba,scale=${width}:${height}[ovl];[0:v][ovl]overlay=format=auto:eof_action=pass,format=yuv420p[vout]`,
        '-map', '[vout]', '-map', '2:a',
        '-c:v', 'libx264', '-preset', PREVIEW ? 'veryfast' : 'slow', '-crf', String(CRF), '-pix_fmt', 'yuv420p',
        '-profile:v', 'high', '-r', String(fps),
        '-c:a', 'aac', '-b:a', '256k',
        '-movflags', '+faststart',
        '-frames:v', String(total),
        target,
    ]);
    console.log(`trailer → ${path.relative(ROOT, target)} (${duration.toFixed(2)} s, ${width}×${height}, ${fps} fps)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
