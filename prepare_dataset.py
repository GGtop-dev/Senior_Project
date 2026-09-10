"""Split Dataset/train into train/val(/test) and write a YOLOv8 data.yaml.

The Roboflow export only contains a train split, and its data.yaml points to
valid/ and test/ folders that don't exist. This script copies the images and
labels into Dataset_split/ (the original Dataset/ folder is never modified).

Usage:
    python prepare_dataset.py                # 80% train / 20% val
    python prepare_dataset.py --test 0.1     # 70% train / 20% val / 10% test
"""
import argparse
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "Dataset" / "train"
OUT = ROOT / "Dataset_split"
DATA_YAML = OUT / "data.yaml"

# Class names from Dataset/data.yaml (index = class id)
NAMES = ["Gloves", "Helmet", "Mask", "Protective apron", "Safety Shoes", "Sleeve", "gloves"]
DUPLICATE_GLOVES_ID = 6  # 'gloves' is the same object as 'Gloves' (id 0)
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--val", type=float, default=0.2, help="fraction of images for validation")
    ap.add_argument("--test", type=float, default=0.0, help="fraction of images for test")
    ap.add_argument("--seed", type=int, default=42, help="random seed for the split")
    ap.add_argument("--keep-duplicate-gloves", action="store_true",
                    help="keep 'gloves' (id 6) as its own class instead of merging it into 'Gloves' (id 0)")
    args = ap.parse_args()

    merge = not args.keep_duplicate_gloves
    names = NAMES[:DUPLICATE_GLOVES_ID] if merge else NAMES

    pairs = []
    for img in sorted((SRC / "images").iterdir()):
        if img.suffix.lower() not in IMG_EXTS:
            continue
        lbl = SRC / "labels" / f"{img.stem}.txt"
        if lbl.exists():
            pairs.append((img, lbl))
        else:
            print(f"[skip] no label for {img.name}")

    random.Random(args.seed).shuffle(pairs)
    n_test = round(len(pairs) * args.test)
    n_val = round(len(pairs) * args.val)
    splits = {
        "train": pairs[n_test + n_val:],
        "val": pairs[n_test:n_test + n_val],
        "test": pairs[:n_test],
    }

    if OUT.exists():
        shutil.rmtree(OUT)

    for split, items in splits.items():
        if not items:
            continue
        (OUT / split / "images").mkdir(parents=True)
        (OUT / split / "labels").mkdir(parents=True)
        for img, lbl in items:
            shutil.copy2(img, OUT / split / "images" / img.name)
            lines = []
            for line in lbl.read_text().splitlines():
                parts = line.split()
                if not parts:
                    continue
                if merge and int(parts[0]) == DUPLICATE_GLOVES_ID:
                    parts[0] = "0"
                lines.append(" ".join(parts))
            (OUT / split / "labels" / lbl.name).write_text("\n".join(lines) + "\n")
        print(f"{split:5s}: {len(items)} images")

    yaml_lines = [f"path: {OUT.as_posix()}", "train: train/images", "val: val/images"]
    if splits["test"]:
        yaml_lines.append("test: test/images")
    yaml_lines.append(f"nc: {len(names)}")
    yaml_lines.append("names:")
    yaml_lines += [f"  {i}: {name}" for i, name in enumerate(names)]
    DATA_YAML.write_text("\n".join(yaml_lines) + "\n")

    print(f"classes: {names}")
    print(f"wrote {DATA_YAML}")


if __name__ == "__main__":
    main()
