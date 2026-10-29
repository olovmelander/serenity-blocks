import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const r = c.phases?.evalAfterLoad;
  if (!r || r.error) { console.log(c.themeId, 'no passes', c.error, r?.error); continue; }
  console.log(`== ${r.theme}: GPU ${r.totalGpuMs} ms/frame over ${r.frames} frames (theme renderer only, 60 fps)`);
  for (const x of r.rows.filter((y) => y.msPerFrame >= 0.02).slice(0, 14)) console.log(`   ${String(x.msPerFrame).padStart(6)} ms  x${x.passesPerFrame}  ${x.pass}`);
}
