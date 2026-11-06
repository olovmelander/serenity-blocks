import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Only children created here own a process group. An arbitrary ChildProcess must
// never cause signaling of the caller's group or an unrelated negative PID.
const ownedGroups = new WeakMap();

// Owned groups not yet stopped. `detached` also moves a group out of the terminal's
// session, so Ctrl+C or a closed terminal no longer reaches its server by itself:
// forward those, and an ordinary exit, to every group this process still owns.
const liveGroups = new Set();
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
let exitHooksInstalled = false;

function terminateLiveGroups() {
    for (const child of liveGroups) {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch { /* already gone */ }
    }
}

function forwardSignal(signal) {
    terminateLiveGroups();
    // A caller with its own handler decides what the signal means for it.
    if (process.listenerCount(signal) > 1) return;
    // Otherwise keep the default: the process still ends by this signal.
    for (const name of FORWARDED_SIGNALS) process.removeListener(name, forwardSignal);
    process.kill(process.pid, signal);
}

function installExitHooks() {
    if (exitHooksInstalled) return;
    exitHooksInstalled = true;
    process.on('exit', terminateLiveGroups);
    for (const signal of FORWARDED_SIGNALS) process.on(signal, forwardSignal);
}

/** Preserve the command/runtime while giving POSIX wrapper descendants one owner. */
export function spawnOwnedProcess(command, args, options = {}) {
    const ownsGroup = process.platform !== 'win32';
    const child = spawn(command, args, { ...options, ...(ownsGroup ? { detached: true } : {}) });
    if (ownsGroup && child.pid) {
        ownedGroups.set(child, { stopPromise: null });
        liveGroups.add(child);
        installExitHooks();
    }
    return child;
}

function signalGroup(child, signal) {
    try {
        process.kill(-child.pid, signal);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

/** Stop a direct child, or its explicitly owned POSIX group (even after wrapper exit). */
export async function stopChildProcess(child, graceMs = 800) {
    if (!child?.pid) return;
    const group = ownedGroups.get(child);
    if (group) {
        // Keep the settled promise too: repeat cleanup must not reuse an old group ID.
        group.stopPromise ??= Promise.resolve().then(async () => {
            try {
                if (!signalGroup(child, 'SIGTERM')) return;
                await delay(graceMs);
                signalGroup(child, 'SIGKILL');
            } finally {
                liveGroups.delete(child);
            }
        });
        await group.stopPromise;
        return;
    }
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await delay(graceMs);
    // `killed` only records successful signal delivery, not process termination.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
