"""Train YOLOv11 on the pre-split dataset: train 80% / test 20%.

Run prepare_dataset.py first to generate Dataset/data.yaml. Validation during
training runs on the test split (data.yaml maps val -> test/images).

Early stopping is OFF by default (--patience 0), so it always runs the full
--epochs. best.pt is still whichever epoch had the best val mAP.

Usage:
    python train.py
    python train.py --epochs 200
    python train.py --model yolo11s.pt --epochs 150 --batch 8
    python train.py --device cpu
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
DATA_YAML = ROOT / "Dataset" / "data.yaml"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="yolo11n.pt",
                    help="pretrained weights: yolo11n/s/m/l/x.pt (downloaded automatically)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16, help="lower this if you run out of GPU memory")
    ap.add_argument("--device", default=None, help="'0' for first GPU, 'cpu', or leave empty for auto")
    ap.add_argument("--name", default="ppe_yolov11", help="run folder name under runs/")
    ap.add_argument("--patience", type=int, default=0,
                    help="early-stop patience; 0 = disabled, run all --epochs")
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
        patience=args.patience,  # 0 = no early stop, always run all epochs
        project=str(ROOT / "runs"),
        name=args.name,
        exist_ok=True,
        plots=True,
    )
    print(f"best weights: {model.trainer.best}")

    # final evaluation on the 20% test split
    metrics = model.val(data=str(DATA_YAML), split="test", device=args.device)
    print(f"test  mAP50: {metrics.box.map50:.4f}  mAP50-95: {metrics.box.map:.4f}")


if __name__ == "__main__":  # required on Windows for dataloader workers
    main()