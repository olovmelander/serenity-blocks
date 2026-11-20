"""Compare the JavaScript Chromium parsed in measured matches across production builds.

The only normalization is a quoted reference to a JS filename present in that
build's Vite manifest. The referenced script keeps its source or chunk identity.
Pass the integration archive or individual rendered-match JSON recordings.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re


QUOTED_SCRIPT = re.compile(r'''(["'])(?P<directory>(?:\./|/)?(?:assets/)?)(?P<file>[^/"'\\\s?#]+\.js)\1''')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Build:
    def __init__(self, directory):
        self.directory = directory
        raw = (directory / 'manifest.json').read_bytes()
        self.digest = sha256(raw)
        identities = {}
        for entry in json.loads(raw).values():
            path = entry['file']
            if path.endswith('.js'):
                source = entry.get('src') or '__chunk__/' + entry['name']
                # Linked installations can include an adjacent worktree prefix.
                vendor = source.find('node_modules/')
                identities[path] = source[vendor:] if vendor >= 0 else source
        counts = Counter(identities.values())
        # Several leaf manifests can share a Rollup name. Their reference must
        # retain its exact filename until the individual identity is known.
        self.identities = {path: name if counts[name] == 1 else path for path, name in identities.items()}
        self.files = {name: path for path, name in self.identities.items()}
        self.by_filename = {Path(path).name: name for path, name in self.identities.items()}
        if len(self.by_filename) != len(self.identities):
            raise ValueError('Expected unique JavaScript filenames in the built game')

    def hashes(self, identity):
        raw = (self.directory / self.files[identity]).read_bytes()

        def reference(match):
            dependency = self.by_filename.get(match['file'])
            if dependency is None:
                return match[0]
            return match[1] + match['directory'] + '@{' + dependency + '}' + match[1]

        normalized = QUOTED_SCRIPT.sub(reference, raw.decode('utf8'))
        return sha256(raw), sha256(normalized.encode('utf8'))


def recordings(paths):
    for path in paths:
        if path.suffix == '.gz':
            with gzip.open(path, 'rt', encoding='utf8') as stream:
                yield from json.load(stream)['renderer'].items()
        else:
            yield path.stem, json.loads(path.read_bytes())


def compare(measured, candidate, runs):
    loaded = set()
    games = []
    for name, run in runs:
        if run['buildManifestSha256'] != measured.digest or not run['loadedScripts']:
            raise ValueError(f'{name} does not inventory scripts from the measured build')
        loaded.update(run['loadedScripts'])
        games.append(name)
    rows = []
    for path in sorted(loaded):
        identity = measured.identities[path]
        if identity not in candidate.files:
            rows.append({'id': identity, 'measured': path, 'status': 'missing'})
            continue
        before = measured.hashes(identity)
        after = candidate.hashes(identity)
        if before[0] == after[0]:
            status = 'identical'
        elif before[1] == after[1]:
            status = 'dependency filenames only'
        else:
            status = 'changed code'
        rows.append({'id': identity, 'measured': path, 'candidate': candidate.files[identity], 'status': status,
                     'rawSha256': [before[0], after[0]], 'normalizedSha256': [before[1], after[1]]})
    return {'measuredManifest': measured.digest, 'candidateManifest': candidate.digest, 'recordings': games, 'scripts': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('measured', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('recordings', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, help='Write the per-script SHA-256 comparisons')
    args = parser.parse_args()
    result = compare(Build(args.measured), Build(args.candidate), recordings(args.recordings))
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    counts = Counter(row['status'] for row in result['scripts'])
    print(f'{len(result["recordings"])} recordings, {len(result["scripts"])} parsed scripts:', dict(counts))
    for row in result['scripts']:
        if row['status'] in ('changed code', 'missing'):
            print(row['status'], row['id'])
    raise SystemExit(int(bool(counts['changed code'] or counts['missing'])))
