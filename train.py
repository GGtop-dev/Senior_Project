"""Train YOLOv8 on the prepared dataset (run prepare_dataset.py first).

Usage:
    python train.py
    python train.py --model yolov8s.pt --epochs 150 --batch 8
    python train.py --device cpu
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
DATA_YAML = ROOT / "Dataset_split" / "data.yaml"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="yolov8n.pt",
                    help="pretrained weights: yolov8n/s/m/l/x.pt (downloaded automatically)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16, help="lower this if you run out of GPU memory")
    ap.add_argument("--device", default=None, help="'0' for first GPU, 'cpu', or leave empty for auto")
    ap.add_argument("--name", default="ppe_yolov8", help="run folder name under runs/")
    args = ap.parse_args()

    if not DATA_YAML.exists():
        raise SystemExit(f"{DATA_YAML} not found - run: python prepare_dataset.py")

    model = YOLO(args.model)
    model.train(
        data=str(DATA_YAML),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        patience=30,  # stop early if val mAP doesn't improve for 30 epochs
        project=str(ROOT / "runs"),
        name=args.name,
        exist_ok=True,
        plots=True,
    )
    print(f"best weights: {model.trainer.best}")


if __name__ == "__main__":  # required on Windows for dataloader workers
    main()
