"""Convert X-AnyLabeling JSON (labels_json/) to YOLO txt (labels_src/), class ids from classes.txt."""
import json
from pathlib import Path

ROOT = Path(__file__).parent
CLASSES = (ROOT / "classes.txt").read_text(encoding="utf-8").split("\n")
CLASSES = [c.strip() for c in CLASSES if c.strip()]
SRC, DST = ROOT / "labels_json", ROOT / "labels_src"
DST.mkdir(exist_ok=True)

unknown = {}
n_files = n_boxes = 0
for jp in sorted(SRC.glob("*.json")):
    d = json.loads(jp.read_text(encoding="utf-8"))
    W, H = d["imageWidth"], d["imageHeight"]
    lines = []
    for s in d["shapes"]:
        if s["label"] not in CLASSES:
            unknown[s["label"]] = unknown.get(s["label"], 0) + 1
            continue
        xs = [min(max(p[0], 0), W) for p in s["points"]]
        ys = [min(max(p[1], 0), H) for p in s["points"]]
        x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        lines.append(f"{CLASSES.index(s['label'])} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} "
                     f"{(x2 - x1) / W:.6f} {(y2 - y1) / H:.6f}")
    (DST / f"{jp.stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    n_files += 1
    n_boxes += len(lines)

print(f"{n_files} files, {n_boxes} boxes -> {DST}")
if unknown:
    print("UNKNOWN labels skipped:", unknown)
