"""Advanced train (A1): full schedule, no early stopping, then evaluate best.pt on val and test.

    .venv\\Scripts\\python train_advanced.py                 # A1 defaults
    .venv\\Scripts\\python train_advanced.py --name A2 --imgsz 1280 --batch 8
    .venv\\Scripts\\python train_advanced.py --name A4 --data data_orig.yaml --strong-aug --patience 50
"""
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="A1")
    ap.add_argument("--model", default="yolov8n.pt")
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--data", default="data.yaml", help="data_orig.yaml = originals only, no offline variants")
    ap.add_argument("--patience", type=int, default=0, help="0 = no early stopping")
    ap.add_argument("--strong-aug", action="store_true", help="stronger online aug to replace the offline variants")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    data = str(ROOT / a.data)
    # A3 overfit after epoch 15: offline variants are fixed copies, online aug is re-sampled every epoch
    aug = dict(degrees=0.0, translate=0.1, scale=0.7, mixup=0.0)  # scale: size variety for small objects
    if a.strong_aug:
        aug.update(degrees=5.0, translate=0.2, scale=0.9, mixup=0.1)

    model = YOLO(a.model)
    model.train(
        data=data,
        project=str(ROOT / "runs"),
        name=a.name,
        exist_ok=True,
        imgsz=a.imgsz,
        epochs=a.epochs,
        patience=a.patience,
        batch=a.batch,
        workers=a.workers,
        cache=False,         # --cache ram made Windows workers run out of memory
        seed=a.seed,
        deterministic=False,
        # optimisation
        optimizer="SGD",
        lr0=0.005,           # R1 peaked at epoch 9 -> learned too fast / overfit
        lrf=0.01,
        cos_lr=True,
        warmup_epochs=5,
        weight_decay=0.0005,
        box=10.0,            # weight box accuracy higher -> AP50-95
        # augmentation (offline variants already cover rotate/shift/flip/blur/noise/brightness)
        hsv_h=0.0,           # colour separates Jeans from other pants: never shift hue
        hsv_s=0.3,
        hsv_v=0.6,           # brightness/contrast instead of colour (helps colour-blend cases)
        fliplr=0.5,
        mosaic=1.0,
        close_mosaic=30,
        copy_paste=0.0,      # needs polygon labels, ours are boxes only
        plots=True,
        **aug,
    )

    best = ROOT / "runs" / a.name / "weights" / "best.pt"
    for split in ("val", "test"):
        m = YOLO(str(best)).val(data=data, split=split, imgsz=a.imgsz, batch=a.batch,
                                project=str(ROOT / "runs"), name=f"{a.name}_eval_{split}", exist_ok=True, plots=True)
        print(f"\n[{split}] mAP50 {m.box.map50:.3f}  mAP50-95 {m.box.map:.3f}")
        for i, c in m.names.items():
            if i in m.box.ap_class_index:
                k = list(m.box.ap_class_index).index(i)
                p, r, ap50, ap = m.box.class_result(k)
                print(f"  {c:<18} P {p:.3f}  R {r:.3f}  AP50 {ap50:.3f}  AP50-95 {ap:.3f}")


if __name__ == "__main__":
    main()
