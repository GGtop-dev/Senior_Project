"""กล้อง, ลำโพง, อุณหภูมิ CPU และโมเดล"""
import logging
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import cv2

log = logging.getLogger(__name__)


def class_key(name: str) -> str:
    """'Safety Shoes' -> 'safety_shoes', 'Non-jeans pants' -> 'non_jeans_pants'"""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def cpu_temp() -> float | None:
    try:
        return round(int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000, 1)
    except (OSError, ValueError):
        return None


class Detector:
    def __init__(self, model_path: Path, imgsz: int, conf: float):
        from ultralytics import YOLO  # import ช้า จึงโหลดเมื่อใช้จริง

        self.model = YOLO(str(model_path), task="detect")
        self.imgsz = imgsz
        self.conf = conf
        self.names = {int(i): class_key(n) for i, n in self.model.names.items()}
        log.info("โหลดโมเดล %s คลาส: %s", model_path, ", ".join(self.names.values()))

    def __call__(self, frame):
        """คืน (detections, inference_ms) โดย box เป็นค่า normalized [x1, y1, x2, y2]"""
        t = time.perf_counter()
        r = self.model.predict(frame, imgsz=self.imgsz, conf=self.conf, verbose=False)[0]
        ms = round((time.perf_counter() - t) * 1000)
        b = r.boxes
        dets = [
            {"class": self.names[int(c)], "confidence": round(float(p), 3),
             "box": [round(float(v), 4) for v in box]}
            for c, p, box in zip(b.cls.tolist(), b.conf.tolist(), b.xyxyn.tolist())
        ]
        dets.sort(key=lambda d: -d["confidence"])
        return dets, ms


class Camera:
    def __init__(self, index: int, width: int, height: int):
        self.index, self.width, self.height = index, width, height
        self.cap = None
        self.ok = None  # None = ยังไม่เคยลอง
        self._lock = threading.Lock()

    def _open(self):
        cap = cv2.VideoCapture(self.index)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap if cap.isOpened() else None

    def read(self, flush: int = 0):
        """คืนภาพ BGR หรือ None ถ้ากล้องมีปัญหา flush = ทิ้งเฟรมเก่าใน buffer กี่เฟรม"""
        with self._lock:
            if self.cap is None:
                self.cap = self._open()
            frame = None
            if self.cap is not None:
                for _ in range(flush):
                    self.cap.grab()
                ok, frame = self.cap.read()
                if not ok:
                    frame = None
                    self.cap.release()
                    self.cap = None
            self.ok = frame is not None
            return frame

    def close(self):
        with self._lock:
            if self.cap is not None:
                self.cap.release()
                self.cap = None


class Speaker:
    """เล่นไฟล์ sounds/<name>.wav ด้วย aplay ถ้าไม่มีไฟล์จะใช้ espeak-ng พูดข้อความแทน"""

    def __init__(self, sounds_dir: Path, dry: bool = False):
        self.sounds_dir = sounds_dir
        self.dry = dry
        self.aplay = shutil.which("aplay")
        self.espeak = shutil.which("espeak-ng") or shutil.which("espeak")
        self._ok_cache = (0.0, None)

    @property
    def ok(self) -> bool | None:
        if self.dry:
            return True
        checked, value = self._ok_cache
        if time.time() - checked > 60:
            value = None
            if self.aplay:
                try:
                    out = subprocess.run([self.aplay, "-l"], capture_output=True, text=True, timeout=5).stdout
                    value = "card" in out
                except (OSError, subprocess.SubprocessError):
                    value = False
            self._ok_cache = (time.time(), value)
        return value

    def say(self, sound: str, text: str) -> None:
        if self.dry:
            log.info("[ลำโพง] %s", text)
            return
        wav = self.sounds_dir / f"{sound}.wav"
        if wav.exists() and self.aplay:
            cmd = [self.aplay, "-q", str(wav)]
        elif self.espeak:
            cmd = [self.espeak, "-v", "th", text]
        else:
            log.warning("ไม่มีไฟล์ %s และไม่มี espeak-ng: %s", wav.name, text)
            return
        try:
            subprocess.run(cmd, timeout=15, check=False, capture_output=True)
        except (OSError, subprocess.SubprocessError) as e:
            log.warning("เล่นเสียงไม่สำเร็จ: %s", e)
