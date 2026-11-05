"""ขั้นตอนตรวจ PPE หนึ่งครั้ง (หนึ่ง session) ตามที่ออกแบบใน WED.md

รอจนเจอคน → ถ่ายสูงสุด MAX_ATTEMPTS รอบ
  - ครบทุกชิ้นที่ต้องใส่        → passed (จบทันที)
  - ยังขาด และยังไม่ครบรอบ     → พูดบอกสิ่งที่ขาด รอ RETRY_DELAY_S แล้วถ่ายใหม่
  - ยังขาด ในรอบสุดท้าย        → failed
  - ไม่เจออะไรในเฟรมแล้ว        → undetermined (คนเดินออกไปก่อนจบ)
→ ใส่ผลลงคิว → รอให้คนออกจากจุดก่อนเริ่มรอบใหม่
"""
import logging
import random
import threading
import time
import uuid

import cv2

import config
from hardware import Camera, Detector, Speaker
from outbox import Outbox, utc_iso

log = logging.getLogger(__name__)


def confident(dets: list) -> set:
    return {d["class"] for d in dets
            if d["confidence"] >= config.PASS_CONF_BY_CLASS.get(d["class"], config.PASS_CONF)}


def encode_jpeg(frame) -> bytes:
    h, w = frame.shape[:2]
    scale = config.IMAGE_MAX_SIDE / max(h, w)
    if scale < 1:
        frame = cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY])
    if not ok:
        raise RuntimeError("encode JPEG ไม่สำเร็จ")
    return buf.tobytes()


def th(items) -> str:
    return " ".join(config.LABELS_TH.get(i, i) for i in items)


class Inspector:
    def __init__(self, camera: Camera, detector: Detector, speaker: Speaker, outbox: Outbox,
                 stop: threading.Event):
        self.camera = camera
        self.detector = detector
        self.speaker = speaker
        self.outbox = outbox
        self.stop = stop
        unknown = set(config.REQUIRED_ITEMS) - set(detector.names.values())
        if unknown:
            raise SystemExit(f"REQUIRED_ITEMS มีชื่อที่โมเดลไม่รู้จัก: {', '.join(sorted(unknown))}"
                             f" (คลาสของโมเดล: {', '.join(detector.names.values())})")

    def _frame(self, flush: int = 0):
        frame = self.camera.read(flush)
        if frame is None:
            self.stop.wait(2)  # กล้องหลุด รอแล้วเปิดใหม่ (main คอยส่ง event camera_error)
        return frame

    def wait_for_person(self) -> bool:
        streak = 0
        while not self.stop.is_set():
            frame = self._frame()
            if frame is not None:
                dets, _ = self.detector(frame)
                streak = streak + 1 if confident(dets) else 0
                if streak >= config.PRESENCE_FRAMES:
                    return True
            self.stop.wait(config.IDLE_INTERVAL_S)
        return False

    def wait_until_clear(self) -> None:
        deadline = time.time() + config.CLEAR_TIMEOUT_S
        streak = 0
        while not self.stop.is_set() and time.time() < deadline:
            frame = self._frame()
            if frame is not None:
                dets, _ = self.detector(frame)
                streak = 0 if confident(dets) else streak + 1
                if streak >= config.CLEAR_FRAMES:
                    return
            self.stop.wait(config.IDLE_INTERVAL_S)

    def inspect(self) -> dict | None:
        inspection_id = str(uuid.uuid4())
        started = time.time()
        attempts = []  # (capture dict, jpeg bytes)
        status, missing = "undetermined", []

        for n in range(1, config.MAX_ATTEMPTS + 1):
            frame = None
            while frame is None and not self.stop.is_set():
                frame = self._frame(flush=2)  # ทิ้งเฟรมเก่าให้ได้ภาพปัจจุบัน
            if frame is None:
                return None
            shot_at = time.time()
            dets, ms = self.detector(frame)
            attempts.append(({
                "attempt_no": n,
                "detections": dets,
                "inference_ms": ms,
                "captured_at": utc_iso(shot_at),
            }, encode_jpeg(frame)))

            seen = confident(dets)
            if not seen:
                status, missing = "undetermined", []
                break
            missing = [i for i in config.REQUIRED_ITEMS if i not in seen]
            if not missing:
                status = "passed"
                break
            if n < config.MAX_ATTEMPTS:
                log.info("รอบ %d ขาด %s", n, ", ".join(missing))
                self.speaker.say("missing", "กรุณาสวม " + th(missing))
                if self.stop.wait(config.RETRY_DELAY_S):
                    return None
            else:
                status = "failed"

        if status == "passed":
            self.speaker.say("passed", "ผ่าน เชิญเข้าพื้นที่ได้")
        elif status == "failed":
            self.speaker.say("failed", "ไม่ผ่าน ขาด " + th(missing))
        else:
            self.speaker.say("undetermined", "ตรวจไม่ได้ กรุณายืนหน้ากล้องใหม่อีกครั้ง")

        captures = self._save_images(inspection_id, status, attempts)
        result = {
            "inspection": {
                "id": inspection_id,
                "status": status,
                "missing_items": missing if status == "failed" else [],
                "model_version": config.MODEL_VERSION,
                "started_at": utc_iso(started),
                "ended_at": utc_iso(),
            },
            "captures": captures,
        }
        self.outbox.put("inspection", result)
        log.info("ตรวจเสร็จ %s: %s %s (%d รอบ)", inspection_id[:8], status, ",".join(missing), len(captures))
        return result

    def _save_images(self, inspection_id: str, status: str, attempts: list) -> list:
        keep = status != "passed" or random.random() < config.PASSED_IMAGE_RATE
        if keep and self.outbox.disk_mb() > config.MAX_QUEUE_MB:
            log.warning("รูปในคิวเกิน %d MB ไม่เก็บรูปของการตรวจนี้", config.MAX_QUEUE_MB)
            keep = False
        captures = []
        for cap, jpeg in attempts:
            if keep:
                path = self.outbox.image_dir / f"{inspection_id}_{cap['attempt_no']}.jpg"
                path.write_bytes(jpeg)
                cap = {**cap, "local_image": str(path)}
            captures.append(cap)
        return captures

    def run(self) -> None:
        while not self.stop.is_set():
            if not self.wait_for_person():
                break
            self.inspect()
            self.wait_until_clear()
