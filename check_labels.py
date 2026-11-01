"""Sanity-check labels_src against src_images: missing/empty files, tiny or odd boxes, per-class counts."""
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent
CLASSES = [c.strip() for c in (ROOT / "classes.txt").read_text(encoding="utf-8").split("\n") if c.strip()]
imgs = {p.stem for p in (ROOT / "src_images").glob("*.jpg")}
labs = {p.stem: p for p in (ROOT / "labels_src").glob("*.txt")}

boxes, images_with = Counter(), Counter()
problems = []
for stem in sorted(imgs - labs.keys()):
    problems.append(f"{stem}: no label file")
for stem in sorted(labs.keys() - imgs):
    problems.append(f"{stem}: label without image")
for stem in sorted(imgs & labs.keys()):
    rows = [r.split() for r in labs[stem].read_text().splitlines() if r.strip()]
    if not rows:
        problems.append(f"{stem}: empty (no boxes)")
    seen = set()
    for r in rows:
        c, x, y, w, h = int(r[0]), *map(float, r[1:])
        boxes[c] += 1
        seen.add(c)
        if w * h < 1e-4:
            problems.append(f"{stem}: tiny {CLASSES[c]} box ({w:.4f}x{h:.4f})")
        if w > 0.95 and h > 0.95:
            problems.append(f"{stem}: {CLASSES[c]} box covers whole image")
    for c in seen:
        images_with[c] += 1
    dup = Counter(tuple(r) for r in rows)
    if any(v > 1 for v in dup.values()):
        problems.append(f"{stem}: duplicate boxes")

print(f"images {len(imgs)}, label files {len(labs)}\n")
print(f"{'id':>2}  {'class':<18}{'boxes':>7}{'images':>8}")
for i, c in enumerate(CLASSES):
    flag = "  <-- none!" if boxes[i] == 0 else ("  <-- few" if boxes[i] < 30 else "")
    print(f"{i:>2}  {c:<18}{boxes[i]:>7}{images_with[i]:>8}{flag}")
print(f"\n{len(problems)} problem(s)")
for p in problems:
    print("  " + p)
