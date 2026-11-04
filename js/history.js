(async () => {
  const profile = await requireAuth();
  renderSidebar('history', profile);
  hydrateIcons();

  const PAGE_SIZE = 10;
  const EXPORT_LIMIT = 5000;
  const TABS = [['', 'ทั้งหมด', 'all'], ['passed', 'ผ่าน', 'passed'], ['failed', 'ไม่ผ่าน', 'failed'], ['undetermined', 'ตรวจไม่ได้', 'undetermined']];

  const params = new URLSearchParams(location.search);
  const defaultFrom = toDateInput(addDays(new Date(), -6));
  const defaultTo = toDateInput(new Date());
  const state = {
    q: params.get('q') || '',
    from: params.get('from') || defaultFrom,
    to: params.get('to') || defaultTo,
    device: params.get('device') || '',
    status: params.get('status') || '',
    page: Math.max(1, parseInt(params.get('page'), 10) || 1),
  };

  const tbody = $('rows');
  bindRowLinks(tbody);

  try {
    const devices = await api.devices();
    $('f-device').insertAdjacentHTML('beforeend',
      devices.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join(''));
  } catch (err) {
    showError($('error'), err);
  }

  function syncInputs() {
    $('f-search').value = state.q;
    $('f-from').value = state.from;
    $('f-to').value = state.to;
    $('f-device').value = state.device;
    $('f-status').value = state.status;
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.from !== defaultFrom) p.set('from', state.from);
    if (state.to !== defaultTo) p.set('to', state.to);
    if (state.device) p.set('device', state.device);
    if (state.status) p.set('status', state.status);
    if (state.page > 1) p.set('page', state.page);
    const qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  // ตัวกรองที่ไม่รวมผลตรวจ (ใช้นับจำนวนในแท็บ)
  function baseFilters() {
    return {
      search: state.q.trim(),
      from: state.from ? parseDateInput(state.from) : null,
      to: state.to ? addDays(parseDateInput(state.to), 1) : null,
      deviceId: state.device || null,
    };
  }

  function rangeLabel() {
    if (state.from && state.to) {
      return state.from === state.to ? fmtDate(parseDateInput(state.from)) : `${fmtDate(parseDateInput(state.from))} – ${fmtDate(parseDateInput(state.to))}`;
    }
    if (state.from) return 'ตั้งแต่ ' + fmtDate(parseDateInput(state.from));
    if (state.to) return 'ถึง ' + fmtDate(parseDateInput(state.to));
    return 'ทุกช่วงเวลา';
  }

  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    syncUrl();
    tbody.innerHTML = '<tr><td colspan="8" class="empty">กำลังโหลด…</td></tr>';
    try {
      const f = baseFilters();
      const [counts, res] = await Promise.all([
        api.countByStatus(f),
        api.inspections({ ...f, status: state.status || null, page: state.page, pageSize: PAGE_SIZE }),
      ]);
      if (seq !== loadSeq) return; // มีคำขอใหม่กว่าแล้ว
      $('error').innerHTML = '';
      $('sub').textContent = `ทั้งหมด ${fmtNum(counts.all)} รายการ · ${rangeLabel()}`;
      renderTabs(counts);
      tbody.innerHTML = res.rows.length
        ? res.rows.map(inspectionRowHtml).join('')
        : '<tr><td colspan="8" class="empty">ไม่พบการตรวจตามตัวกรองนี้</td></tr>';
      renderPagination(res.count);
    } catch (err) {
      if (seq !== loadSeq) return;
      tbody.innerHTML = '<tr><td colspan="8" class="empty">โหลดข้อมูลไม่สำเร็จ</td></tr>';
      showError($('error'), err);
    }
  }

  function renderTabs(counts) {
    $('tabs').innerHTML = TABS.map(([value, label, key]) => `
      <button class="tab${state.status === value ? ' active' : ''}" type="button" role="tab"
        aria-selected="${state.status === value}" data-status="${value}">
        ${label}<small>${fmtNum(counts[key])}</small>
      </button>`).join('');
  }

  function renderPagination(count) {
    const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const start = count ? (state.page - 1) * PAGE_SIZE + 1 : 0;
    const end = Math.min(count, state.page * PAGE_SIZE);
    $('page-info').textContent = `แสดง ${fmtNum(start)}–${fmtNum(end)} จาก ${fmtNum(count)} รายการ`;

    const nums = new Set([1, pages, state.page - 1, state.page, state.page + 1].filter((n) => n >= 1 && n <= pages));
    const sorted = [...nums].sort((a, b) => a - b);
    let html = `<button class="page-btn" type="button" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''} aria-label="หน้าก่อนหน้า">${icon('chevronLeft')}</button>`;
    sorted.forEach((n, i) => {
      if (i > 0 && n - sorted[i - 1] > 1) html += '<span class="page-gap">…</span>';
      html += `<button class="page-btn${n === state.page ? ' active' : ''}" type="button" data-page="${n}"${n === state.page ? ' aria-current="page"' : ''}>${n}</button>`;
    });
    html += `<button class="page-btn" type="button" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''} aria-label="หน้าถัดไป">${icon('chevronRight')}</button>`;
    $('pages').innerHTML = html;
  }

  function update(changes) {
    Object.assign(state, changes, { page: changes.page ?? 1 });
    syncInputs();
    load();
  }

  $('f-search').addEventListener('input', debounce((e) => update({ q: e.target.value }), 350));
  $('f-from').addEventListener('change', (e) => update({ from: e.target.value }));
  $('f-to').addEventListener('change', (e) => update({ to: e.target.value }));
  $('f-device').addEventListener('change', (e) => update({ device: e.target.value }));
  $('f-status').addEventListener('change', (e) => update({ status: e.target.value }));
  $('f-clear').addEventListener('click', () => update({ q: '', from: defaultFrom, to: defaultTo, device: '', status: '' }));
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (b) update({ status: b.dataset.status });
  });
  $('pages').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) update({ page: Number(b.dataset.page) });
  });

  $('export-csv').addEventListener('click', async () => {
    const btn = $('export-csv');
    btn.disabled = true;
    try {
      const { rows, count } = await api.inspections({
        ...baseFilters(), status: state.status || null, page: 1, pageSize: EXPORT_LIMIT,
      });
      const header = ['inspection_id', 'started_at', 'ended_at', 'device', 'status', 'missing_items', 'attempts', 'model_version', 'confidence'];
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = rows.map((r) => [
        r.id, r.started_at, r.ended_at, r.devices?.name, STATUS_LABELS[r.status] || r.status,
        (r.missing_items || []).map(ppeLabel).join(' | '), (r.captures || []).length, r.model_version, confidenceText(r),
      ].map(cell).join(','));
      // ใส่ BOM ให้ Excel อ่านภาษาไทยได้
      downloadFile(`ppe-inspections_${state.from || 'all'}_${state.to || 'all'}.csv`,
        '﻿' + [header.join(','), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
      if (count > EXPORT_LIMIT) {
        $('error').innerHTML = `<div class="banner banner-warning">${icon('alert')}<span class="grow">ส่งออกได้สูงสุด ${fmtNum(EXPORT_LIMIT)} รายการ จากทั้งหมด ${fmtNum(count)} รายการ กรุณาแคบช่วงวันที่ลง</span></div>`;
      }
    } catch (err) {
      showError($('error'), err);
    } finally {
      btn.disabled = false;
    }
  });

  // Export PDF ใช้หน้าพิมพ์ของเบราว์เซอร์ (เลือก "Save as PDF") พร้อม print CSS ที่ซ่อนเมนูและตัวกรอง
  $('export-pdf').addEventListener('click', () => window.print());

  syncInputs();
  load();
})();
