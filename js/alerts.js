// แจ้งเตือนในเว็บ: สร้างรายการแจ้งเตือนจากข้อมูลที่มีอยู่ และกระดิ่งบนแถบด้านบนของทุกหน้า
// ไม่มีตารางแจ้งเตือนแยก (แบบ ก): คำนวณจาก inspections, devices และ device_events ทุกครั้ง
// สถานะ "อ่านแล้ว" เก็บเป็นเวลาล่าสุดที่กดอ่านใน localStorage ของแต่ละเบราว์เซอร์
// ต้องโหลดหลัง supabase.js และ ui.js

const REPEAT_FAIL_WINDOW_MS = 10 * 60 * 1000;
const REPEAT_FAIL_COUNT = 3;
const BELL_RANGE_MS = 24 * 60 * 60 * 1000;
const BELL_REFRESH_MS = 60 * 1000;
const BELL_MAX_ITEMS = 5;
const ALERT_SEEN_KEY = 'ppe.alerts.seenAt';
const ALERT_EVENT_TYPES = ['camera_error', 'speaker_error'];

const ALERT_TYPES = {
  repeat_fail: { label: 'ไม่ผ่านซ้ำ', icon: 'alert', tone: 'danger' },
  offline: { label: 'ขาดการติดต่อ', icon: 'cpu', tone: 'danger' },
  camera: { label: 'กล้องเสีย', icon: 'camera', tone: 'warning' },
  speaker: { label: 'ลำโพงเสีย', icon: 'speaker', tone: 'warning' },
};

// ---------- อ่านแล้ว ----------

function alertsSeenAt() {
  try {
    return Number(localStorage.getItem(ALERT_SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markAlertsSeen(at = Date.now()) {
  try { localStorage.setItem(ALERT_SEEN_KEY, String(at)); } catch { /* private mode: อ่านแล้วไม่ถูกจำ */ }
  window.dispatchEvent(new CustomEvent('ppe:alerts-seen'));
}

const isUnread = (a, seenAt = alertsSeenAt()) => new Date(a.at).getTime() > seenAt;

// ---------- สร้างรายการแจ้งเตือน ----------

// failed: inspections ที่ไม่ผ่าน (select 'people'); devices: ทุกเครื่อง; events: device_events ประเภทกล้อง/ลำโพง
// คืนรายการเรียงจากใหม่ไปเก่า: { id, type, title, detail, missing, deviceId, deviceName, at, href, linkText }
function buildAlerts({ failed = [], devices = [], events = [], now = Date.now() }) {
  const deviceName = Object.fromEntries(devices.map((d) => [d.id, d.name]));
  const alerts = [];

  // ไม่ผ่านซ้ำ: นับแยกต่อพนักงาน (ถ้าระบุตัวได้) หรือต่อจุดตรวจ (ถ้าระบุตัวไม่ได้)
  // ครบ REPEAT_FAIL_COUNT ครั้งภายใน 10 นาที = 1 แจ้งเตือน แล้วเริ่มนับใหม่ เพื่อไม่ให้แจ้งซ้ำทุกครั้งที่ไม่ผ่าน
  const groups = new Map();
  [...failed]
    .filter((r) => r.status === 'failed')
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
    .forEach((r) => {
      const key = r.employee_id ? 'emp:' + r.employee_id : 'dev:' + r.device_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
  for (const [key, rows] of groups) {
    let win = [];
    for (const r of rows) {
      const t = new Date(r.started_at).getTime();
      win = win.filter((x) => t - new Date(x.started_at).getTime() <= REPEAT_FAIL_WINDOW_MS);
      win.push(r);
      if (win.length < REPEAT_FAIL_COUNT) continue;
      const who = r.employees?.name || (r.employee_id ? 'พนักงาน' : 'ผู้ที่ระบุตัวไม่ได้');
      alerts.push({
        id: `repeat:${key}:${r.id}`,
        type: 'repeat_fail',
        title: `${who} ไม่ผ่านซ้ำ ${win.length} ครั้งใน 10 นาที`,
        detail: '',
        missing: [...new Set(win.flatMap((x) => x.missing_items || []))],
        employeeId: r.employee_id || null,
        deviceId: r.device_id,
        deviceName: deviceName[r.device_id] || '',
        at: r.started_at,
        href: `inspection.html?id=${encodeURIComponent(r.id)}`,
        linkText: 'ดูการตรวจ',
      });
      win = [];
    }
  }

  // ขาดการติดต่อ: สถานะปัจจุบัน แสดงตลอดจนกว่าจะกลับมาออนไลน์ เวลาแจ้ง = ตอนที่เลยเกณฑ์ 3 นาที
  for (const d of devices) {
    if (isOnline(d)) continue;
    const last = d.last_heartbeat_at ? new Date(d.last_heartbeat_at).getTime() : null;
    const at = last ? last + OFFLINE_AFTER_MS : new Date(d.created_at || now).getTime();
    alerts.push({
      id: `offline:${d.id}:${d.last_heartbeat_at || 'never'}`,
      type: 'offline',
      title: `${d.name} ขาดการติดต่อ`,
      detail: last ? `heartbeat ล่าสุด ${timeAgo(d.last_heartbeat_at)}` : 'ยังไม่เคยส่ง heartbeat',
      missing: [],
      deviceId: d.id,
      deviceName: d.name,
      at: new Date(Math.min(at, now)).toISOString(),
      href: 'devices.html',
      linkText: 'ดูอุปกรณ์',
    });
  }

  // กล้อง / ลำโพงเสีย: จาก device_events ที่ Pi ส่งมา
  for (const e of events) {
    const type = e.type === 'camera_error' ? 'camera' : e.type === 'speaker_error' ? 'speaker' : null;
    if (!type) continue;
    const name = e.devices?.name || deviceName[e.device_id] || 'อุปกรณ์';
    alerts.push({
      id: `event:${e.id}`,
      type,
      title: type === 'camera' ? `กล้องของ ${name} อ่านภาพไม่สำเร็จ` : `ลำโพงของ ${name} ไม่ทำงาน`,
      detail: e.message || '',
      missing: [],
      deviceId: e.device_id,
      deviceName: name,
      at: e.created_at,
      href: 'devices.html',
      linkText: 'ดูอุปกรณ์',
    });
  }

  return alerts.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// ดึงข้อมูลแล้วสร้างแจ้งเตือนตั้งแต่ from; คืน { alerts, devices }
async function loadAlerts(from) {
  const [failed, devices, events] = await Promise.all([
    api.inspections({ from, status: 'failed', select: 'people' }),
    api.devices(),
    api.eventsSince(from, ALERT_EVENT_TYPES),
  ]);
  return { alerts: buildAlerts({ failed: failed.rows, devices, events }), devices };
}

// ---------- HTML ที่หน้าแจ้งเตือนและกระดิ่งใช้ร่วมกัน ----------

function alertIconHtml(a, size = '') {
  const t = ALERT_TYPES[a.type];
  return `<span class="alert-icon tone-${t.tone}${size}">${icon(t.icon)}</span>`;
}

function missingTagsHtml(a) {
  return a.missing.length
    ? `<span class="miss-tags">${a.missing.map((m) => `<span class="miss-tag">${esc(ppeLabel(m))}</span>`).join('')}</span>`
    : '';
}

// ---------- กระดิ่ง ----------

let bellState = { alerts: [], error: null, loaded: false };

function renderBell() {
  const btn = $('bell');
  if (!btn) return;
  const seenAt = alertsSeenAt();
  const unread = bellState.alerts.filter((a) => isUnread(a, seenAt));
  const n = unread.length;
  const label = n > 99 ? '99+' : String(n);

  const count = $('bell-count');
  count.textContent = label;
  count.classList.toggle('hidden', n === 0);
  btn.setAttribute('aria-label', n ? `แจ้งเตือน ${n} รายการใหม่` : 'แจ้งเตือน');
  const nav = $('nav-alert-count');
  if (nav) {
    nav.textContent = label;
    nav.classList.toggle('hidden', n === 0);
  }

  const items = bellState.alerts.slice(0, BELL_MAX_ITEMS);
  let body;
  if (bellState.error) body = `<p class="bell-empty">โหลดแจ้งเตือนไม่สำเร็จ: ${esc(bellState.error.message || bellState.error)}</p>`;
  else if (!bellState.loaded) body = '<p class="bell-empty">กำลังโหลด…</p>';
  else if (!items.length) body = '<p class="bell-empty">ไม่มีแจ้งเตือนใน 24 ชั่วโมงที่ผ่านมา</p>';
  else {
    body = items.map((a) => `
      <a class="bell-item${isUnread(a, seenAt) ? ' unread' : ''}" href="${esc(a.href)}">
        <span class="unread-dot" aria-hidden="true"></span>
        ${alertIconHtml(a, ' sm')}
        <span class="bell-text">
          <span class="bell-title">${esc(a.title)}</span>
          ${a.missing.length ? `<span class="bell-detail">ขาด${esc(a.missing.map(ppeLabel).join(', '))}</span>` : a.detail ? `<span class="bell-detail">${esc(a.detail)}</span>` : ''}
          <span class="bell-meta">${esc(a.deviceName)} · ${timeAgo(a.at)}</span>
        </span>
      </a>`).join('');
  }

  $('bell-panel').innerHTML = `
    <div class="bell-head">
      <span class="bell-head-title">แจ้งเตือน${n ? ` <span class="bell-new">${label} ใหม่</span>` : ''}</span>
      <button class="link" type="button" id="bell-read-all"${n ? '' : ' disabled'}>อ่านแล้วทั้งหมด</button>
    </div>
    <div class="bell-list">${body}</div>
    <a class="bell-foot" href="alerts.html">ดูแจ้งเตือนทั้งหมด${icon('chevronRight')}</a>`;
  $('bell-read-all').addEventListener('click', () => markAlertsSeen());
}

async function refreshBell() {
  try {
    const { alerts } = await loadAlerts(new Date(Date.now() - BELL_RANGE_MS));
    bellState = { alerts, error: null, loaded: true };
  } catch (err) {
    console.error(err);
    bellState = { ...bellState, error: err, loaded: true };
  }
  renderBell();
}

function setBellOpen(open) {
  $('bell-panel').classList.toggle('hidden', !open);
  $('bell').setAttribute('aria-expanded', String(open));
}

// เรียกจาก renderSidebar หลังสร้างแถบด้านบนแล้ว
function initBell() {
  const btn = $('bell');
  const wrap = $('bell-wrap');
  if (!btn) return;
  renderBell();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setBellOpen($('bell-panel').classList.contains('hidden'));
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setBellOpen(false);
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setBellOpen(false);
      btn.focus();
    }
  });
  window.addEventListener('ppe:alerts-seen', renderBell);
  window.addEventListener('storage', (e) => { if (e.key === ALERT_SEEN_KEY) renderBell(); });

  // ไม่ subscribe devices เพราะ heartbeat อัปเดตทุก 30 วินาที ใช้ setInterval ด้านล่างแทน
  const reload = debounce(refreshBell, 1000);
  ['inspections', 'device_events'].forEach((t) => api.subscribe(t, reload));
  setInterval(refreshBell, BELL_REFRESH_MS); // ให้ "ขาดการติดต่อ" ขึ้นแม้ไม่มีข้อมูลใหม่เข้ามา
  refreshBell();
}
