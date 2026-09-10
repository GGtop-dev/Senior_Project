"""Run the trained YOLOv11 model, save annotated images, and print per-class counts.

Defaults to the 20% test split (Dataset/test/images).

Usage:
    python predict.py                            # -> Dataset/test/images
    python predict.py --source path/to/image.jpg
    python predict.py --source path/to/folder
    python predict.py --source 0 --show          # webcam
"""
import argparse
from collections import Counter
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS = ROOT / "runs" / "ppe_yolov11" / "weights" / "best.pt"
DEFAULT_SOURCE = ROOT / "Dataset" / "test" / "images"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=str(DEFAULT_SOURCE),
                    help="image, folder, video, or webcam index (default: Dataset/test/images)")
    ap.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    ap.add_argument("--conf", type=float, default=0.25, help="confidence threshold")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--show", action="store_true", help="display results in a window")
    args = ap.parse_args()

    model = YOLO(args.weights)
    results = model.predict(
        source=args.source,
        conf=args.conf,
        imgsz=args.imgsz,
        show=args.show,
        save=True,
        project=str(ROOT / "runs"),
        name="predict",
        exist_ok=True,
        stream=True,
    )

    total = Counter()
    for r in results:
        counts = Counter(r.names[int(c)] for c in r.boxes.cls)
        total += counts
        print(f"{Path(r.path).name}: {dict(counts) or 'no detections'}")

    print(f"\ntotal: {dict(total)}")
    print(f"annotated output saved to {ROOT / 'runs' / 'predict'}")


if __name__ == "__main__":
    main()