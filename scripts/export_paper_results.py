"""Capture the Results assets from solv3r.pdf using Poppler's pdftoppm.

Run from any directory with: python3 scripts/export_paper_results.py
Crop rectangles are PDF points for the current paper layout; check them when
replacing the PDF with a version whose tables or figures have moved.
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DPI = 300
# name, one-based PDF page, left/top/right/bottom in PDF points
CROPS = [
    ('offline-table', 7, (56, 68, 557, 244)),
    ('streaming-table', 10, (56, 68, 557, 245)),
    ('streaming-tradeoff', 9, (62, 409, 293, 563)),
    ('relocalization-table', 8, (56, 507, 298, 606)),
]
output = ROOT / 'static/images/results'
output.mkdir(parents=True, exist_ok=True)
for name, page, (left, top, right, bottom) in CROPS:
    scale = DPI / 72
    subprocess.run([
        'pdftoppm', '-f', str(page), '-l', str(page), '-singlefile',
        '-r', str(DPI), '-x', str(round(left * scale)),
        '-y', str(round(top * scale)), '-W', str(round((right-left) * scale)),
        '-H', str(round((bottom-top) * scale)), '-png',
        str(ROOT / 'solv3r.pdf'), str(output / name),
    ], check=True)
    print(f'Exported {name}.png (paper page {page})')
