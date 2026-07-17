(() => {
  const A = window.__audit = {
    listeners: {}, listenersTotal: 0,
    intervalsActive: new Set(), timeoutsActive: new Set(),
    rafCalls: 0, audioContexts: 0, contexts: { webgl: 0, webgpu: 0 },
    intervalsById: {},
  };
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    A.listeners[type] = (A.listeners[type] || 0) + 1; A.listenersTotal++;
    return origAdd.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (A.listeners[type]) { A.listeners[type]--; A.listenersTotal--; }
    return origRemove.call(this, type, fn, opts);
  };
  const oSI = window.setInterval, oCI = window.clearInterval;
  window.setInterval = function (...args) { const id = oSI.apply(window, args); A.intervalsActive.add(id); try { A.intervalsById[id] = String(args[0]).slice(0, 80) + ' @' + (args[1] ?? ''); } catch (e) {} return id; };
  window.clearInterval = function (id) { A.intervalsActive.delete(id); delete A.intervalsById[id]; return oCI.call(window, id); };
  const oRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) { A.rafCalls++; return oRAF.call(window, fn); };
  const OAC = window.AudioContext;
  if (OAC) window.AudioContext = class extends OAC { constructor(...a) { super(...a); A.audioContexts++; } };
  const oGC = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = oGC.call(this, kind, ...rest);
    if (ctx && /webgl/.test(kind) && !this.__auditCounted) { this.__auditCounted = true; A.contexts.webgl++; }
    return ctx;
  };
})()