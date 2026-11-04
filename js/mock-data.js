// ข้อมูลตัวอย่างสำหรับ "โหมดตัวอย่าง" (ใช้เมื่อยังไม่ได้ใส่ค่า Supabase ใน js/supabase.js)
// โครงข้อมูลตรงกับตารางใน WED.md: devices, inspections, captures, device_events
(function () {
  let seed = 20261103;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = (weighted) => {
    let r = rnd() * weighted.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of weighted) if ((r -= w) <= 0) return v;
    return weighted[0][0];
  };
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  const jitter = (box) => box.map((v) => Math.min(1, Math.max(0, v + (rnd() - 0.5) * 0.02)));

  const now = new Date();
  const MODEL = 'yolov8n-ppe v4';
  const PPE = ['helmet', 'vest', 'gloves', 'safety_shoes', 'long_pants'];
  // กรอบแบบ normalized [x1, y1, x2, y2]
  const BOXES = {
    person: [0.33, 0.06, 0.63, 0.96],
    helmet: [0.42, 0.06, 0.54, 0.19],
    vest: [0.37, 0.28, 0.6, 0.56],
    gloves: [0.32, 0.52, 0.39, 0.62],
    long_pants: [0.39, 0.57, 0.59, 0.86],
    safety_shoes: [0.38, 0.86, 0.6, 0.95],
  };

  const devices = [
    {
      id: '0b1e6c1a-5d1f-4c55-9a51-0c1d2e3f4a01',
      name: 'Pi-01 · จุดตรวจ A',
      location: 'อาคารผลิต 1 · ประตูทางเข้า',
      last_heartbeat_at: new Date(now - 12 * 1000).toISOString(),
      status: 'online',
      cpu_temp: 52,
      camera_ok: true,
      speaker_ok: true,
      model_version: MODEL,
      queue_size: 0,
    },
    {
      id: '0b1e6c1a-5d1f-4c55-9a51-0c1d2e3f4a02',
      name: 'Pi-02 · จุดตรวจ B',
      location: 'อาคารผลิต 2 · ประตูหลัง',
      last_heartbeat_at: new Date(now - 7 * 60 * 1000).toISOString(),
      status: 'offline',
      cpu_temp: 61,
      camera_ok: false,
      speaker_ok: true,
      model_version: MODEL,
      queue_size: 3,
    },
  ];

  const detection = (cls, conf) => ({
    class: cls,
    confidence: +conf.toFixed(2),
    box: jitter(BOXES[cls]).map((v) => +v.toFixed(3)),
  });

  const inspections = [];
  const capturesByInspection = {};

  for (let day = 6; day >= 0; day--) {
    for (let hour = 7; hour <= 18; hour++) {
      const n = 3 + Math.floor(rnd() * 12);
      for (let k = 0; k < n; k++) {
        const start = new Date(now);
        start.setDate(now.getDate() - day);
        start.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
        // ยังสุ่มต่อแม้เป็นเวลาในอนาคต เพื่อให้รหัสการตรวจของวันเดียวกันคงที่ตลอดวัน
        const future = start > now;

        const status = pick([['passed', 86], ['failed', 11], ['undetermined', 3]]);
        let missing = [];
        if (status === 'failed') {
          missing = [pick([['helmet', 40], ['safety_shoes', 30], ['vest', 20], ['gloves', 10]])];
          if (rnd() < 0.25) {
            const second = pick([['safety_shoes', 50], ['gloves', 30], ['vest', 20]]);
            if (!missing.includes(second)) missing.push(second);
          }
        }
        const attempts = status === 'passed' ? pick([[1, 70], [2, 22], [3, 8]]) : 3;
        const id = uuid();
        const deviceId = day > 0 && rnd() < 0.3 ? devices[1].id : devices[0].id;

        const caps = [];
        for (let a = 1; a <= attempts; a++) {
          let dets;
          if (status === 'undetermined') {
            dets = rnd() < 0.5 ? [detection('person', 0.35 + rnd() * 0.1)] : [];
          } else {
            const absent = new Set(missing);
            // รอบก่อนหน้าของคนที่ผ่านทีหลัง: ยังขาดบางอย่างอยู่
            if (status === 'passed' && a < attempts) absent.add(PPE[Math.floor(rnd() * PPE.length)]);
            dets = [detection('person', 0.9 + rnd() * 0.08)];
            for (const p of PPE) if (!absent.has(p)) dets.push(detection(p, 0.78 + rnd() * 0.19));
          }
          caps.push({
            inspection_id: id,
            attempt_no: a,
            image_path: null,
            detections: dets,
            inference_ms: 160 + Math.floor(rnd() * 60),
            captured_at: new Date(+start + (a - 1) * 9000).toISOString(),
          });
        }
        if (future) continue;
        capturesByInspection[id] = caps;
        inspections.push({
          id,
          device_id: deviceId,
          employee_id: null,
          identity_confidence: null,
          status,
          missing_items: missing,
          model_version: MODEL,
          review: null,
          started_at: start.toISOString(),
          ended_at: new Date(+start + attempts * 9000 + 2000).toISOString(),
        });
      }
    }
  }
  inspections.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  const ago = (min) => new Date(now - min * 60 * 1000).toISOString();
  const events = [
    { id: 1, device_id: devices[1].id, type: 'heartbeat_lost', message: 'ไม่ได้รับ heartbeat เกิน 3 นาที', created_at: ago(4) },
    { id: 2, device_id: devices[0].id, type: 'queue_flush', message: 'ส่งข้อมูลย้อนหลัง 12 รายการหลังเน็ตกลับมา', created_at: ago(19) },
    { id: 3, device_id: devices[0].id, type: 'network_down', message: 'อินเทอร์เน็ตหลุด 1 นาที 52 วินาที · พักข้อมูลในคิว', created_at: ago(21) },
    { id: 4, device_id: devices[0].id, type: 'high_temp', message: 'อุณหภูมิ CPU 78°C เกินเกณฑ์ 75°C', created_at: ago(213) },
    { id: 5, device_id: devices[0].id, type: 'boot', message: 'เริ่มระบบและโหลดโมเดล ' + MODEL, created_at: ago(395) },
    { id: 6, device_id: devices[1].id, type: 'camera_error', message: 'เปิดกล้องไม่สำเร็จ (/dev/video0)', created_at: ago(396) },
  ];

  const profiles = [
    { id: 'p-1', email: 'demo@example.com', role: 'admin', added_by: null, created_at: ago(60 * 24 * 3) },
    { id: 'p-2', email: 'qa.team@example.com', role: 'admin', added_by: 'demo@example.com', created_at: ago(60 * 24 * 2) },
    { id: 'p-3', email: 'supervisor@example.com', role: 'admin', added_by: 'demo@example.com', created_at: ago(60 * 5) },
  ];

  window.MOCK = { devices, inspections, capturesByInspection, events, profiles };
})();
