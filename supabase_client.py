"""เรียก Supabase ผ่าน REST ตรงๆ (Auth, PostgREST, Storage) ใช้แค่ requests"""
import logging
import threading
import time

import requests

log = logging.getLogger(__name__)


class NetworkError(Exception):
    """เน็ตหลุดหรือเซิร์ฟเวอร์ไม่ตอบ ลองใหม่ภายหลังได้"""


class ApiError(Exception):
    """เซิร์ฟเวอร์ปฏิเสธคำขอ (4xx) ส่งซ้ำแบบเดิมก็ไม่ผ่าน"""

    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status = status
        self.body = body


class Supabase:
    def __init__(self, url: str, anon_key: str, email: str, password: str, timeout: float = 20):
        self.url = url.rstrip("/")
        self.key = anon_key
        self.email = email
        self.password = password
        self.timeout = timeout
        self.http = requests.Session()
        self._lock = threading.Lock()
        self._token = None
        self._refresh = None
        self._expires_at = 0.0
        self.user_id = None

    # ---------- Auth ----------

    def _auth(self, grant: str, body: dict) -> None:
        r = self._send("POST", f"/auth/v1/token?grant_type={grant}", json=body, auth=False)
        d = r.json()
        self._token = d["access_token"]
        self._refresh = d["refresh_token"]
        self._expires_at = time.time() + int(d.get("expires_in", 3600))
        self.user_id = d["user"]["id"]

    def token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._expires_at - 60:
                return self._token
            if self._refresh:
                try:
                    self._auth("refresh_token", {"refresh_token": self._refresh})
                    return self._token
                except ApiError as e:
                    log.warning("ต่ออายุ token ไม่สำเร็จ จะ login ใหม่: %s", e)
            self._auth("password", {"email": self.email, "password": self.password})
            log.info("login บัญชีอุปกรณ์ %s แล้ว", self.email)
            return self._token

    def _send(self, method, path, auth=True, headers=None, _retry=True, **kw):
        h = {"apikey": self.key}
        if auth:
            h["Authorization"] = "Bearer " + self.token()
        h.update(headers or {})
        try:
            r = self.http.request(method, self.url + path, headers=h, timeout=self.timeout, **kw)
        except requests.RequestException as e:
            raise NetworkError(str(e)) from e
        if r.status_code >= 500 or r.status_code == 429:
            raise NetworkError(f"HTTP {r.status_code}: {r.text[:200]}")
        if auth and _retry and (r.status_code == 401 or "jwt expired" in r.text.lower()):
            with self._lock:
                self._expires_at = 0  # บังคับขอ token ใหม่
            return self._send(method, path, auth, headers, _retry=False, **kw)
        if r.status_code >= 400:
            raise ApiError(r.status_code, r.text)
        return r

    # ---------- Database ----------

    def insert(self, table: str, row: dict) -> bool:
        """คืน True ถ้าเพิ่มใหม่, False ถ้ามีแถวนี้อยู่แล้ว (ส่งซ้ำจากคิว)"""
        try:
            self._send("POST", f"/rest/v1/{table}", json=row, headers={"Prefer": "return=minimal"})
            return True
        except ApiError as e:
            if e.status == 409 and "23505" in e.body:  # unique_violation
                return False
            raise

    def select(self, table: str, params: dict) -> list:
        return self._send("GET", f"/rest/v1/{table}", params=params).json()

    def rpc(self, fn: str, args: dict) -> None:
        self._send("POST", f"/rest/v1/rpc/{fn}", json=args)

    # ---------- Storage ----------

    def upload(self, bucket: str, path: str, data: bytes, content_type: str = "image/jpeg") -> bool:
        """คืน True ถ้าอัปโหลดใหม่, False ถ้ามีไฟล์นี้อยู่แล้ว"""
        try:
            self._send(
                "POST", f"/storage/v1/object/{bucket}/{path}", data=data,
                headers={"Content-Type": content_type, "x-upsert": "false"},
            )
            return True
        except ApiError as e:
            body = e.body.lower()
            if e.status == 409 or "already exists" in body or "duplicate" in body:
                return False
            raise
