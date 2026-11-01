"""Build yolo/{train,val,test} from src_images + labels_src + the 8 offline aug variants.

- Split is by GROUP of near-duplicate originals (burst shots of the same scene, dHash distance
  <= --group-thresh): a whole group, and every variant of its images, always lands in one split.
- train = originals + variants (+ oversampled copies of images with rare classes); val/test = originals only.
- Variant boxes are computed from the original labels using the per-variant CSV parameters
  (formulas verified against the images: rot = cv2 rotation about centre by +angle_deg_ccw,
  scale = s*x + offset, shift = x + dx, hflip = mirror, others = unchanged geometry).
- Images are resized so the long side is <= --max-side.

    python prepare_dataset.py                       # reuse split.json if present
    python prepare_dataset.py --resplit --seed 1    # new split
"""
import argparse, csv, json, math, random, shutil
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).parent
AUG = ROOT / "DataSetAgumen-merged" / "DataSetAgumen"
CLASSES = [c.strip() for c in (ROOT / "classes.txt").read_text(encoding="utf-8").split("\n") if c.strip()]
VARIANTS = ["blur", "bright20", "dark20", "hflip", "noise", "rot15", "scale", "shift"]
CSVS = {"rot15": "rotation_angles.csv", "scale": "scale_params.csv", "shift": "shift_offsets.csv"}


def read_labels(stem):
    p = ROOT / "labels_src" / f"{stem}.txt"
    return [(int(r[0]), *map(float, r[1:])) for r in (x.split() for x in p.read_text().splitlines()) if r]


def imread(p):
    return cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)


def imwrite(p, im):
    cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tofile(str(p))


def affine_for(variant, row, W, H):
    """2x3 matrix mapping original pixel coords -> variant pixel coords (None = identity)."""
    if variant == "hflip":
        return np.array([[-1, 0, W], [0, 1, 0]], float)
    if variant == "rot15":
        return cv2.getRotationMatrix2D((W / 2, H / 2), float(row["angle_deg_ccw"]), 1.0)
    if variant == "scale":
        s = float(row["scale"])
        return np.array([[s, 0, float(row["offset_x_px"])], [0, s, float(row["offset_y_px"])]])
    if variant == "shift":
        return np.array([[1, 0, float(row["dx_px(+right)"])], [0, 1, float(row["dy_px(+down)"])]])
    return None


def transform_boxes(labels, M, W, H, min_visible):
    if M is None:
        return labels
    out = []
    t = np.linspace(0, 2 * np.pi, 32, endpoint=False)
    for c, x, y, w, h in labels:
        cx, cy, bw, bh = x * W, y * H, w * W, h * H
        # rotate the inscribed ellipse instead of the corners: corners over-inflate rotated boxes
        pts = np.stack([cx + bw / 2 * np.cos(t), cy + bh / 2 * np.sin(t), np.ones_like(t)], 1) @ M.T
        x1, y1 = pts.min(0)
        x2, y2 = pts.max(0)
        full = (x2 - x1) * (y2 - y1)
        cx1, cy1, cx2, cy2 = max(x1, 0), max(y1, 0), min(x2, W), min(y2, H)
        if cx2 - cx1 < 4 or cy2 - cy1 < 4 or (cx2 - cx1) * (cy2 - cy1) < min_visible * full:
            continue
        out.append((c, (cx1 + cx2) / 2 / W, (cy1 + cy2) / 2 / H, (cx2 - cx1) / W, (cy2 - cy1) / H))
    return out


def dhash(p, n=16):
    im = cv2.cvtColor(imread(p), cv2.COLOR_BGR2GRAY)
    im = cv2.resize(im, (n + 1, n), interpolation=cv2.INTER_AREA)
    return (im[:, 1:] > im[:, :-1]).flatten()


def group_stems(stems, thresh):
    """Union originals whose dHash-256 distance is <= thresh (transitively), so a burst never straddles splits."""
    H = np.array([dhash(ROOT / "src_images" / f"{s}.jpg") for s in stems])
    D = (H[:, None] != H[None]).sum(-1)
    parent = list(range(len(stems)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j in zip(*np.nonzero(np.triu(D <= thresh, 1))):
        parent[find(i)] = find(j)
    groups = {}
    for i, s in enumerate(stems):
        groups.setdefault(find(i), []).append(s)
    return list(groups.values())


def make_split(groups, labels, ratios, seed, min_eval, tries=2000):
    stems = [s for g in groups for s in g]
    total = Counter(c for s in stems for c, *_ in labels[s])
    n_tr = len(stems) * ratios[0]
    n_va = len(stems) * ratios[1]
    rng = random.Random(seed)
    best, best_score = None, None
    for _ in range(tries):
        order = groups[:]
        rng.shuffle(order)
        sp, n = {"train": [], "val": [], "test": []}, 0
        for g in order:
            sp["train" if n < n_tr else "val" if n < n_tr + n_va else "test"] += g
            n += len(g)
        cnt = {k: Counter(c for s in v for c, *_ in labels[s]) for k, v in sp.items()}
        if any(cnt[k][c] < min_eval for k in ("val", "test") for c in range(len(CLASSES))):
            continue
        score = sum(abs(cnt[k][c] / total[c] - r) for k, r in zip(sp, ratios) for c in total) \
            + sum(abs(len(v) / len(stems) - r) for v, r in zip(sp.values(), ratios)) * len(total)
        if best_score is None or score < best_score:
            best, best_score = sp, score
    if best is None:
        raise SystemExit(f"no split with >= {min_eval} boxes per class in val/test; try another --seed")
    return {k: sorted(v) for k, v in best.items()}


def resize(im, max_side):
    h, w = im.shape[:2]
    s = max_side / max(h, w)
    return cv2.resize(im, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="yolo")
    ap.add_argument("--resplit", action="store_true")
    ap.add_argument("--ratios", type=float, nargs=3, default=[0.70, 0.20, 0.10])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-eval", type=int, default=3, help="min boxes per class in val and test")
    ap.add_argument("--group-thresh", type=int, default=20, help="dHash-256 distance that marks near-duplicates")
    ap.add_argument("--min-visible", type=float, default=0.4, help="drop aug boxes with less visible area")
    ap.add_argument("--max-side", type=int, default=1280)
    ap.add_argument("--max-repeat", type=int, default=3, help="oversample cap for rare-class train images")
    ap.add_argument("--repeat-thresh", type=float, default=0.6)
    a = ap.parse_args()

    stems = sorted(p.stem for p in (ROOT / "src_images").glob("*.jpg") if (ROOT / "labels_src" / f"{p.stem}.txt").exists())
    labels = {s: read_labels(s) for s in stems}

    split_path = ROOT / "split.json"
    if split_path.exists() and not a.resplit:
        split = json.loads(split_path.read_text())
        missing = set(stems) - {s for v in split.values() for s in v}
        if missing:
            raise SystemExit(f"{len(missing)} images not in split.json; run with --resplit")
    else:
        groups = group_stems(stems, a.group_thresh)
        print(f"{len(stems)} originals -> {len(groups)} near-duplicate groups (largest {max(map(len, groups))})")
        split = make_split(groups, labels, a.ratios, a.seed, a.min_eval)
        split_path.write_text(json.dumps(split, indent=1))

    params = {v: {r["source"].rsplit(".", 1)[0]: r for r in csv.DictReader(open(AUG / f"Data Set_{v}" / f, encoding="utf-8"))}
              for v, f in CSVS.items()}

    # repeat factor (LVIS-style) from the share of train images that contain each class
    tr = split["train"]
    frac = {c: sum(any(l[0] == c for l in labels[s]) for s in tr) / len(tr) for c in range(len(CLASSES))}
    def repeats(stem):
        r = max([math.sqrt(a.repeat_thresh / frac[c]) for c, *_ in labels[stem] if frac[c] > 0] or [1])
        return min(a.max_repeat, max(1, round(r)))

    out = ROOT / a.out
    if out.exists():
        shutil.rmtree(out)
    stats = {}
    for name, members in split.items():
        (out / name / "images").mkdir(parents=True)
        (out / name / "labels").mkdir(parents=True)
        n_img, boxes, dropped = 0, Counter(), 0

        def emit(fname, im, labs, copies=1):
            nonlocal n_img
            im = resize(im, a.max_side)
            for k in range(copies):
                f = fname if k == 0 else f"{fname}_rep{k}"
                imwrite(out / name / "images" / f"{f}.jpg", im)
                (out / name / "labels" / f"{f}.txt").write_text(
                    "".join(f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}\n" for c, x, y, w, h in labs))
                n_img += 1
                boxes.update(c for c, *_ in labs)

        for stem in members:
            src = imread(ROOT / "src_images" / f"{stem}.jpg")
            H, W = src.shape[:2]
            rep = repeats(stem) if name == "train" else 1
            emit(stem, src, labels[stem], rep)
            if name != "train":
                continue
            for v in VARIANTS:
                vp = AUG / f"Data Set_{v}" / f"{stem}_{v}.jpeg"
                if not vp.exists():
                    continue
                if v in CSVS and stem not in params[v]:
                    continue  # no parameters -> cannot place boxes
                im = imread(vp)
                assert im.shape[:2] == (H, W), f"{vp.name}: size {im.shape[:2]} != original {(H, W)}"
                M = affine_for(v, params[v][stem] if v in CSVS else None, W, H)
                labs = transform_boxes(labels[stem], M, W, H, a.min_visible)
                dropped += len(labels[stem]) - len(labs)
                emit(f"{stem}_{v}", im, labs, rep)
        stats[name] = (len(members), n_img, boxes, dropped)
        print(f"{name}: {len(members)} originals -> {n_img} images, {sum(boxes.values())} boxes"
              + (f", {dropped} aug boxes dropped (<{a.min_visible:.0%} visible)" if dropped else ""))

    print(f"\n{'class':<18}" + "".join(f"{k:>8}" for k in split))
    for i, c in enumerate(CLASSES):
        print(f"{c:<18}" + "".join(f"{stats[k][2][i]:>8}" for k in split))

    (ROOT / "data.yaml").write_text(
        f"path: {out.as_posix()}\ntrain: train/images\nval: val/images\ntest: test/images\n"
        f"names:\n" + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES)), encoding="utf-8")
    print(f"\nwrote {out} and data.yaml (split saved in {split_path.name})")


if __name__ == "__main__":
    main()
