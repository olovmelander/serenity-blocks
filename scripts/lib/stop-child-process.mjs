import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Only children created here own a process group. An arbitrary ChildProcess must
// never cause signaling of the caller's group or an unrelated negative PID.
const ownedGroups = new WeakMap();

/** Preserve the command/runtime while giving POSIX wrapper descendants one owner. */
export function spawnOwnedProcess(command, args, options = {}) {
    const ownsGroup = process.platform !== 'win32';
    const child = spawn(command, args, { ...options, ...(ownsGroup ? { detached: true } : {}) });
    if (ownsGroup && child.pid) ownedGroups.set(child, { stopPromise: null });
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
            if (!signalGroup(child, 'SIGTERM')) return;
            await delay(graceMs);
            signalGroup(child, 'SIGKILL');
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
