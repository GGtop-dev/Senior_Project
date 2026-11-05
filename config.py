"""ค่าตั้งของ Pi อ่านจาก environment หรือไฟล์ .env ข้างไฟล์นี้ (ดู .env.example)"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env(BASE_DIR / ".env")
_REQUIRED = object()


def _get(name, default=_REQUIRED, cast=str):
    value = os.environ.get(name, "").strip()
    if not value:
        if default is _REQUIRED:
            raise SystemExit(f"ยังไม่ได้ตั้งค่า {name} ใน pi/.env")
        return default
    return cast(value)


def _bool(v: str) -> bool:
    return v.lower() in ("1", "true", "yes", "on")


def _list(v: str) -> list:
    return [x.strip() for x in v.split(",") if x.strip()]


def _path(v: str) -> Path:
    p = Path(v)
    return p if p.is_absolute() else BASE_DIR / p


# --- Supabase (ใช้ anon key + บัญชีอุปกรณ์ ห้ามใช้ service_role key) ---
SUPABASE_URL = _get("SUPABASE_URL")
SUPABASE_ANON_KEY = _get("SUPABASE_ANON_KEY")
DEVICE_EMAIL = _get("DEVICE_EMAIL")
DEVICE_PASSWORD = _get("DEVICE_PASSWORD")
IMAGE_BUCKET = _get("IMAGE_BUCKET", "captures")

# --- โมเดล ---
MODEL_PATH = _get("MODEL_PATH", BASE_DIR / "models" / "best.pt", _path)
MODEL_VERSION = _get("MODEL_VERSION", "yolov8n-ppe A4")
IMGSZ = _get("IMGSZ", 960, int)                 # ให้ตรงกับตอน train
DETECT_CONF = _get("DETECT_CONF", 0.25, float)  # เก็บลง log ตั้งแต่ค่านี้
PASS_CONF = _get("PASS_CONF", 0.7, float)       # นับว่า "สวมอยู่" ตั้งแต่ค่านี้


def _conf_map(v: str) -> dict:
    """"mask=0.5,safety_glasses=0.5" -> {"mask": 0.5, "safety_glasses": 0.5}"""
    return {k.strip(): float(x) for k, x in (p.split("=", 1) for p in _list(v))}


# เกณฑ์แยกรายคลาส ใช้แทน PASS_CONF: ของชิ้นเล็ก (หน้ากาก แว่น) confidence ต่ำกว่าคลาสอื่น
PASS_CONF_BY_CLASS = _get("PASS_CONF_BY_CLASS", {}, _conf_map)  # เช่น mask=0.5,safety_glasses=0.5

# ชื่อคลาสแปลงเป็นตัวพิมพ์เล็กคั่นด้วย _ เช่น "Safety Shoes" -> safety_shoes
REQUIRED_ITEMS = _get("REQUIRED_ITEMS",
                      ["helmet", "gloves", "safety_shoes", "non_jeans_pants", "mask", "safety_glasses"], _list)

# --- ขั้นตอนการตรวจ ---
MAX_ATTEMPTS = _get("MAX_ATTEMPTS", 3, int)
RETRY_DELAY_S = _get("RETRY_DELAY_S", 4.0, float)    # เวลาให้คนแก้ไขก่อนถ่ายรอบถัดไป
PRESENCE_FRAMES = _get("PRESENCE_FRAMES", 3, int)    # เจอ PPE ติดกันกี่เฟรมจึงเริ่มตรวจ
CLEAR_FRAMES = _get("CLEAR_FRAMES", 5, int)          # ไม่เจออะไรติดกันกี่เฟรมจึงถือว่าคนออกจากจุดแล้ว
CLEAR_TIMEOUT_S = _get("CLEAR_TIMEOUT_S", 30.0, float)
IDLE_INTERVAL_S = _get("IDLE_INTERVAL_S", 0.3, float)

# --- กล้องและรูป ---
CAMERA_INDEX = _get("CAMERA_INDEX", 0, int)
CAMERA_WIDTH = _get("CAMERA_WIDTH", 1280, int)
CAMERA_HEIGHT = _get("CAMERA_HEIGHT", 720, int)
IMAGE_MAX_SIDE = _get("IMAGE_MAX_SIDE", 1280, int)
JPEG_QUALITY = _get("JPEG_QUALITY", 80, int)
PASSED_IMAGE_RATE = _get("PASSED_IMAGE_RATE", 0.2, float)  # เก็บรูปของครั้งที่ผ่านแค่บางส่วน

# --- อุปกรณ์ ---
HEARTBEAT_S = _get("HEARTBEAT_S", 30.0, float)
HIGH_TEMP_C = _get("HIGH_TEMP_C", 75.0, float)
SOUNDS_DIR = _get("SOUNDS_DIR", BASE_DIR / "sounds", _path)
DATA_DIR = _get("DATA_DIR", BASE_DIR / "data", _path)
MAX_QUEUE_MB = _get("MAX_QUEUE_MB", 2000, int)  # เกินนี้จะไม่เก็บรูปเพิ่ม แต่ยังเก็บผลตรวจ
LOG_LEVEL = _get("LOG_LEVEL", "INFO")
DRY_SOUND = _get("DRY_SOUND", False, _bool)      # true = พิมพ์ข้อความแทนเล่นเสียง

# ข้อความที่ลำโพงพูด (ใช้กับ espeak-ng เมื่อไม่มีไฟล์ .wav)
LABELS_TH = {
    "gloves": "ถุงมือ",
    "helmet": "หมวกนิรภัย",
    "mask": "หน้ากาก",
    "protective_apron": "ผ้ากันเปื้อน",
    "safety_shoes": "รองเท้านิรภัย",
    "sleeve": "ปลอกแขน",
    "jeans": "กางเกงยีนส์",
    "non_jeans_pants": "กางเกงที่ไม่ใช่ยีนส์",
    "safety_glasses": "แว่นตานิรภัย",
}
