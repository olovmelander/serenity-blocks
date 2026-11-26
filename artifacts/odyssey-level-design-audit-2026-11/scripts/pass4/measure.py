"""Rerun and score the 15-seed Odyssey audit of pass 4. Pass an output directory and optionally --run.

The benchmark plays the rival the game ships. The seven solo gates are those of passes 1-3; the two rival gates
are judged in levels from <directory>/rival-levels.json, which rival-levels.mjs and level-gates.mjs produce:

    node rival-levels.mjs <directory>/rival-levels.jsonl
    node level-gates.mjs <directory>/rival-levels.jsonl <directory>/rival-levels.json
"""
import argparse
import importlib.util
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('pass3_measure', HERE.parent / 'pass3' / 'measure.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def report(out, levels, groups):
    level_path = out / 'levels.json'
    level_path.write_text(json.dumps([levels[n] for n in sorted(levels)], ensure_ascii=False), encoding='utf-8')
    base.analyze('static.py', level_path)
    base.write_rates(out, levels, groups)
    rivals = out / 'rival-levels.json'
    for label, seeds in [(str(s), range(s, s + 5)) for s in base.BLOCKS] + [('all15', sorted(base.SEEDS))]:
        raw, joined = out / f'{label}.jsonl', out / f'{label}-final.json'
        with raw.open('w', encoding='utf-8') as dest:
            for orb in sorted(levels):
                for p, c in base.GATES:
                    for seed in seeds:
                        dest.write(json.dumps(groups[orb, p, c][seed]) + '\n')
        base.analyze('final.py', level_path, out / 'static.json', raw, joined)
        # The rival gates need the 60-seed level run; a five-seed block is scored on the solo gates alone.
        extra = [rivals] if label == 'all15' and rivals.exists() else []
        verdict = subprocess.check_output(
            [sys.executable, '-I', '-X', 'utf8', str(HERE / 'gates_p4.py'), str(level_path), str(joined),
             *map(str, extra)], encoding='utf-8')
        (out / f'{label}-gates.txt').write_text(verdict, encoding='utf-8')
        print(f'{label}  {verdict.splitlines()[-1]}', flush=True)
        if label == 'all15':
            expected = '9 of 9 gates pass' if extra else '7 of 7 gates pass'
            if not verdict.rstrip().endswith(expected):
                raise SystemExit(verdict)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--run', action='store_true', help='run or resume the real gameplay benchmarks first')
    parser.add_argument('--jobs', type=int, default=2, help='simultaneous benchmark processes')
    parser.add_argument('--workers', type=int, default=2, help='simulation workers per benchmark process')
    args = parser.parse_args()
    output = args.directory.resolve()
    if args.run:
        output.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            list(pool.map(lambda job: base.run_job(job, output, args.workers), base.jobs(None)))
    levels, groups, _ = base.read_jobs(output)
    report(output, levels, groups)
