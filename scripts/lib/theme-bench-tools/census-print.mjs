import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const r = c.phases?.evalAfterLoad;
  if (!r || r.error) { console.log(c.themeId, 'no census', c.error, r?.error); continue; }
  console.log(`== ${r.theme}${r.storm ? ' (storm)' : ''}: frame ${r.baseMs} ms (${(1000 / r.baseMs).toFixed(0)} fps), empty scene ${r.emptySceneMs} ms, end ${r.endMs} ms`);
  for (const row of r.rows.filter((x) => (x.savedMs ?? 0) > 0.06).slice(0, 14)) console.log(`   ${String(row.savedMs).padStart(6)} ms  ${'  '.repeat(row.depth)}${row.name} (${row.kids} kids)`);
}
