"""Faster R-CNN (ResNet-50-FPN v2, COCO weights): train, then evaluate best.pt on val and test.

Same group split, originals-only train list and imgsz as A4. mAP uses Ultralytics' own matching and
ap_per_class with conf 0.001 / NMS 0.7 / max_det 300, so the numbers are directly comparable to YOLO val.

    .venv\\Scripts\\python train_frcnn.py --name F1                # flip only
    .venv\\Scripts\\python train_frcnn.py --name F2 --strong-aug   # A4-like online aug
    .venv\\Scripts\\python train_frcnn.py --name F1 --eval-only    # re-evaluate runs/F1/weights/best.pt
"""
import argparse
import csv
import json
import math
import random
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import tv_tensors
from torchvision.models.detection import FasterRCNN_ResNet50_FPN_V2_Weights, fasterrcnn_resnet50_fpn_v2
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms import v2
from ultralytics.engine.validator import BaseValidator
from ultralytics.utils.metrics import ap_per_class, box_iou

ROOT = Path(__file__).parent
YOLO_DIR = ROOT / "yolo"
NAMES = (ROOT / "classes.txt").read_text(encoding="utf-8").split("\n")
NAMES = [n.strip() for n in NAMES if n.strip()]


class YoloDataset(Dataset):
    def __init__(self, split, transform=None):
        if split == "train":  # same list as data_orig.yaml: no offline variants
            self.files = [Path(p) for p in (YOLO_DIR / "train_orig.txt").read_text().split("\n") if p.strip()]
        else:
            self.files = sorted((YOLO_DIR / split / "images").glob("*.jpg"))
        self.transform = transform

    def __len__(self):
        return len(self.files)

    def __getitem__(self, i):
        path = self.files[i]
        img = v2.functional.to_image(Image.open(path).convert("RGB"))
        h, w = img.shape[-2:]
        label = path.parent.parent / "labels" / f"{path.stem}.txt"
        rows = [list(map(float, r.split())) for r in label.read_text().splitlines() if r.strip()]
        rows = np.array(rows, dtype=np.float32).reshape(-1, 5)
        cx, cy, bw, bh = rows[:, 1] * w, rows[:, 2] * h, rows[:, 3] * w, rows[:, 4] * h
        boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
        target = {
            "boxes": tv_tensors.BoundingBoxes(torch.from_numpy(boxes), format="XYXY", canvas_size=(h, w)),
            "labels": torch.from_numpy(rows[:, 0].astype(np.int64)) + 1,  # 0 = background
        }
        if self.transform:
            img, target = self.transform(img, target)
        return v2.functional.to_dtype(img, torch.float32, scale=True), target


def make_transform(strong):
    t = [v2.RandomHorizontalFlip(0.5)]
    if strong:
        # same ranges as A4; hue stays 0 because colour separates Jeans from other pants
        t = [
            v2.ColorJitter(brightness=0.6, saturation=0.3),
            v2.RandomAffine(degrees=5, translate=(0.2, 0.2), scale=(0.1, 1.9), fill=114),
            *t,
        ]
    return v2.Compose([*t, v2.ClampBoundingBoxes(), v2.SanitizeBoundingBoxes(min_size=2)])


def make_model(imgsz, pretrained=True):
    weights = FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1 if pretrained else None
    # min_size = max_size keeps the long side at imgsz, the same input scale as YOLO
    model = fasterrcnn_resnet50_fpn_v2(
        weights=weights, min_size=imgsz, max_size=imgsz,
        box_score_thresh=0.001, box_nms_thresh=0.7, box_detections_per_img=300,  # YOLO val defaults
    )
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, len(NAMES) + 1)
    return model


def collate(batch):
    return tuple(zip(*batch))


def evaluate(predict, dataset):
    """predict(image) -> (boxes xyxy in image pixels, conf, cls) sorted by descending conf."""
    matcher = SimpleNamespace(iouv=torch.linspace(0.5, 0.95, 10))
    tps, confs, pred_cls, target_cls, times = [], [], [], [], []
    for i in range(len(dataset)):
        img, target = dataset[i]
        t0 = time.perf_counter()
        boxes, conf, cls = predict(img)
        times.append(time.perf_counter() - t0)
        gt_cls = target["labels"].cpu() - 1
        iou = box_iou(torch.as_tensor(target["boxes"]).float().cpu(), boxes.float().cpu())
        tps.append(BaseValidator.match_predictions(matcher, cls.cpu(), gt_cls, iou))
        confs.append(conf.cpu().numpy())
        pred_cls.append(cls.cpu().numpy())
        target_cls.append(gt_cls.numpy())

    _, _, p, r, _, ap, classes, *_ = ap_per_class(
        np.concatenate(tps), np.concatenate(confs), np.concatenate(pred_cls), np.concatenate(target_cls)
    )
    per_class = {
        NAMES[c]: dict(p=float(p[k]), r=float(r[k]), ap50=float(ap[k, 0]), ap=float(ap[k].mean()))
        for k, c in enumerate(classes)
    }
    return dict(
        map50=float(ap[:, 0].mean()), map=float(ap.mean()), per_class=per_class,
        ms_per_image=1000 * float(np.median(times[1:])),
    )


def frcnn_predictor(model, device):
    @torch.inference_mode()
    def predict(img):
        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            out = model([img.to(device)])[0]
        if device.type == "cuda":
            torch.cuda.synchronize()
        order = out["scores"].argsort(descending=True)
        return out["boxes"][order], out["scores"][order], out["labels"][order] - 1

    return predict


def train(a, device, best, last):
    random.seed(a.seed)
    np.random.seed(a.seed)
    torch.manual_seed(a.seed)

    train_set = YoloDataset("train", make_transform(a.strong_aug))
    val_set = YoloDataset("val")
    loader = DataLoader(
        train_set, batch_size=a.batch, shuffle=True, num_workers=a.workers, collate_fn=collate,
        persistent_workers=a.workers > 0, pin_memory=True,
    )
    model = make_model(a.imgsz).to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.SGD(params, lr=a.lr, momentum=0.9, weight_decay=0.0005)

    warmup, total = len(loader), a.epochs * len(loader)  # 1 epoch warmup, then cosine down to 1% of lr

    def schedule(step):
        if step < warmup:
            return 0.01 + 0.99 * step / warmup
        return 0.01 + 0.99 * 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(1, total - warmup)))

    sched = torch.optim.lr_scheduler.LambdaLR(opt, schedule)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")

    results = ROOT / "runs" / a.name / "results.csv"
    best_fit, best_epoch = -1.0, 0
    t_start = time.time()
    with results.open("w", newline="") as f:
        out = csv.writer(f)
        out.writerow(["epoch", "train_loss", "val_map50", "val_map", "seconds"])
        for epoch in range(1, a.epochs + 1):
            model.train()
            losses, t0 = [], time.time()
            for imgs, targets in loader:
                imgs = [i.to(device, non_blocking=True) for i in imgs]
                targets = [{k: torch.as_tensor(v).to(device) for k, v in t.items()} for t in targets]
                with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                    loss = sum(model(imgs, targets).values())
                opt.zero_grad(set_to_none=True)
                if torch.isfinite(loss):
                    scaler.scale(loss).backward()
                    scaler.step(opt)
                    scaler.update()
                    losses.append(loss.item())
                sched.step()

            model.eval()
            m = evaluate(frcnn_predictor(model, device), val_set)
            fit = 0.1 * m["map50"] + 0.9 * m["map"]  # same fitness as Ultralytics
            sec = time.time() - t0
            print(f"epoch {epoch:3d}/{a.epochs}  loss {np.mean(losses):.3f}  val mAP50 {m['map50']:.3f}  "
                  f"mAP50-95 {m['map']:.3f}  {sec:.0f}s", flush=True)
            out.writerow([epoch, f"{np.mean(losses):.4f}", f"{m['map50']:.4f}", f"{m['map']:.4f}", f"{sec:.1f}"])
            f.flush()

            torch.save(model.state_dict(), last)
            if fit > best_fit:
                best_fit, best_epoch = fit, epoch
                torch.save(model.state_dict(), best)
            elif a.patience and epoch - best_epoch >= a.patience:
                print(f"early stop at epoch {epoch}", flush=True)
                break

    print(f"train done in {(time.time() - t_start) / 60:.1f} min, best epoch {best_epoch}", flush=True)
    return best_epoch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="F1")
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--lr", type=float, default=0.005)   # 0.02 per 16 images, torchvision reference rule
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--patience", type=int, default=30, help="0 = no early stopping")
    ap.add_argument("--strong-aug", action="store_true", help="A4-like online aug instead of flip only")
    ap.add_argument("--eval-only", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    weights = ROOT / "runs" / a.name / "weights"
    weights.mkdir(parents=True, exist_ok=True)
    best, last = weights / "best.pt", weights / "last.pt"

    if not a.eval_only:
        train(a, device, best, last)

    model = make_model(a.imgsz, pretrained=False)
    model.load_state_dict(torch.load(best, map_location="cpu"))
    model.to(device).eval()
    summary = {}
    for split in ("val", "test"):
        m = summary[split] = evaluate(frcnn_predictor(model, device), YoloDataset(split))
        print(f"\n[{split}] mAP50 {m['map50']:.3f}  mAP50-95 {m['map']:.3f}  {m['ms_per_image']:.1f} ms/image")
        for c, v in m["per_class"].items():
            print(f"  {c:<18} P {v['p']:.3f}  R {v['r']:.3f}  AP50 {v['ap50']:.3f}  AP50-95 {v['ap']:.3f}")
    (ROOT / "runs" / a.name / "eval.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
