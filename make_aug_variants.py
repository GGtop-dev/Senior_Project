"""Create the 8 offline aug variants for originals in Data Set/ that don't have them yet.

Same recipe as the existing variants (reverse-engineered from them):
  hflip     mirror left-right
  bright20  x * 1.2
  dark20    x * 0.8, then contrast 1.1 around the mean
  rot15     rotate about image centre by U(-15, 15) deg ccw, border = replicate
  shift     translate by dx, dy (up to ~14% of width / height), person kept inside the frame
  scale     scale U(0.9, 1.15) about the person centre, person kept inside the frame
  blur      Gaussian blur, sigma U(1.8, 5.1) px
  noise     Gaussian noise (luminance, same on all channels), sigma U(4.5, 8.5)
Variants are upright (EXIF applied), same size as src_images/, no EXIF.
rot15 / scale / shift / blur parameters are appended to the CSVs that prepare_dataset.py reads.
Person box comes from yolov8n.pt (COCO class 0); falls back to the centre 60% of the image.

    .venv\\Scripts\\python make_aug_variants.py
"""
import csv, random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).parent
AUG = ROOT / "DataSetAgumen-merged" / "DataSetAgumen"
SRC = AUG / "Data Set"
VARIANTS = ["blur", "bright20", "dark20", "hflip", "noise", "rot15", "scale", "shift"]
CSVS = {
    "rot15": ("rotation_angles.csv", ["source", "output", "angle_deg_ccw", "width", "height"]),
    "scale": ("scale_params.csv", ["source", "output", "scale", "offset_x_px", "offset_y_px", "note"]),
    "shift": ("shift_offsets.csv", ["source", "output", "dx_px(+right)", "dy_px(+down)", "note"]),
    "blur": ("blur_sigma.csv", ["source", "output", "gaussian_sigma_px"]),
}
MARGIN = 0.02  # person box must stay this far inside the frame


def load_upright(p):
    with Image.open(p) as im:
        return cv2.cvtColor(np.asarray(ImageOps.exif_transpose(im).convert("RGB")), cv2.COLOR_RGB2BGR)


def imwrite(p, im):
    cv2.imencode(".jpeg", im, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(str(p))


def clip8(x):
    return np.clip(x, 0, 255).astype(np.uint8)


def person_box(model, im):
    """Union of person boxes in normalised xyxy, or the centre 60% if none found."""
    r = model(im, imgsz=640, classes=[0], conf=0.3, verbose=False)[0]
    b = r.boxes.xyxyn.cpu().numpy()
    if len(b) == 0:
        return np.array([0.2, 0.2, 0.8, 0.8]), False
    return np.array([b[:, 0].min(), b[:, 1].min(), b[:, 2].max(), b[:, 3].max()]), True


def inside(box):
    return box[0] >= MARGIN and box[1] >= MARGIN and box[2] <= 1 - MARGIN and box[3] <= 1 - MARGIN


def pick_shift(rng, box, W, H):
    for _ in range(200):
        dx, dy = rng.randint(-int(0.14 * W), int(0.14 * W)), rng.randint(-int(0.14 * H), int(0.14 * H))
        nb = box + np.array([dx / W, dy / H, dx / W, dy / H])
        if inside(nb):
            return dx, dy, nb
    return 0, 0, box


def pick_scale(rng, box, W, H):
    cx, cy = (box[0] + box[2]) / 2 * W, (box[1] + box[3]) / 2 * H
    for _ in range(200):
        s = round(rng.uniform(0.9, 1.15), 3)
        ox, oy = round((1 - s) * cx), round((1 - s) * cy)
        nb = box * s + np.array([ox / W, oy / H, ox / W, oy / H])
        if inside(nb) or s < 1:
            return s, ox, oy, nb
    return 1.0, 0, 0, box


def fmt(nb):
    return "person bbox after [" + ", ".join(f"{v:.3g}" for v in nb) + "] inside=" + str(bool(inside(nb)))


def main():
    from ultralytics import YOLO
    model = YOLO(str(ROOT / "yolov8n.pt"))
    rng = random.Random(20261020)
    nrng = np.random.default_rng(20261020)

    todo = [p for p in sorted(SRC.iterdir()) if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
            and not all((AUG / f"Data Set_{v}" / f"{p.stem}_{v}.jpeg").exists() for v in VARIANTS)]
    print(f"{len(todo)} originals need variants")
    files = {}
    for v, (name, cols) in CSVS.items():
        f = open(AUG / f"Data Set_{v}" / name, "a", newline="", encoding="utf-8")
        files[v] = (f, csv.DictWriter(f, cols))
    no_person = 0
    try:
        for i, p in enumerate(todo, 1):
            im = load_upright(p)
            H, W = im.shape[:2]
            f32 = im.astype(np.float32)
            box, found = person_box(model, im)
            no_person += not found
            src, out = p.name, lambda v: f"{p.stem}_{v}.jpeg"
            rows = {}

            ang = round(rng.uniform(-15, 15), 1)
            dx, dy, nb_sh = pick_shift(rng, box, W, H)
            s, ox, oy, nb_sc = pick_scale(rng, box, W, H)
            sigma = round(rng.uniform(1.8, 5.1), 2)
            nsig = rng.uniform(4.5, 8.5)
            dark = f32 * 0.8
            dark = (dark - dark.mean()) * 1.1 + dark.mean()
            noise = nrng.normal(0, nsig, (H, W, 1)).astype(np.float32)
            rep = dict(borderMode=cv2.BORDER_REPLICATE)

            img = {
                "hflip": im[:, ::-1],
                "bright20": clip8(f32 * 1.2),
                "dark20": clip8(dark),
                "rot15": cv2.warpAffine(im, cv2.getRotationMatrix2D((W / 2, H / 2), ang, 1.0), (W, H), **rep),
                "shift": cv2.warpAffine(im, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H), **rep),
                "scale": cv2.warpAffine(im, np.float32([[s, 0, ox], [0, s, oy]]), (W, H), **rep),
                "blur": cv2.GaussianBlur(im, (0, 0), sigma),
                "noise": clip8(f32 + noise),
            }
            rows["rot15"] = dict(source=src, output=out("rot15"), angle_deg_ccw=ang, width=W, height=H)
            rows["shift"] = {"source": src, "output": out("shift"), "dx_px(+right)": dx, "dy_px(+down)": dy, "note": fmt(nb_sh)}
            rows["scale"] = dict(source=src, output=out("scale"), scale=s, offset_x_px=ox, offset_y_px=oy, note=fmt(nb_sc))
            rows["blur"] = dict(source=src, output=out("blur"), gaussian_sigma_px=sigma)

            for v in VARIANTS:
                op = AUG / f"Data Set_{v}" / out(v)
                if not op.exists():
                    imwrite(op, img[v])
                    if v in rows:
                        files[v][1].writerow(rows[v])
            for f, _ in files.values():
                f.flush()
            print(f"[{i}/{len(todo)}] {p.stem}" + ("" if found else "  (no person found)"), flush=True)
    finally:
        for f, _ in files.values():
            f.close()
    print(f"done; {no_person} images without a detected person (used centre box)")


if __name__ == "__main__":
    main()
