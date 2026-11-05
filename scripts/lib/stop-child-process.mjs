import { setTimeout as delay } from 'node:timers/promises';

/** Stop an owned direct child. Process-tree disposal belongs to the caller. */
export async function stopChildProcess(child, graceMs = 800) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await delay(graceMs);
    // `killed` only records successful signal delivery, not process termination.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
