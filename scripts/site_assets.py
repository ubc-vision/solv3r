"""Package Release data or assemble a Pages site. Uses only Python's stdlib.

python3 scripts/site_assets.py pack
python3 scripts/site_assets.py build --archive _release/website-assets.tar.gz
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ('dense', 'gallery', 'scenes', 'loops', 'play_video', 'videos')
# Removed from the gallery; retain local originals but do not ship them.
EXCLUDED = ('static/dense/building_stream', 'static/play_video/building.mp4')
CONFIG = ROOT / 'assets-release.json'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def media_path(name):
    p = PurePosixPath(name)
    return (not p.is_absolute() and '..' not in p.parts and
            (name == 'solv3r.pdf' or
             any(name.startswith(f'static/{directory}/') for directory in MEDIA)))


def pack(args):
    archive = ROOT / '_release/website-assets.tar.gz'
    archive.parent.mkdir(exist_ok=True)
    paths = [ROOT / 'solv3r.pdf']
    for directory in MEDIA:
        base = ROOT / 'static' / directory
        if not base.is_dir():
            raise ValueError(f'Missing local media: {base}')
        paths.extend(sorted(p for p in base.rglob('*') if p.is_file()))
    paths = [p for p in paths if not any(
        p.relative_to(ROOT).as_posix() == x or
        p.relative_to(ROOT).as_posix().startswith(x + '/') for x in EXCLUDED)]
    with tarfile.open(archive, 'w:gz', compresslevel=1) as tar:
        for p in paths:
            if p.is_symlink():
                raise ValueError(f'Media must be a regular file: {p}')
            tar.add(p, arcname=p.relative_to(ROOT).as_posix(), recursive=False)
    config = {'tag': args.tag, 'asset': archive.name, 'sha256': digest(archive)}
    CONFIG.write_text(json.dumps(config, indent=2) + '\n')
    print(f'Packaged {len(paths)} files: {archive} ({archive.stat().st_size / 2**20:.1f} MiB)')
    print(f'Updated {CONFIG.name}; publish this exact archive under tag {args.tag}.')


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in ('src', 'href', 'poster', 'data-base', 'data-src'):
                self.refs.append(value)
            elif value and key == 'data-frames':
                self.refs.extend(value.split(','))


def validate(site):
    parser = References()
    parser.feed((site / 'index.html').read_text())
    missing = []
    for value in parser.refs:
        url = urlsplit(value)
        if url.scheme or url.netloc or not url.path:
            continue
        name = unquote(url.path).lstrip('/')
        # Some widgets use data-src as a prefix for .json and .mp4.
        if not (site / name).exists() and not (site / (name + '.json')).exists():
            missing.append(name)
    for path in (site / 'static').rglob('*.json'):
        data = json.loads(path.read_text())
        def walk(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key == 'file' and isinstance(child, str) and not (path.parent / child).is_file():
                        missing.append(str((path.parent / child).relative_to(site)))
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(data)
    if missing:
        raise ValueError('Missing site assets: ' + ', '.join(sorted(set(missing))))
    if not (site / 'solv3r.pdf').is_file():
        raise ValueError('Paper PDF is missing')
    size = sum(p.stat().st_size for p in site.rglob('*') if p.is_file())
    if size >= 1_000_000_000:
        raise ValueError('Site exceeds the 1 GB Pages limit')
    print(f'Validated HTML references and JSON file references; site is {size / 2**20:.1f} MiB.')


def build(args):
    archive = Path(args.archive).resolve()
    site = ROOT / '_site'
    config = json.loads(CONFIG.read_text())
    if digest(archive) != config['sha256']:
        raise ValueError('Archive SHA-256 does not match assets-release.json')
    # The output location is fixed and ignored; never overwrite the source tree.
    if site.exists():
        if site.is_symlink():
            raise ValueError('_site must not be a symlink')
        shutil.rmtree(site)
    site.mkdir()
    for name in ('index.html', '.nojekyll'):
        shutil.copyfile(ROOT / name, site / name)
    for name in ('css', 'js', 'images'):
        shutil.copytree(ROOT / 'static' / name, site / 'static' / name)
    count = 0
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            if not member.isfile() or not media_path(member.name):
                raise ValueError(f'Unexpected archive member: {member.name}')
            dest = site / member.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as source, dest.open('wb') as target:
                shutil.copyfileobj(source, target)
            dest.chmod(0o644)
            count += 1
    validate(site)
    print(f'Assembled {count} Release files with website source in {site}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('pack', help='Package local data and pin its hash in the tracked config')
    p.add_argument('--tag', default='website-assets-v1')
    p.set_defaults(run=pack)
    p = commands.add_parser('build', help='Verify and combine a Release archive with source')
    p.add_argument('--archive', required=True)
    p.set_defaults(run=build)
    args = parser.parse_args()
    args.run(args)
