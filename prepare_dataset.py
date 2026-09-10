"""Write a YOLOv11 data.yaml for the pre-split dataset (train 80% / test 20%).

Dataset/ is already split into train/ and test/ (see the "แบ่ง Dataset train,test"
commit), so this script no longer re-splits anything. It only:
  * checks the train/ and test/ image+label folders exist and line up,
  * warns about label rows whose class id is outside 0..nc-1,
  * (re)writes Dataset/data.yaml with an absolute path and val -> test.

The original Dataset/ files are never modified except data.yaml itself.
This data.yaml format is shared by YOLOv8 and YOLOv11 (ultralytics), so no
other changes were needed here when moving from v8 to v11.

Usage:
    python prepare_dataset.py
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "Dataset"
DATA_YAML = DATASET / "data.yaml"

# Class names (index = class id). Matches Dataset/data.yaml.
NAMES = ["Gloves", "Helmet", "Mask", "Protective apron", "Safety Shoes", "Sleeve"]
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "test")


def check_split(name: str) -> int:
    img_dir = DATASET / name / "images"
    lbl_dir = DATASET / name / "labels"
    if not img_dir.is_dir() or not lbl_dir.is_dir():
        raise SystemExit(f"missing {img_dir} or {lbl_dir}")

    images = [p for p in sorted(img_dir.iterdir()) if p.suffix.lower() in IMG_EXTS]
    if not images:
        raise SystemExit(f"no images in {img_dir}")

    for img in images:
        lbl = lbl_dir / f"{img.stem}.txt"
        if not lbl.exists():
            print(f"[warn] {name}: no label for {img.name}")
            continue
        for i, line in enumerate(lbl.read_text().splitlines(), 1):
            parts = line.split()
            if not parts:
                continue
            cid = int(parts[0])
            if not 0 <= cid < len(NAMES):
                print(f"[warn] {lbl.name}:{i} class id {cid} outside 0..{len(NAMES) - 1}")
    return len(images)


def main():
    argparse.ArgumentParser(description=__doc__,
                            formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()

    counts = {s: check_split(s) for s in SPLITS}
    total = sum(counts.values())
    for s in SPLITS:
        print(f"{s:5s}: {counts[s]:4d} images ({counts[s] / total * 100:.1f}%)")

    yaml_lines = [
        f"path: {DATASET.as_posix()}",
        "train: train/images",
        "val: test/images",   # no separate val split -> validate on the test set
        "test: test/images",
        f"nc: {len(NAMES)}",
        "names:",
        *[f"  {i}: {name}" for i, name in enumerate(NAMES)],
    ]
    DATA_YAML.write_text("\n".join(yaml_lines) + "\n")
    print(f"wrote {DATA_YAML}")


if __name__ == "__main__":
    main()