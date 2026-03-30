export const DEVTOOLS_SHORTCUT_DEDUP_WINDOW_MS = 150;

export function createDevToolsShortcutState() {
  return {
    lastIntent: null,
    lastAt: 0,
  };
}

export function getDevToolsShortcutIntent(input = {}) {
  const inputType = typeof input?.type === 'string' ? input.type : '';
  if (inputType !== 'keyDown' && inputType !== 'rawKeyDown') {
    return null;
  }

  const normalizedKey = typeof input?.key === 'string' ? input.key.toLowerCase() : '';
  const normalizedCode = typeof input?.code === 'string' ? input.code.toLowerCase() : '';
  const hasCommandOrControl = Boolean(input?.control || input?.meta);
  const hasShift = Boolean(input?.shift);

  if (normalizedKey === 'f12' || normalizedCode === 'f12') {
    return 'toggle-devtools';
  }

  if (
    hasCommandOrControl
    && hasShift
    && (normalizedKey === 'i' || normalizedCode === 'keyi')
  ) {
    return 'toggle-devtools';
  }

  if (normalizedKey === 'f5' || normalizedCode === 'f5') {
    return 'reload-window';
  }

  return null;
}

export function isDuplicateDevToolsShortcut(
  state,
  intent,
  now = Date.now(),
  dedupWindowMs = DEVTOOLS_SHORTCUT_DEDUP_WINDOW_MS,
) {
  const safeState = state || createDevToolsShortcutState();
  const isDuplicate = safeState.lastIntent === intent
    && (now - safeState.lastAt) <= dedupWindowMs;

  safeState.lastIntent = intent;
  safeState.lastAt = now;

  return isDuplicate;
}
