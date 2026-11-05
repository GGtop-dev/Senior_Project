"""คิวบนดิสก์ (SQLite) ผลตรวจทุกครั้งลงคิวก่อน แล้ว Uploader ค่อยส่งขึ้น Supabase
ทำให้ตรวจต่อได้แม้เน็ตหลุด และไม่หายถ้าไฟดับ"""
import json
import logging
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from supabase_client import ApiError, NetworkError, Supabase

log = logging.getLogger(__name__)
MAX_API_ERRORS = 10  # ถูกปฏิเสธเกินนี้ ย้ายไปกองงานเสีย (dead) จะได้ไม่ขวางคิว


def utc_iso(ts: float | None = None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).isoformat()


class Outbox:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.image_dir = data_dir / "images"
        self.image_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(data_dir / "outbox.db", check_same_thread=False, isolation_level=None)
        self._db.execute("pragma journal_mode=wal")
        self._db.execute("""
            create table if not exists jobs (
              id         integer primary key autoincrement,
              kind       text    not null,
              payload    text    not null,
              created_at real    not null,
              attempts   integer not null default 0,
              next_try   real    not null default 0,
              last_error text,
              dead       integer not null default 0
            )""")
        self.wakeup = threading.Event()

    def put(self, kind: str, payload: dict) -> None:
        with self._lock:
            self._db.execute(
                "insert into jobs (kind, payload, created_at) values (?, ?, ?)",
                (kind, json.dumps(payload, ensure_ascii=False), time.time()),
            )
        self.wakeup.set()

    def event(self, type_: str, message: str, ts: float | None = None) -> None:
        log.info("event %s: %s", type_, message)
        self.put("event", {"type": type_, "message": message, "created_at": utc_iso(ts)})

    def next(self):
        with self._lock:
            row = self._db.execute(
                "select id, kind, payload, attempts from jobs"
                " where dead = 0 and next_try <= ? order by id limit 1",
                (time.time(),),
            ).fetchone()
        if not row:
            return None
        return {"id": row[0], "kind": row[1], "payload": json.loads(row[2]), "attempts": row[3]}

    def done(self, job_id: int) -> None:
        with self._lock:
            self._db.execute("delete from jobs where id = ?", (job_id,))

    def retry(self, job_id: int, error: str, delay: float, dead: bool = False) -> None:
        with self._lock:
            self._db.execute(
                "update jobs set attempts = attempts + 1, next_try = ?, last_error = ?, dead = ? where id = ?",
                (time.time() + delay, error[:1000], int(dead), job_id),
            )

    def size(self) -> int:
        with self._lock:
            return self._db.execute("select count(*) from jobs where dead = 0").fetchone()[0]

    def disk_mb(self) -> float:
        return sum(f.stat().st_size for f in self.image_dir.glob("*.jpg")) / 1e6


class Uploader(threading.Thread):
    def __init__(self, sb: Supabase, outbox: Outbox, bucket: str, stop: threading.Event):
        super().__init__(name="uploader", daemon=True)
        self.sb = sb
        self.outbox = outbox
        self.bucket = bucket
        self.stop = stop
        self.device_id = None
        self.device_name = None
        self._cache = outbox.data_dir / "device.json"
        if self._cache.exists():
            d = json.loads(self._cache.read_text(encoding="utf-8"))
            self.device_id, self.device_name = d["id"], d.get("name")

    def resolve_device(self) -> str:
        """หา devices.id ที่ผูกกับบัญชีนี้ (ต้อง login ก่อนจึงรู้ user id)"""
        self.sb.token()
        rows = self.sb.select("devices", {"select": "id,name", "auth_user_id": f"eq.{self.sb.user_id}"})
        if not rows:
            raise ApiError(404, f"ไม่มีแถวใน devices ที่ auth_user_id = {self.sb.user_id} ดูขั้นตอนใน pi/README.md")
        self.device_id, self.device_name = rows[0]["id"], rows[0]["name"]
        self._cache.write_text(json.dumps(rows[0], ensure_ascii=False), encoding="utf-8")
        log.info("อุปกรณ์นี้คือ %s (%s)", self.device_name, self.device_id)
        return self.device_id

    def handle(self, job: dict) -> bool:
        """ส่งงานหนึ่งชิ้น คืน True ถ้าเป็นผลตรวจ ทุกขั้นส่งซ้ำได้โดยไม่เกิดข้อมูลซ้ำ"""
        p = job["payload"]
        if job["kind"] == "event":
            self.sb.insert("device_events", {**p, "device_id": self.device_id})
            return False

        insp = {**p["inspection"], "device_id": self.device_id}
        captures, files = [], []
        for c in p["captures"]:
            local = c.pop("local_image", None)
            c["image_path"] = None
            if local and Path(local).exists():
                path = f"{self.device_id}/{insp['id']}/{c['attempt_no']}.jpg"
                self.sb.upload(self.bucket, path, Path(local).read_bytes())
                c["image_path"] = path
                files.append(Path(local))
            captures.append({**c, "inspection_id": insp["id"]})

        self.sb.insert("inspections", insp)
        for c in captures:
            self.sb.insert("captures", c)
        for f in files:
            f.unlink(missing_ok=True)
        return True

    def run_once(self) -> bool:
        """ส่งงานถัดไป คืน False ถ้าคิวว่าง (ใช้ใน --selftest ด้วย)"""
        if not self.device_id:
            self.resolve_device()
        job = self.outbox.next()
        if not job:
            return False
        try:
            was_inspection = self.handle(job)
        except ApiError as e:
            dead = job["attempts"] + 1 >= MAX_API_ERRORS
            log.error("งาน #%s ถูกปฏิเสธ%s: %s", job["id"], " (เลิกส่ง)" if dead else "", e)
            self.outbox.retry(job["id"], str(e), delay=300, dead=dead)
            return True
        self.outbox.done(job["id"])
        self._sent_inspection = was_inspection
        return True

    def run(self) -> None:
        down_since = None
        flushed = None  # นับผลตรวจที่ส่งย้อนหลังหลังเน็ตกลับมา
        while not self.stop.is_set():
            try:
                self._sent_inspection = False
                busy = self.run_once()
            except NetworkError as e:
                if down_since is None:
                    down_since = time.time()
                    log.warning("ส่งข้อมูลไม่ได้ พักไว้ในคิว (%d งาน): %s", self.outbox.size(), e)
                self.stop.wait(10)
                continue
            except ApiError as e:  # เช่น ยังไม่ได้ผูกบัญชีกับ devices หรือรหัสผ่านผิด
                log.error("%s", e)
                self.stop.wait(60)
                continue

            if down_since is not None:
                gap = time.time() - down_since
                self.outbox.event("network_down",
                                  f"อินเทอร์เน็ตหลุด {fmt_duration(gap)} · พักข้อมูลในคิว", ts=down_since)
                log.info("เน็ตกลับมาแล้ว หลังหลุด %s", fmt_duration(gap))
                down_since = None
                flushed = 0
            if flushed is not None and self._sent_inspection:
                flushed += 1

            if not busy:
                if flushed:
                    self.outbox.event("queue_flush", f"ส่งข้อมูลย้อนหลัง {flushed} รายการหลังเน็ตกลับมา")
                flushed = None
                self.outbox.wakeup.wait(5)
                self.outbox.wakeup.clear()


def fmt_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h} ชั่วโมง {m} นาที"
    return f"{m} นาที {s} วินาที" if m else f"{s} วินาที"


def free_disk_mb(path: Path) -> float:
    return shutil.disk_usage(path).free / 1e6
