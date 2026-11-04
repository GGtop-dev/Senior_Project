// หน้าแจ้งเตือน: แถบข้อมูลพนักงานวันนี้ + รายการแจ้งเตือนพร้อมตัวกรอง
// การสร้างแจ้งเตือนและสถานะอ่านแล้วอยู่ใน js/alerts.js (ใช้ร่วมกับกระดิ่ง)

(async () => {
  const profile = await requireAuth();
  renderSidebar('alerts', profile);
  hydrateIcons();

  const state = { type: 'all', deviceId: '', rangeHours: 24, alerts: [], devices: [] };
  const PEOPLE_CARDS_MAX = 6;

  // ---------- แถบข้อมูลพนักงาน ----------

  function renderPeople(rows) {
    const byEmp = new Map();
    let unidentified = 0;
    for (const r of rows) {
      if (!r.employee_id) {
        unidentified++;
        continue;
      }
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, { emp: r.employees || {}, fails: 0, missing: {} });
      const e = byEmp.get(r.employee_id);
      if (r.status === 'failed') {
        e.fails++;
        (r.missing_items || []).forEach((m) => { e.missing[m] = (e.missing[m] || 0) + 1; });
      }
    }
    const people = [...byEmp.values()];
    const failedPeople = people.filter((p) => p.fails > 0).sort((a, b) => b.fails - a.fails);
    const stats = [
      [people.length, 'พนักงานที่ตรวจแล้ว', ''],
      [people.length - failedPeople.length, 'ผ่านครบ', 'color:var(--success)'],
      [failedPeople.length, 'ไม่ผ่าน', 'color:#B91C1C'],
      [failedPeople.filter((p) => p.fails >= REPEAT_FAIL_COUNT).length, `ไม่ผ่านซ้ำ (${REPEAT_FAIL_COUNT} ครั้งขึ้นไป)`, 'color:#B45309'],
      [unidentified, 'ระบุตัวไม่ได้ (ครั้ง)', 'color:#475569'],
    ];
    $('people-stats').innerHTML = stats
      .map(([n, label, style]) => `<div class="people-stat"><b style="${style}">${fmtNum(n)}</b><span>${label}</span></div>`)
      .join('');
    $('people-updated').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

    if (!people.length) {
      $('people-cards').innerHTML = `<p class="people-empty">ยังไม่มีข้อมูลพนักงานวันนี้ ต้องเปิดระบบระบุตัวตนด้วยใบหน้าก่อน ตอนนี้การตรวจทั้งหมด ${fmtNum(unidentified)} ครั้งยังระบุตัวไม่ได้</p>`;
      return;
    }
    if (!failedPeople.length) {
      $('people-cards').innerHTML = '<p class="people-empty">วันนี้ยังไม่มีพนักงานที่ไม่ผ่าน</p>';
      return;
    }
    $('people-cards').innerHTML = failedPeople.slice(0, PEOPLE_CARDS_MAX).map((p) => {
      const name = p.emp.name || 'ไม่ทราบชื่อ';
      const top = Object.entries(p.missing).sort((a, b) => b[1] - a[1])[0]?.[0];
      const sub = [p.emp.employee_code, p.emp.department].filter(Boolean).join(' · ');
      const color = p.fails >= REPEAT_FAIL_COUNT ? '#B91C1C' : '#B45309';
      return `<div class="person">
        <span class="avatar" style="background:${color}">${esc(name.slice(0, 2))}</span>
        <span class="person-main"><span class="person-name">${esc(name)}</span><span class="person-sub">${esc(sub || '—')}</span></span>
        <span class="person-fails" style="color:${color}">ไม่ผ่าน ${fmtNum(p.fails)} ครั้ง${top ? `<span class="miss-tag">${esc(ppeLabel(top))}</span>` : ''}</span>
      </div>`;
    }).join('');
  }

  // ---------- รายการแจ้งเตือน ----------

  function renderChips(list) {
    const counts = { all: list.length };
    list.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1; });
    const chips = [['all', 'ทั้งหมด'], ...Object.entries(ALERT_TYPES).map(([k, t]) => [k, t.label])];
    $('type-chips').innerHTML = chips.map(([k, label]) =>
      `<button class="chip" type="button" data-type="${k}" aria-pressed="${state.type === k}">${label} <b>${fmtNum(counts[k] || 0)}</b></button>`).join('');
  }

  function rowHtml(a, unread) {
    const meta = [a.deviceName, fmtDateTime(a.at)].filter(Boolean).map(esc).join('<span aria-hidden="true">•</span>');
    return `<div class="alert-row${unread ? ' unread' : ''}">
      <span class="unread-dot"${unread ? ' role="img" aria-label="ยังไม่อ่าน"' : ' aria-hidden="true"'}></span>
      ${alertIconHtml(a)}
      <div class="alert-body">
        <div class="alert-title">${esc(a.title)}</div>
        ${a.detail ? `<div class="alert-detail">${esc(a.detail)}</div>` : ''}
        ${missingTagsHtml(a)}
        <div class="alert-meta">${meta}</div>
      </div>
      <a class="alert-link" href="${esc(a.href)}">${esc(a.linkText)}</a>
    </div>`;
  }

  function render() {
    const byDevice = state.alerts.filter((a) => !state.deviceId || a.deviceId === state.deviceId);
    renderChips(byDevice);
    const list = byDevice.filter((a) => state.type === 'all' || a.type === state.type);
    const seenAt = alertsSeenAt();
    const fresh = list.filter((a) => isUnread(a, seenAt));
    const old = list.filter((a) => !isUnread(a, seenAt));
    $('read-all').disabled = !state.alerts.some((a) => isUnread(a, seenAt));

    if (!list.length) {
      $('alert-list').innerHTML = '<p class="empty">ไม่มีแจ้งเตือนในช่วงเวลานี้</p>';
      return;
    }
    $('alert-list').innerHTML =
      (fresh.length ? `<div class="alert-group">ใหม่ · ${fmtNum(fresh.length)}</div>${fresh.map((a) => rowHtml(a, true)).join('')}` : '') +
      (old.length ? `<div class="alert-group">ก่อนหน้านี้</div>${old.map((a) => rowHtml(a, false)).join('')}` : '');
  }

  function renderDeviceOptions() {
    const sel = $('device-filter');
    const keep = state.deviceId;
    sel.innerHTML = '<option value="">ทุกจุดตรวจ</option>' +
      state.devices.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    sel.value = state.devices.some((d) => d.id === keep) ? keep : '';
    state.deviceId = sel.value;
  }

  async function load() {
    const from = new Date(Date.now() - state.rangeHours * 60 * 60 * 1000);
    try {
      const [{ alerts, devices }, today] = await Promise.all([
        loadAlerts(from),
        api.inspections({ from: startOfDay(new Date()), select: 'people' }),
      ]);
      $('error').innerHTML = '';
      state.alerts = alerts;
      state.devices = devices;
      renderDeviceOptions();
      renderPeople(today.rows);
      render();
    } catch (err) {
      showError($('error'), err);
    }
  }

  // ---------- events ----------

  $('type-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    state.type = b.dataset.type;
    render();
  });
  $('device-filter').addEventListener('change', (e) => {
    state.deviceId = e.target.value;
    render();
  });
  $('range-filter').addEventListener('change', (e) => {
    state.rangeHours = Number(e.target.value);
    load();
  });
  $('read-all').addEventListener('click', () => markAlertsSeen());
  window.addEventListener('ppe:alerts-seen', render);
  window.addEventListener('storage', (e) => { if (e.key === ALERT_SEEN_KEY) render(); });

  const reload = debounce(load, 1000);
  api.subscribe('inspections', reload);
  api.subscribe('device_events', reload);
  setInterval(load, 60 * 1000);

  await load();
})();
