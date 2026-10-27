import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const seen = new Map();
for (const l of c.console || []) {
  const ph = l.match(/^\[([\d.]+)s (\S+)\] (.*)$/s);
  const key = (ph ? ph[2] : '?') + ' ' + (ph ? ph[3] : l).replace(/\s+/g, ' ').slice(0, 110);
  const cur = seen.get(key) || { n: 0, first: ph ? ph[1] : '?' };
  cur.n += 1; seen.set(key, cur);
}
for (const [k, v] of seen) console.log(v.n, '@' + v.first + 's', k);
