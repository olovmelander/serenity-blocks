// Cost census, run by the bench's evalAfterLoad: hide each part of the live theme's scene in turn
// and measure the frame time it saves (uncapped, so ms saved = what the part costs per frame).
(async () => {
  const B = window.__BENCH__;
  const tm = window.serenityBlocks.themeManager;
  const th = tm.activeTheme;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frameMs = async (ms = 1400) => {
    B.reset(); B.rec = true; await sleep(ms); B.rec = false;
    const t = B.frameTimes;
    if (t.length < 3) return null;
    const iv = []; for (let i = 1; i < t.length; i += 1) iv.push(t[i] - t[i - 1]);
    iv.sort((a, b) => a - b);
    return { mean: (t[t.length - 1] - t[0]) / (t.length - 1), p50: iv[Math.floor(iv.length / 2)] };
  };
  const label = (o, path) => `${path}${o.name || o.type}${o.isMesh || o.isInstancedMesh ? `[${o.isInstancedMesh ? `inst ${o.count}` : 'mesh'}]` : ''}`;
  const scene = th.scene;
  if (!scene) return { error: 'no scene' };
  // Storm mode: keep effects firing through every measurement (window.__CENSUS_STORM set by the variant).
  let stormTimer = null;
  if (window.__CENSUS_STORM) {
    const E = window.__serenityGameplayEvents;
    const piece = { type: 'T', shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 18 };
    const rows = (n) => Array.from({ length: n }, (_, i) => 19 - i);
    let k = 0; let level = 2;
    const seq = [
      () => E.emitPieceLock({ piece }),
      () => { E.emitHardDrop({ piece, startY: 0, endY: 18, distance: 18 }); E.emitPieceLock({ piece }); E.emitLineClear({ lineCount: 1, clearedRows: rows(1) }); },
      () => { E.emitTSpin({ lineCount: 2 }); E.emitLineClear({ lineCount: 2, clearedRows: rows(2), comboCount: 2 }); E.emitCombo({ comboCount: 2 }); E.emitB2B({ active: true }); },
      () => { E.emitHardDrop({ piece, startY: 0, endY: 18, distance: 18 }); E.emitLineClear({ lineCount: 4, clearedRows: rows(4), comboCount: 4 }); E.emitCombo({ comboCount: 4 }); },
      () => { E.emitLineClear({ lineCount: 4, clearedRows: rows(4), comboCount: 5 }); E.emitPerfectClear({ depth: 4, perfectClearBonus: 3000 }); },
      () => E.emitLevelUp({ level: level++ }),
    ];
    stormTimer = setInterval(() => { try { seq[k++ % seq.length](); } catch (_) {} }, 350);
  }
  await sleep(500);
  const base = await frameMs(2500);
  const rows = [];
  let budget = 46;
  const visit = async (node, path, depth) => {
    const kids = node.children.filter((c) => c.visible && !c.isLight && !c.isCamera);
    for (const k of kids) {
      if (budget <= 0) return;
      budget -= 1;
      k.visible = false;
      await sleep(250);
      const f = await frameMs();
      k.visible = true;
      await sleep(150);
      const saved = f ? base.mean - f.mean : null;
      const name = label(k, path);
      rows.push({ name, depth, savedMs: saved === null ? null : +saved.toFixed(3), kids: k.children.length });
      // Look inside groups that cost a lot.
      if (depth < 3 && k.children.length > 1 && saved !== null && saved > 0.12) {
        await visit(k, `${name}/`, depth + 1);
      }
    }
  };
  await visit(scene, '', 0);
  // Everything hidden: what the post chain, clears and the rest cost on their own.
  const hidden = scene.children.filter((c) => c.visible && !c.isLight && !c.isCamera);
  hidden.forEach((c) => { c.visible = false; });
  await sleep(300);
  const empty = await frameMs(2000);
  hidden.forEach((c) => { c.visible = true; });
  const end = await frameMs(1500);
  if (stormTimer) clearInterval(stormTimer);
  return {
    theme: th.name, storm: !!window.__CENSUS_STORM,
    baseMs: +base.mean.toFixed(3), baseP50: +base.p50.toFixed(3),
    emptySceneMs: empty ? +empty.mean.toFixed(3) : null,
    endMs: end ? +end.mean.toFixed(3) : null,
    rows: rows.sort((a, b) => (b.savedMs ?? -1) - (a.savedMs ?? -1)),
  };
})()
