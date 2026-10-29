import fs from 'node:fs';
import { summarizeCell } from '../theme-fleet-bench-page.mjs';
const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const s = summarizeCell(c);
for (const k of ['load1', 'load2']) {
  const l = s[k]; if (!l) continue;
  const { topLoafs, ...rest } = l;
  console.log(k, JSON.stringify(rest));
  for (const lf of topLoafs || []) console.log('   loaf', lf.dur, 'ms', JSON.stringify(lf.scripts));
  const raw = c.phases[k];
  const pipes = (raw.pipelines);
  const p = c.phases[k];
  // pipelines timeline buckets
}
for (const k of ['rest', 'storm1', 'storm2']) {
  const w = s[k]; if (!w) continue;
  console.log(k, `fps ${w.fps} p50 ${w.p50} p95 ${w.p95} p99 ${w.p99} max ${w.max} busy ${w.busyP50}/${w.busyP95} gpu ${w.gpuMsEst} util ${w.gpuUtil?.util} limit ${w.limit} draws ${w.draws?.p50} pr ${w.pixelRatio} size ${w.canvasSize} cores ${JSON.stringify(w.procCores)} lt ${w.longTasks}`);
}
