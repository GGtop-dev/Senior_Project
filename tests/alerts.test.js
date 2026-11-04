// Unit test ของแจ้งเตือน
// ส่วน C: buildAlerts / loadAlerts / อ่านแล้ว (js/alerts.js)
// ส่วน D: กระดิ่ง renderBell (js/alerts.js)
// รหัส test ตรงกับตารางใน tests/README.md

const NOW = Date.now();
const minAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString();
const DEV_A = { id: 'dev-a', name: 'Pi-01 · จุดตรวจ A', last_heartbeat_at: minAgo(0.5) };
const DEV_B = { id: 'dev-b', name: 'Pi-02 · จุดตรวจ B', last_heartbeat_at: minAgo(0.5) };
const EMP_1 = { name: 'สมชาย ใจดี', employee_code: 'EMP-0012', department: 'ผลิต' };

let seq = 0;
function fail(min, extra = {}) {
  seq++;
  return { id: `ins-${seq}`, status: 'failed', missing_items: ['helmet'], started_at: minAgo(min), device_id: DEV_A.id, employee_id: null, employees: null, ...extra };
}
const emp1 = (min, extra = {}) => fail(min, { employee_id: 'emp-1', employees: EMP_1, ...extra });

window.beforeEachTest = () => {
  try { localStorage.removeItem(ALERT_SEEN_KEY); } catch { /* ignore */ }
};

const ofType = (alerts, type) => alerts.filter((a) => a.type === type);

// =====================================================================
// ส่วน C: buildAlerts
// =====================================================================

test('C01 พนักงานคนเดียวไม่ผ่าน 3 ครั้งใน 10 นาที → แจ้งเตือน 1 รายการ', () => {
  const rows = [emp1(9), emp1(5, { missing_items: ['helmet', 'safety_shoes'] }), emp1(1)];
  const alerts = buildAlerts({ failed: rows, devices: [DEV_A] });
  const r = ofType(alerts, 'repeat_fail');
  assertEqual(r.length, 1, 'จำนวนแจ้งเตือน');
  assertEqual(r[0].title, 'สมชาย ใจดี ไม่ผ่านซ้ำ 3 ครั้งใน 10 นาที');
  assertEqual(r[0].missing.sort(), ['helmet', 'safety_shoes'], 'PPE ที่ขาด (รวมทุกครั้ง ไม่ซ้ำ)');
  assertEqual(r[0].href, `inspection.html?id=${rows[2].id}`, 'ลิงก์ไปการตรวจครั้งล่าสุด');
  assertEqual(r[0].at, rows[2].started_at, 'เวลาแจ้ง = ครั้งที่ครบ 3');
  assertEqual(r[0].deviceName, DEV_A.name);
});

test('C02 ไม่ผ่าน 3 ครั้งแต่ห่างเกิน 10 นาที → ไม่แจ้ง', () => {
  const alerts = buildAlerts({ failed: [emp1(30), emp1(15), emp1(1)], devices: [DEV_A] });
  assertEqual(ofType(alerts, 'repeat_fail').length, 0);
});

test('C03 ไม่ผ่านแค่ 2 ครั้ง → ไม่แจ้ง', () => {
  assertEqual(ofType(buildAlerts({ failed: [emp1(3), emp1(1)], devices: [DEV_A] }), 'repeat_fail').length, 0);
});

test('C04 ไม่ผ่าน 6 ครั้งติดกันใน 10 นาที → แจ้ง 2 ครั้ง (ไม่แจ้งทุกครั้งหลังครบ 3)', () => {
  const rows = [6, 5, 4, 3, 2, 1].map((m) => emp1(m));
  assertEqual(ofType(buildAlerts({ failed: rows, devices: [DEV_A] }), 'repeat_fail').length, 2);
});

test('C05 พนักงาน 2 คน คนละ 2 ครั้ง → ไม่แจ้ง (นับแยกคน)', () => {
  const other = { employee_id: 'emp-2', employees: { name: 'คนที่สอง' } };
  const rows = [emp1(4), fail(3, other), emp1(2), fail(1, other)];
  assertEqual(ofType(buildAlerts({ failed: rows, devices: [DEV_A] }), 'repeat_fail').length, 0);
});

test('C06 ระบุตัวไม่ได้ 3 ครั้งที่จุดเดียวกัน → "ผู้ที่ระบุตัวไม่ได้" / แยกสองจุด → ไม่แจ้ง', () => {
  const same = buildAlerts({ failed: [fail(3), fail(2), fail(1)], devices: [DEV_A] });
  assertEqual(ofType(same, 'repeat_fail').length, 1);
  assert(same[0].title.startsWith('ผู้ที่ระบุตัวไม่ได้'), same[0].title);
  const split = buildAlerts({ failed: [fail(3), fail(2, { device_id: DEV_B.id }), fail(1)], devices: [DEV_A, DEV_B] });
  assertEqual(ofType(split, 'repeat_fail').length, 0);
});

test('C07 แถวที่ผ่าน / ตรวจไม่ได้ ไม่ถูกนับ', () => {
  const rows = [emp1(3), emp1(2, { status: 'passed' }), emp1(1, { status: 'undetermined' }), emp1(0.5)];
  assertEqual(ofType(buildAlerts({ failed: rows, devices: [DEV_A] }), 'repeat_fail').length, 0);
});

test('C08 ข้อมูลไม่เรียงเวลา → ยังนับถูก', () => {
  const rows = [emp1(1), emp1(9), emp1(5)];
  assertEqual(ofType(buildAlerts({ failed: rows, devices: [DEV_A] }), 'repeat_fail').length, 1);
});

test('C09 พนักงานมี employee_id แต่ไม่มีชื่อ (embed ว่าง) → ใช้คำว่า "พนักงาน"', () => {
  const rows = [1, 2, 3].map((m) => fail(m, { employee_id: 'emp-9', employees: null }));
  const r = ofType(buildAlerts({ failed: rows, devices: [DEV_A] }), 'repeat_fail');
  assert(r[0].title.startsWith('พนักงาน ไม่ผ่านซ้ำ'), r[0].title);
});

test('C10 เครื่องออฟไลน์ → แจ้ง "ขาดการติดต่อ" เวลา = heartbeat ล่าสุด + 3 นาที / ออนไลน์ → ไม่แจ้ง', () => {
  const off = { id: 'dev-off', name: 'Pi-03', last_heartbeat_at: minAgo(10) };
  const alerts = buildAlerts({ devices: [DEV_A, off] });
  const r = ofType(alerts, 'offline');
  assertEqual(r.length, 1);
  assertEqual(r[0].title, 'Pi-03 ขาดการติดต่อ');
  assert(r[0].detail.includes('heartbeat ล่าสุด'), r[0].detail);
  assertEqual(new Date(r[0].at).getTime(), new Date(off.last_heartbeat_at).getTime() + OFFLINE_AFTER_MS);
});

test('C11 เครื่องที่ไม่เคยส่ง heartbeat → "ยังไม่เคยส่ง heartbeat"', () => {
  const r = ofType(buildAlerts({ devices: [{ id: 'n', name: 'Pi-new', last_heartbeat_at: null, created_at: minAgo(60) }] }), 'offline');
  assertEqual(r[0].detail, 'ยังไม่เคยส่ง heartbeat');
});

test('C12 device_events camera_error / speaker_error → แจ้งเตือน ส่วนประเภทอื่นไม่แจ้ง', () => {
  const events = [
    { id: 1, device_id: DEV_A.id, type: 'camera_error', message: 'อ่านภาพไม่สำเร็จ', created_at: minAgo(5), devices: { name: DEV_A.name } },
    { id: 2, device_id: DEV_B.id, type: 'speaker_error', message: 'ไม่พบอุปกรณ์เสียง', created_at: minAgo(4) },
    { id: 3, device_id: DEV_A.id, type: 'boot', message: 'เริ่มระบบ', created_at: minAgo(3) },
    { id: 4, device_id: DEV_A.id, type: 'high_temp', message: 'ร้อน', created_at: minAgo(2) },
  ];
  const alerts = buildAlerts({ devices: [DEV_A, DEV_B], events });
  assertEqual(alerts.map((a) => a.type), ['speaker', 'camera']);
  assertEqual(alerts[1].title, `กล้องของ ${DEV_A.name} อ่านภาพไม่สำเร็จ`);
  assertEqual(alerts[0].title, `ลำโพงของ ${DEV_B.name} ไม่ทำงาน`, 'ใช้ชื่อจาก devices ถ้า event ไม่มี embed');
  assertEqual(alerts[0].detail, 'ไม่พบอุปกรณ์เสียง');
});

test('C13 รวมทุกประเภท เรียงจากใหม่ไปเก่า และ id ไม่ซ้ำ', () => {
  const alerts = buildAlerts({
    failed: [emp1(20), emp1(19), emp1(18)],
    devices: [DEV_A, { id: 'x', name: 'Pi-X', last_heartbeat_at: minAgo(30) }],
    events: [{ id: 9, device_id: DEV_A.id, type: 'camera_error', created_at: minAgo(1) }],
  });
  const times = alerts.map((a) => new Date(a.at).getTime());
  assertEqual(times, [...times].sort((a, b) => b - a), 'เรียงใหม่ → เก่า');
  assertEqual(new Set(alerts.map((a) => a.id)).size, alerts.length, 'id ไม่ซ้ำ');
});

test('C14 ไม่มีข้อมูลเลย → รายการว่าง', () => {
  assertEqual(buildAlerts({}), []);
});

// ---------- อ่านแล้ว ----------

test('C15 ยังไม่เคยกดอ่าน → ทุกแจ้งเตือนเป็นของใหม่', () => {
  assertEqual(alertsSeenAt(), 0);
  assert(isUnread({ at: minAgo(60 * 24) }));
});

test('C16 markAlertsSeen → เก็บเวลา, แจ้งเตือนเก่ากว่านั้นเป็นอ่านแล้ว และส่ง event ppe:alerts-seen', () => {
  let fired = 0;
  const h = () => fired++;
  window.addEventListener('ppe:alerts-seen', h);
  markAlertsSeen(NOW);
  window.removeEventListener('ppe:alerts-seen', h);
  assertEqual(alertsSeenAt(), NOW);
  assert(!isUnread({ at: minAgo(1) }), 'ก่อนเวลาอ่าน = อ่านแล้ว');
  assert(isUnread({ at: new Date(NOW + 1000).toISOString() }), 'หลังเวลาอ่าน = ใหม่');
  assertEqual(fired, 1, 'event');
});

test('C17 localStorage ใช้ไม่ได้ (private mode) → ไม่ throw และถือว่ายังไม่อ่าน', () => {
  const get = Storage.prototype.getItem;
  const set = Storage.prototype.setItem;
  Storage.prototype.getItem = () => { throw new Error('blocked'); };
  Storage.prototype.setItem = () => { throw new Error('blocked'); };
  try {
    markAlertsSeen(NOW);
    assertEqual(alertsSeenAt(), 0);
  } finally {
    Storage.prototype.getItem = get;
    Storage.prototype.setItem = set;
  }
});

// ---------- loadAlerts ----------

test('C18 loadAlerts ส่ง request ถูก: inspections เฉพาะ failed + ข้อมูลพนักงาน, device_events เฉพาะกล้อง/ลำโพง', async () => {
  fakeSb.respond = (call) => ({ data: call.table === 'devices' ? [DEV_A] : [], error: null, count: 0 });
  const from = new Date(NOW - 24 * 3600 * 1000);
  const { alerts, devices } = await loadAlerts(from);
  assertEqual(alerts, []);
  assertEqual(devices, [DEV_A]);
  const ins = fakeSb.calls.find((c) => c.table === 'inspections');
  const ev = fakeSb.calls.find((c) => c.table === 'device_events');
  assert(ins.ops.some((o) => o[0] === 'eq' && o[1] === 'status' && o[2] === 'failed'), 'กรอง status = failed');
  assert(ins.ops.some((o) => o[0] === 'gte' && o[1] === 'started_at' && o[2] === from.toISOString()), 'กรองเวลา');
  assert(/employees\(/.test(ins.ops.find((o) => o[0] === 'select')[1]), 'ต้อง embed employees');
  assert(ev.ops.some((o) => o[0] === 'in' && o[1] === 'type' && JSON.stringify(o[2]) === JSON.stringify(['camera_error', 'speaker_error'])), 'กรองประเภท event');
  assert(ev.ops.some((o) => o[0] === 'gte' && o[1] === 'created_at'), 'กรองเวลา event');
});

test('C19 loadAlerts: Supabase ตอบ error → throw', async () => {
  fakeSb.respond = (call) => (call.table === 'device_events' ? { data: null, error: { message: 'boom' } } : { data: [], error: null });
  let err = null;
  try { await loadAlerts(new Date(NOW - 3600 * 1000)); } catch (e) { err = e; }
  assertEqual(err?.message, 'boom');
});

// =====================================================================
// ส่วน D: กระดิ่ง
// =====================================================================

function mountBell(alerts, extra = {}) {
  document.getElementById('fixture').innerHTML = `
    <span id="nav-alert-count" class="hidden"></span>
    <button id="bell"><span id="bell-count" class="hidden"></span></button>
    <div id="bell-panel"></div>`;
  bellState = { alerts, error: null, loaded: true, ...extra };
  renderBell();
  return {
    count: $('bell-count'),
    nav: $('nav-alert-count'),
    panel: $('bell-panel'),
    btn: $('bell'),
  };
}
const sampleAlerts = (n, minStart = 1) => Array.from({ length: n }, (_, i) => ({
  id: 'a' + i, type: 'offline', title: `Pi-${i} ขาดการติดต่อ`, detail: '', missing: [],
  deviceName: 'Pi-' + i, at: minAgo(minStart + i), href: 'devices.html', linkText: 'ดูอุปกรณ์',
}));

test('D01 มีแจ้งเตือนใหม่ 3 รายการ → ตัวเลขบนกระดิ่งและเมนูเป็น 3 และ aria-label บอกจำนวน', () => {
  const ui = mountBell(sampleAlerts(3));
  assertEqual(ui.count.textContent, '3');
  assert(!ui.count.classList.contains('hidden'), 'ตัวเลขต้องแสดง');
  assertEqual(ui.nav.textContent, '3');
  assert(!ui.nav.classList.contains('hidden'));
  assertEqual(ui.btn.getAttribute('aria-label'), 'แจ้งเตือน 3 รายการใหม่');
});

test('D02 ไม่มีของใหม่ (อ่านแล้วทั้งหมด) → ซ่อนตัวเลข', () => {
  markAlertsSeen(NOW + 1000);
  const ui = mountBell(sampleAlerts(3));
  assert(ui.count.classList.contains('hidden') && ui.nav.classList.contains('hidden'));
  assertEqual(ui.btn.getAttribute('aria-label'), 'แจ้งเตือน');
  assert($('bell-read-all').disabled, 'ปุ่มอ่านแล้วทั้งหมดต้อง disable');
});

test('D03 เกิน 99 รายการ → แสดง 99+', () => {
  assertEqual(mountBell(sampleAlerts(120)).count.textContent, '99+');
});

test('D04 รายการในกระดิ่งแสดงไม่เกิน 5 รายการ และมีลิงก์ "ดูแจ้งเตือนทั้งหมด"', () => {
  const ui = mountBell(sampleAlerts(8));
  assertEqual(ui.panel.querySelectorAll('.bell-item').length, BELL_MAX_ITEMS);
  assertEqual(ui.panel.querySelector('.bell-foot').getAttribute('href'), 'alerts.html');
});

test('D05 แยกของใหม่ / อ่านแล้วด้วย class unread', () => {
  markAlertsSeen(new Date(minAgo(2.5)).getTime()); // ของที่เกิดหลัง 2.5 นาทีก่อน = ใหม่
  const ui = mountBell(sampleAlerts(4)); // เกิด 1, 2, 3, 4 นาทีก่อน
  const flags = [...ui.panel.querySelectorAll('.bell-item')].map((el) => el.classList.contains('unread'));
  assertEqual(flags, [true, true, false, false]);
  assertEqual(ui.count.textContent, '2');
});

test('D06 กด "อ่านแล้วทั้งหมด" → ตัวเลขหาย และจำใน localStorage', () => {
  const ui = mountBell(sampleAlerts(3));
  window.addEventListener('ppe:alerts-seen', renderBell, { once: true });
  $('bell-read-all').click();
  assert(ui.count.classList.contains('hidden'), 'ตัวเลขต้องหาย');
  assert(alertsSeenAt() > 0, 'ต้องจำเวลาอ่าน');
});

test('D07 ชื่อพนักงาน / ชื่อเครื่องมี HTML → แสดงเป็นข้อความ (XSS)', () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const a = { ...sampleAlerts(1)[0], title: evil, deviceName: evil, href: 'javascript:alert(1)" onclick="window.__xss=1' };
  const ui = mountBell([a]);
  assertEqual(ui.panel.querySelector('img'), null, 'ต้องไม่มี img');
  assert(ui.panel.querySelector('.bell-title').textContent === evil, 'ต้องเห็นเป็นข้อความ');
  assertEqual(ui.panel.querySelector('.bell-item').getAttribute('onclick'), null, 'href ต้องไม่หลุดออกจาก attribute');
  assertEqual(window.__xss, undefined);
});

test('D08 แจ้งเตือนไม่ผ่านซ้ำ แสดง PPE ที่ขาดเป็นภาษาไทย', () => {
  const a = { ...sampleAlerts(1)[0], type: 'repeat_fail', missing: ['helmet', 'safety_shoes'] };
  const ui = mountBell([a]);
  assertEqual(ui.panel.querySelector('.bell-detail').textContent, 'ขาดหมวกนิรภัย, รองเท้านิรภัย');
});

test('D09 โหลดไม่สำเร็จ → แสดงข้อความ error ในกระดิ่ง', () => {
  const ui = mountBell([], { error: new Error('network down') });
  assert(ui.panel.textContent.includes('โหลดแจ้งเตือนไม่สำเร็จ: network down'), ui.panel.textContent);
});

test('D10 ยังไม่มีแจ้งเตือน → ข้อความว่าง', () => {
  const ui = mountBell([]);
  assert(ui.panel.textContent.includes('ไม่มีแจ้งเตือนใน 24 ชั่วโมงที่ผ่านมา'));
});

test('D11 กำลังโหลดครั้งแรก → "กำลังโหลด…"', () => {
  const ui = mountBell([], { loaded: false });
  assert(ui.panel.textContent.includes('กำลังโหลด'));
});

runTests();
