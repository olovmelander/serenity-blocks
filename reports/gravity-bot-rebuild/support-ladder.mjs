// Run complete native seven-frag series in both seats. The smaller finishes
// use the exact same rounds and scoring decisions.
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocalMatchEnd } from '../../src/core/game-modes/local-match-rules.js';

const [previousPath, output, first = '89801', count = '100', workers = '6', designFile] = process.argv.slice(2);
if (!previousPath || !output) throw Error('Pass BASELINE OUTPUT.jsonl [FIRST_BAG BAG_COUNT WORKERS_PER_VERSION]');
if (![first, count, workers].every((n) => Number.isSafeInteger(+n) && +n > 0)) {
    throw Error('Bag, count and workers must be positive integers');
}
const candidatePath = fileURLToPath(new URL('../../', import.meta.url));
const previous = resolve(previousPath);
const design = designFile && JSON.parse(readFileSync(designFile, 'utf8'));
const key = ({
    version, tier, seed, swap,
}) => [version, tier, seed, swap].join('/');
const done = new Map((existsSync(output) ? readFileSync(output, 'utf8').trim() : '').split('\n')
    .filter(Boolean).map((line) => { const record = JSON.parse(line); return [key(record), record]; }));
const children = new Set();
setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);

function finishes(row) {
    const frags = [0, 0];
    let three;
    let seven;
    const rounds = row.rounds.map((round, i) => {
        if (seven !== undefined) throw Error('Round after end of series');
        const {
            tiers, lost, attackers, ticksPlayed,
        } = round;
        for (let seat = 0; seat < 2; seat++) {
            if (lost[seat] && attackers[seat] === 1 - seat) frags[1 - seat]++;
        }
        const winnerAt = (target) => {
            const winner = resolveLocalMatchEnd(
                { endCondition: 'frags', endConditionValue: target },
                frags.map((n, seat) => ({ result: seat, frags: n })),
                0,
            );
            if (winner === 'draw') return null;
            if (winner !== null) return tiers[winner];
            if (!lost.some(Boolean) || i + 1 === target * 5) return null;
            return undefined;
        };
        if (three === undefined) three = winnerAt(3);
        seven = winnerAt(7);
        return [ticksPlayed, lost.map(Number).join(''), attackers];
    });
    if (three === undefined || seven !== row.winner || frags.some((n, i) => n !== row.frags[i])) {
        throw Error('Frag adjudication disagrees with live match');
    }
    const firstRound = row.rounds[0];
    return {
        firstKO: firstRound.ticksPlayed <= 9000 ? firstRound.winner : null,
        three,
        seven,
        censored: row.censored ?? null,
        rounds,
    };
}

async function panel(version, directory, supportFit) {
    const hash = createHash('sha256');
    for (const file of ['src/core/ai/gravity-bot-controller.js', 'src/core/ai/gravity-search.js',
        'src/core/ai/local-bot-manager.js']) {
        hash.update(readFileSync(resolve(directory, file)));
    }
    if (supportFit) hash.update(JSON.stringify(supportFit));
    const policy = hash.digest('hex');
    const fingerprint = (file) => createHash('sha256')
        .update(readFileSync(resolve(directory, file), 'utf8').replaceAll('\r\n', '\n')).digest('hex');
    const reachability = fingerprint('src/core/stillfall/stillfall-reach.js');
    const blind = fingerprint('src/core/blind.js');
    const sourceReference = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    const tasks = [];
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        for (const tier of design?.comparisons?.[version] ?? design?.tiers ?? [9, 8, 7, 6]) {
            for (const swap of [false, true]) {
                const task = {
                    version, tier, seed, swap, mode: 'frags', limit: 600, fragTarget: 7, displayHz: 165, supportFit,
                };
                const record = done.get(key(task));
                if (record && (record.policy !== policy || record.reachability !== reachability || record.blind !== blind)) {
                    throw Error('Saved row has missing or different source fingerprints. Start a fresh output file.');
                }
                if (!record) tasks.push(task);
            }
        }
    }
    let next = 0;
    const worker = async () => {
        if (next >= tasks.length) return;
        const child = fork(resolve(directory, 'reports/gravity-bot-rebuild/validation.mjs'), [], {
            cwd: directory, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        children.add(child);
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
        await new Promise((accept, reject) => {
            let current;
            const send = () => {
                if (next === tasks.length) { accept(); return; }
                current = tasks[next++];
                child.send({ id: key(current), task: current });
            };
            child.once('error', reject);
            child.once('exit', (code) => reject(Error(`Worker exited ${code}`)));
            child.on('message', (message) => {
                try {
                    if (message.error || message.id !== key(current)) throw Error(message.error || 'Different task');
                    const { tier, seed, swap } = current;
                    appendFileSync(output, `${JSON.stringify({
                        version,
                        policy,
                        reachability,
                        blind,
                        sourceReference,
                        tier,
                        seed,
                        swap,
                        ...finishes(message.result),
                    })}\n`);
                    send();
                } catch (error) { reject(error); }
            });
            send();
        });
        child.kill();
        children.delete(child);
    };
    await Promise.all(Array.from({ length: Number(workers) }, worker));
}

try {
    const variants = design?.variants ?? { previous: null, candidate: null };
    await Promise.all(Object.entries(variants).map(([name, fit]) => {
        const directory = name === 'previous' ? previous : candidatePath;
        return panel(name, directory, fit);
    }));
} finally {
    for (const child of children) child.kill();
}
