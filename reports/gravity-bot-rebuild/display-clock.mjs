// Compare the local timer with the display-synchronous loop already used by
// Odyssey. Each clock gets its own real-game tape and both orders are played.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { constants, cpus, setPriority } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import electron from 'electron';

const [output, build, seatsArg = '4', hzArg = '165', durationArg = '120'] = process.argv.slice(2);
const seats = Number(seatsArg), hz = Number(hzArg), duration = Number(durationArg);
if (!output || !build || ![1,3,4].includes(seats) || ![60,165].includes(hz) || !Number.isInteger(duration) || duration < 60) {
    throw Error('Expected an output directory, packaged build, local bot count, Hz and duration in seconds');
}
const dir = resolve(output);
mkdirSync(dir, { recursive: true });
const project = fileURLToPath(new URL('../../', import.meta.url));
const manifest = createHash('sha256').update(readFileSync(join(build,'manifest.json'))).digest('hex');
const summary = join(dir,'summary.json');
if (existsSync(summary)) throw Error('A complete comparison already exists in ' + dir);
setPriority(0,constants.priority.PRIORITY_NORMAL);

function cpuTotals() {
    let idle = 0, total = 0;
    for (const cpu of cpus()) {
        idle += cpu.times.idle;
        total += Object.values(cpu.times).reduce((a,b) => a+b, 0);
    }
    return { idle, total };
}

async function record(clock, pass, replay) {
    const stem = join(dir,`${clock}-${pass}`);
    const file = stem + (replay ? '-replay' : '') + '.json';
    if (!existsSync(file)) {
        const env = { ...process.env, SERENITY_BOT_BUILD:resolve(build), SERENITY_BOT_CLOCK_TRIAL:clock };
        for (const key of ['ELECTRON_RUN_AS_NODE','SERENITY_BOT_CPU_PROFILE','SERENITY_BOT_TIERS','SERENITY_BOT_RIVAL_CONFIG']) delete env[key];
        const args = ['reports/gravity-bot-rebuild/rendered-match.cjs',file,seatsArg,durationArg,hzArg];
        if (replay) args.push(stem+'.json');
        const stdout = openSync(file+'.log','w'), stderr = openSync(file+'.err','w');
        const before = cpuTotals();
        try {
            await new Promise((ok,fail) => {
                const child = spawn(electron,args,{ cwd:project, env, windowsHide:true, stdio:['ignore',stdout,stderr] });
                child.once('error',fail);
                child.once('exit',code => code === 0 ? ok() : fail(Error('Capture exited '+code+' in '+file)));
            });
        } finally {
            closeSync(stdout);
            closeSync(stderr);
        }
        const after = cpuTotals();
        writeFileSync(file+'.host', String(1-(after.idle-before.idle)/(after.total-before.total)), { flag:'wx' });
    }
    const run = JSON.parse(readFileSync(file,'utf8'));
    if (run.buildManifestSha256 !== manifest || run.clockTrial !== clock || run.botCount !== seats || run.requestedHz !== hz
        || run.replay !== replay || run.checkFormat !== 'body-v1' || run.elapsed < duration*1000 || !run.clockStarts?.length
        || !run.sharedTexturePaints || run.runtime.mainPriority !== 0 || run.runtime.rendererPriority !== 0) {
        throw Error('Incomplete or mismatched capture ' + file);
    }
    return { run, busy:Number(readFileSync(file+'.host','utf8')) };
}

function compareBoards(a,b) {
    const key = row => row[0]+'/'+row[1];
    const right = new Map(b.checks.map(row => [key(row),row]));
    const shared = a.checks.filter(row => right.has(key(row)));
    if (!shared.length || shared.length < .95*Math.max(a.checks.length,b.checks.length)
        || shared.some(row => !isDeepStrictEqual(row,right.get(key(row))))) throw Error('Different labelled game state');
    return shared.length;
}

const rows = [];
for (const pass of [1,2]) {
    const games = [];
    for (const clock of pass === 1 ? ['timer','display'] : ['display','timer']) {
        const live = await record(clock,pass,false);
        const tape = await record(clock,pass,true);
        const cost = [...live.run.times].sort((a,b) => a-b);
        const q = p => cost[Math.ceil(cost.length*p)-1];
        const misses = run => run.stalls.length + run.nearTwoFrames.length;
        rows.push({ pass,clock,p95:q(.95),p99:q(.99),maximum:q(1),over:live.run.overBudget.length,
            liveMisses:misses(live.run),tapeMisses:misses(tape.run),excess:misses(live.run)-misses(tape.run),
            liveBusy:live.busy,tapeBusy:tape.busy,checks:compareBoards(live.run,tape.run),
            engaged:[live.run,tape.run].every(run => run.clockStarts.every(start => start.displaySynced === (clock === 'display'))) });
        games.push(live.run);
    }
    const count = Math.min(...games.map(run => run.inputs.length));
    if (!count || !isDeepStrictEqual(games[0].inputs.slice(0,count),games[1].inputs.slice(0,count))) {
        throw Error('Different real-game input sequence across presentation clocks');
    }
    for (const row of rows.filter(r => r.pass === pass)) {
        row.matchedInputs = count;
        row.matchedClockChecks = compareBoards(...games);
    }
}
const advance = [1,2].every(pass => {
    const timer = rows.find(r => r.pass === pass && r.clock === 'timer');
    const display = rows.find(r => r.pass === pass && r.clock === 'display');
    return display.engaged && timer.engaged && display.p95 <= (hz === 60 ? 2 : 1.5)+1e-6
        && display.p99 <= (hz === 60 ? 4 : 2.5)+1e-6 && !display.over
        && display.excess <= 0 && timer.excess-display.excess >= 5;
});
writeFileSync(summary,JSON.stringify({ manifest,seats,hz,duration,rows,advance }),{ flag:'wx' });
