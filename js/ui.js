// ส่วนที่ทุกหน้าใช้ร่วมกัน: ไอคอน, sidebar, badge, การจัดรูปแบบวันที่/ตัวเลข

const ICONS = {
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="m2 2 20 20"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  speaker: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 5.6a9 9 0 0 1 0 12.7"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCheck: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// แทน <span data-icon="..."></span> ใน HTML ด้วย SVG
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const $ = (id) => document.getElementById(id);

// ---------- สถานะ / PPE ----------

const STATUS_LABELS = {
  passed: 'ผ่าน',
  failed: 'ไม่ผ่าน',
  undetermined: 'ตรวจไม่ได้',
  online: 'ออนไลน์',
  offline: 'ออฟไลน์',
};

function badge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

// ชื่อคลาสจากโมเดล → ชื่อที่แสดง แก้ให้ตรงกับคลาสใน data.yaml ของโมเดลจริง
const PPE_LABELS = {
  person: 'คน',
  helmet: 'หมวกนิรภัย',
  vest: 'เสื้อสะท้อนแสง',
  gloves: 'ถุงมือ',
  safety_shoes: 'รองเท้านิรภัย',
  long_pants: 'กางเกงขายาว',
  glasses: 'แว่นตานิรภัย',
  mask: 'หน้ากาก',
  // คลาสของโมเดลจริง (pi/hardware.py แปลงชื่อเป็นตัวเล็กคั่นด้วย _)
  protective_apron: 'ผ้ากันเปื้อน',
  sleeve: 'ปลอกแขน',
  jeans: 'กางเกงยีนส์',
  non_jeans_pants: 'กางเกงที่ไม่ใช่ยีนส์',
  safety_glasses: 'แว่นตานิรภัย',
};
const ppeLabel = (cls) => PPE_LABELS[cls] || cls;

function sortedCaptures(r) {
  return [...(r.captures || [])].sort((a, b) => a.attempt_no - b.attempt_no);
}

function attemptsText(r) {
  return `${(r.captures || []).length} / ${MAX_ATTEMPTS} รอบ`;
}

// confidence เฉลี่ยของ PPE ที่เจอในรอบสุดท้าย
function confidenceText(r) {
  const caps = sortedCaptures(r);
  const dets = caps.length ? caps[caps.length - 1].detections || [] : [];
  const ppe = dets.filter((d) => d.class !== 'person');
  const list = ppe.length ? ppe : dets;
  if (!list.length) return '—';
  return (list.reduce((s, d) => s + d.confidence, 0) / list.length).toFixed(2);
}

function missingText(r) {
  return (r.missing_items || []).map(ppeLabel).join(', ') || '—';
}

function isOnline(device) {
  return !!device.last_heartbeat_at && Date.now() - new Date(device.last_heartbeat_at) < OFFLINE_AFTER_MS;
}

const shortId = (id) => '#' + String(id).slice(0, 8).toUpperCase();

// ---------- วันที่ / ตัวเลข ----------

const DATETIME_FMT = new Intl.DateTimeFormat('th-TH', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const fmtDateTime = (iso) => (iso ? DATETIME_FMT.format(new Date(iso)).replace(',', '') : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const fmtDate = (d) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtNum = (n) => Number(n || 0).toLocaleString('th-TH');

function timeAgo(iso) {
  if (!iso) return 'ไม่เคยติดต่อ';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const pad2 = (n) => String(n).padStart(2, '0');
const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function parseDateInput(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ---------- UI ร่วม ----------

const NAV_ITEMS = [
  ['dashboard', 'แดชบอร์ด', 'dashboard', 'dashboard.html'],
  ['history', 'ประวัติการตรวจ', 'history', 'history.html'],
  ['devices', 'อุปกรณ์', 'cpu', 'devices.html'],
  ['alerts', 'แจ้งเตือน', 'bell', 'alerts.html'],
  ['users', 'จัดการผู้ใช้', 'users', 'users.html'],
];
const ROLE_LABELS = { admin: 'ผู้ดูแลระบบ (admin)', viewer: 'ผู้ดูผล (viewer)' };
const TOPBAR_DATE_FMT = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

// แถบด้านบนทุกหน้า: ชื่อหน้า + วันที่ + กระดิ่งแจ้งเตือน (js/alerts.js)
function renderTopbar(active) {
  const main = document.querySelector('.main');
  if (!main || $('topbar')) return;
  const label = NAV_ITEMS.find(([key]) => key === active)?.[1] || '';
  const bar = document.createElement('header');
  bar.className = 'topbar no-print';
  bar.id = 'topbar';
  bar.innerHTML = `
    <div class="topbar-crumb"><span>PPE Inspect</span>${icon('chevronRight')}<strong>${esc(label)}</strong></div>
    <div class="topbar-right">
      <span class="topbar-date">${esc(TOPBAR_DATE_FMT.format(new Date()))}</span>
      <div class="bell-wrap" id="bell-wrap">
        <button class="bell" id="bell" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="bell-panel" aria-label="แจ้งเตือน">
          ${icon('bell')}<span class="bell-count hidden" id="bell-count"></span>
        </button>
        <div class="bell-panel hidden" id="bell-panel" role="dialog" aria-label="แจ้งเตือนล่าสุด"></div>
      </div>
    </div>`;
  main.prepend(bar);
  if (typeof initBell === 'function') initBell();
}

function renderSidebar(active, profile) {
  const email = profile?.email || '';
  const nav = NAV_ITEMS.map(([key, label, ic, href]) => {
    const count = key === 'alerts' ? '<span class="nav-count hidden" id="nav-alert-count"></span>' : '';
    return href
      ? `<a class="nav-item${key === active ? ' active' : ''}" href="${href}"${key === active ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${count}</a>`
      : `<span class="nav-item disabled" title="ยังไม่เปิดใช้งาน">${icon(ic)}<span>${label}</span><small>เร็วๆ นี้</small></span>`;
  }).join('');

  $('sidebar').innerHTML = `
    <div class="brand">
      <span class="brand-logo">${icon('shield')}</span>
      <div><div class="brand-name">PPE Inspect</div><div class="brand-sub">Raspberry Pi 5</div></div>
    </div>
    <div class="nav-label">เมนู</div>
    <nav class="nav">${nav}</nav>
    <div class="sidebar-spacer"></div>
    ${DEMO ? '<div class="demo-note">โหมดตัวอย่าง · ยังไม่ได้เชื่อม Supabase</div>' : ''}
    <div class="user">
      <span class="avatar">${esc(email.slice(0, 2).toUpperCase())}</span>
      <div class="user-info">
        <div class="user-email" title="${esc(email)}">${esc(email)}</div>
        <div class="user-role">${esc(ROLE_LABELS[profile?.role] || profile?.role || '')}</div>
      </div>
      <button class="icon-btn" id="logout" type="button" title="ออกจากระบบ" aria-label="ออกจากระบบ">${icon('logout')}</button>
    </div>`;
  $('logout').addEventListener('click', signOut);
  renderTopbar(active);
  document.body.classList.remove('auth-pending');
}

function inspectionRowHtml(r) {
  const missing = missingText(r);
  return `<tr class="clickable" data-href="inspection.html?id=${encodeURIComponent(r.id)}">
    <td class="strong">${fmtDateTime(r.started_at)}</td>
    <td>${esc(r.devices?.name || '—')}</td>
    <td>${badge(r.status)}</td>
    <td class="text truncate" title="${esc(missing)}">${esc(missing)}</td>
    <td>${attemptsText(r)}</td>
    <td>${esc(r.model_version || '—')}</td>
    <td>${confidenceText(r)}</td>
    <td class="go">${icon('chevronRight')}</td>
  </tr>`;
}

function bindRowLinks(tbody) {
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.href = tr.dataset.href;
  });
}

function showError(container, err) {
  console.error(err);
  container.innerHTML = `<div class="banner banner-danger">${icon('alert')}<span class="grow">โหลดข้อมูลไม่สำเร็จ: ${esc(err?.message || err)}</span></div>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
