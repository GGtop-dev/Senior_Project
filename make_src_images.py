"""Copy originals from Data Set/ to src_images/ upright (EXIF orientation applied, EXIF stripped)."""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).parent
SRC = ROOT / "DataSetAgumen-merged" / "DataSetAgumen" / "Data Set"
DST = ROOT / "src_images"
DST.mkdir(exist_ok=True)

n = 0
for p in sorted(SRC.iterdir()):
    if p.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        continue
    out = DST / (p.stem + ".jpg")
    if out.exists():
        continue
    with Image.open(p) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.save(out, quality=95)
    n += 1
print(f"wrote {n} images -> {DST} (total {len(list(DST.glob('*.jpg')))})")
