"""จุดเริ่มของโปรแกรมบน Raspberry Pi

    python main.py              รันระบบตรวจ PPE
    python main.py --selftest   ทดสอบการเชื่อม Supabase โดยไม่ใช้กล้องและโมเดล
"""
import argparse
import logging
import signal
import sys
import threading
import time
import uuid

import config
from outbox import Outbox, Uploader, utc_iso
from supabase_client import ApiError, NetworkError, Supabase

log = logging.getLogger("ppe")
HIGH_TEMP_COOLDOWN_S = 30 * 60


class Monitor(threading.Thread):
    """ส่ง heartbeat ทุก HEARTBEAT_S วินาที และบันทึก event เมื่อกล้อง/ลำโพง/อุณหภูมิผิดปกติ"""

    def __init__(self, sb, outbox, camera, speaker, stop):
        super().__init__(name="monitor", daemon=True)
        self.sb, self.outbox, self.camera, self.speaker, self.stop = sb, outbox, camera, speaker, stop
        self._last_hot = 0.0
        self._prev = {"camera": True, "speaker": True}

    def _watch(self, name, ok, type_, message):
        if ok is False and self._prev[name]:
            self.outbox.event(type_, message)
        if ok is not None:
            self._prev[name] = ok

    def tick(self):
        from hardware import cpu_temp

        temp = cpu_temp()
        cam_ok = self.camera.ok if self.camera else None
        spk_ok = self.speaker.ok if self.speaker else None
        self._watch("camera", cam_ok, "camera_error", f"อ่านภาพจากกล้องไม่สำเร็จ (index {config.CAMERA_INDEX})")
        self._watch("speaker", spk_ok, "speaker_error", "ไม่พบอุปกรณ์เสียง (aplay -l)")
        if temp is not None and temp >= config.HIGH_TEMP_C and time.time() - self._last_hot > HIGH_TEMP_COOLDOWN_S:
            self._last_hot = time.time()
            self.outbox.event("high_temp", f"อุณหภูมิ CPU {temp:.0f}°C เกินเกณฑ์ {config.HIGH_TEMP_C:.0f}°C")
        try:
            self.sb.rpc("device_heartbeat", {
                "p_cpu_temp": temp,
                "p_camera_ok": cam_ok,
                "p_speaker_ok": spk_ok,
                "p_model_version": config.MODEL_VERSION,
                "p_queue_size": self.outbox.size(),
            })
        except NetworkError as e:
            log.debug("heartbeat ไม่ผ่าน (ออฟไลน์): %s", e)
        except ApiError as e:
            log.error("heartbeat ถูกปฏิเสธ: %s", e)

    def run(self):
        while not self.stop.is_set():
            self.tick()
            self.stop.wait(config.HEARTBEAT_S)


def selftest(sb: Supabase, outbox: Outbox, uploader: Uploader) -> int:
    """ส่ง heartbeat, event และผลตรวจปลอมหนึ่งรายการ (status = undetermined, model_version = selftest)"""
    try:
        uploader.resolve_device()
        print(f"[1/3] login และพบอุปกรณ์ {uploader.device_name} ({uploader.device_id})")
        Monitor(sb, outbox, None, None, threading.Event()).tick()
        print("[2/3] ส่ง heartbeat แล้ว")

        import numpy as np
        from inspector import encode_jpeg

        img = np.full((360, 640, 3), 200, np.uint8)
        inspection_id = str(uuid.uuid4())
        path = outbox.image_dir / f"{inspection_id}_1.jpg"
        path.write_bytes(encode_jpeg(img))
        now = utc_iso()
        outbox.event("boot", "selftest: ทดสอบการเชื่อมต่อ")
        outbox.put("inspection", {
            "inspection": {"id": inspection_id, "status": "undetermined", "missing_items": [],
                           "model_version": "selftest", "started_at": now, "ended_at": now},
            "captures": [{"attempt_no": 1, "detections": [], "inference_ms": 0,
                          "captured_at": now, "local_image": str(path)}],
        })
        while uploader.run_once():
            pass
        left = outbox.size()
        print(f"[3/3] ส่งผลตรวจทดสอบแล้ว id = {inspection_id}" + (f" (ยังค้างในคิว {left} งาน)" if left else ""))
        print("เปิดหน้าเว็บ inspection.html?id=" + inspection_id + " เพื่อดูผล แล้วให้ admin ลบรายการทดสอบทิ้งได้")
        return 0 if not left else 1
    except (NetworkError, ApiError) as e:
        print("ไม่สำเร็จ:", e)
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="ทดสอบการเชื่อม Supabase แล้วจบ")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")  # ข้อความไทยบน console ที่ไม่ใช่ UTF-8

    logging.basicConfig(level=config.LOG_LEVEL, format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    sb = Supabase(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, config.DEVICE_EMAIL, config.DEVICE_PASSWORD)
    outbox = Outbox(config.DATA_DIR)
    stop = threading.Event()
    uploader = Uploader(sb, outbox, config.IMAGE_BUCKET, stop)

    if args.selftest:
        return selftest(sb, outbox, uploader)

    from hardware import Camera, Detector, Speaker
    from inspector import Inspector

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    detector = Detector(config.MODEL_PATH, config.IMGSZ, config.DETECT_CONF)
    camera = Camera(config.CAMERA_INDEX, config.CAMERA_WIDTH, config.CAMERA_HEIGHT)
    speaker = Speaker(config.SOUNDS_DIR, config.DRY_SOUND)
    inspector = Inspector(camera, detector, speaker, outbox, stop)

    outbox.event("boot", f"เริ่มระบบและโหลดโมเดล {config.MODEL_VERSION}")
    uploader.start()
    camera.read()  # เปิดกล้องก่อนส่ง heartbeat แรก
    Monitor(sb, outbox, camera, speaker, stop).start()

    log.info("พร้อมตรวจ ต้องสวม: %s", ", ".join(config.REQUIRED_ITEMS))
    try:
        inspector.run()
    finally:
        stop.set()
        camera.close()
        log.info("ปิดระบบ (ค้างในคิว %d งาน จะส่งต่อเมื่อเปิดใหม่)", outbox.size())
    return 0


if __name__ == "__main__":
    sys.exit(main())
