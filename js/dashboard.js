(async () => {
  const profile = await requireAuth();
  renderSidebar('dashboard', profile);
  hydrateIcons();

  const REPEAT_FAIL_WINDOW_MS = 10 * 60 * 1000;
  const REPEAT_FAIL_COUNT = 3;
  let chart = null;

  const recentBody = $('recent-body');
  bindRowLinks(recentBody);

  async function load() {
    const today = startOfDay(new Date());
    const yesterday = addDays(today, -1);
    $('today-label').textContent = 'ภาพรวมการตรวจ PPE วันนี้ · ' + fmtDate(today);
    $('export-link').href = `history.html?from=${toDateInput(today)}&to=${toDateInput(today)}`;

    try {
      const [todayRes, yesterdayRes, devices, recent] = await Promise.all([
        api.inspections({ from: today, select: 'summary' }),
        api.inspections({ from: yesterday, to: today, countOnly: true }),
        api.devices(),
        api.inspections({ page: 1, pageSize: 5 }),
      ]);
      $('error').innerHTML = '';
      renderStats(todayRes.rows, yesterdayRes.count);
      renderDevicePill(devices);
      renderBanners(todayRes.rows, devices);
      renderChart(todayRes.rows);
      renderMissing(todayRes.rows);
      renderRecent(recent.rows);
    } catch (err) {
      showError($('error'), err);
    }
  }

  function countBy(rows) {
    const c = { passed: 0, failed: 0, undetermined: 0 };
    rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }

  function tallyMissing(rows) {
    const t = {};
    rows.filter((r) => r.status === 'failed')
      .forEach((r) => (r.missing_items || []).forEach((m) => { t[m] = (t[m] || 0) + 1; }));
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }

  function renderStats(rows, yesterdayCount) {
    const total = rows.length;
    const c = countBy(rows);

    $('stat-total').textContent = fmtNum(total);
    if (yesterdayCount > 0) {
      const delta = Math.round(((total - yesterdayCount) / yesterdayCount) * 100);
      $('cap-total').textContent = `${delta >= 0 ? '+' : ''}${delta}% จากเมื่อวาน (${fmtNum(yesterdayCount)} ครั้ง)`;
    } else {
      $('cap-total').textContent = 'ไม่มีข้อมูลของเมื่อวาน';
    }

    $('stat-rate').textContent = total ? `${((c.passed / total) * 100).toFixed(1)}%` : '—';
    $('cap-rate').textContent = `ผ่าน ${fmtNum(c.passed)} จาก ${fmtNum(total)} ครั้ง`;

    $('stat-failed').textContent = fmtNum(c.failed);
    const top = tallyMissing(rows)[0];
    $('cap-failed').textContent = top ? `ขาดบ่อยสุด: ${ppeLabel(top[0])}` : 'ยังไม่มีรายการที่ไม่ผ่าน';

    $('stat-und').textContent = fmtNum(c.undetermined);
  }

  function renderDevicePill(devices) {
    const pill = $('device-pill');
    if (!devices.length) {
      pill.textContent = 'ยังไม่มีอุปกรณ์';
      return;
    }
    if (devices.length === 1) {
      const d = devices[0];
      pill.innerHTML = `${badge(isOnline(d) ? 'online' : 'offline')}${esc(d.name)} · heartbeat ${timeAgo(d.last_heartbeat_at)}`;
      return;
    }
    const online = devices.filter(isOnline).length;
    const cls = online === devices.length ? 'online' : 'offline';
    pill.innerHTML = `<span class="badge badge-${cls}">ออนไลน์ ${online} / ${devices.length} เครื่อง</span>`;
  }

  function renderBanners(rows, devices) {
    const names = Object.fromEntries(devices.map((d) => [d.id, d.name]));
    const since = Date.now() - REPEAT_FAIL_WINDOW_MS;
    const recentFails = {};
    rows.filter((r) => r.status === 'failed' && new Date(r.started_at) >= since)
      .forEach((r) => { recentFails[r.device_id] = (recentFails[r.device_id] || 0) + 1; });

    const html = [];
    for (const [deviceId, n] of Object.entries(recentFails)) {
      if (n < REPEAT_FAIL_COUNT) continue;
      html.push(`<div class="banner banner-warning">${icon('alert')}
        <span class="grow">${esc(names[deviceId] || 'จุดตรวจ')} ไม่ผ่านซ้ำ ${n} ครั้งในช่วง 10 นาทีที่ผ่านมา</span>
        <a class="link" href="history.html?status=failed&device=${encodeURIComponent(deviceId)}&from=${toDateInput(new Date())}">ดูรายละเอียด</a></div>`);
    }
    for (const d of devices.filter((x) => !isOnline(x))) {
      html.push(`<div class="banner banner-danger">${icon('cpu')}
        <span class="grow">${esc(d.name)} ขาดการติดต่อ · heartbeat ล่าสุด ${timeAgo(d.last_heartbeat_at)}</span>
        <a class="link" href="devices.html">ดูอุปกรณ์</a></div>`);
    }
    $('banners').innerHTML = html.join('');
  }

  function renderChart(rows) {
    const canvas = $('hourly-chart');
    if (!window.Chart) {
      canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'โหลด Chart.js ไม่สำเร็จ' }));
      return;
    }
    const hours = rows.map((r) => new Date(r.started_at).getHours());
    const minH = Math.min(7, ...hours);
    const maxH = Math.max(18, ...hours);
    const labels = [];
    const series = { passed: [], failed: [], undetermined: [] };
    for (let h = minH; h <= maxH; h++) {
      labels.push(`${pad2(h)}:00`);
      for (const k of Object.keys(series)) series[k].push(0);
    }
    rows.forEach((r) => {
      const i = new Date(r.started_at).getHours() - minH;
      if (series[r.status]) series[r.status][i] += 1;
    });

    const css = getComputedStyle(document.documentElement);
    const color = (v) => css.getPropertyValue(v).trim();
    const datasets = [
      { label: 'ผ่าน', data: series.passed, backgroundColor: color('--success') },
      { label: 'ไม่ผ่าน', data: series.failed, backgroundColor: color('--danger') },
      { label: 'ตรวจไม่ได้', data: series.undetermined, backgroundColor: color('--warning') },
    ].map((d) => ({ ...d, stack: 'all', borderRadius: 4, maxBarThickness: 28 }));

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets.forEach((d, i) => { d.data = datasets[i].data; });
      chart.update();
      return;
    }
    Chart.defaults.font.family = color('--font');
    chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: color('--subtle') } },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { precision: 0, color: color('--subtle') },
            grid: { color: color('--neutral-soft') },
            border: { display: false },
          },
        },
      },
    });
  }

  function renderMissing(rows) {
    const list = tallyMissing(rows).slice(0, 5);
    if (!list.length) {
      $('missing-list').innerHTML = '<p class="muted">ยังไม่มีรายการที่ไม่ผ่านในวันนี้</p>';
      return;
    }
    const max = list[0][1];
    $('missing-list').innerHTML = list.map(([cls, n]) => `
      <div class="bar-row">
        <div class="bar-row-head"><span>${esc(ppeLabel(cls))}</span><span>${fmtNum(n)} ครั้ง</span></div>
        <div class="track"><div style="width:${(n / max) * 100}%"></div></div>
      </div>`).join('');
  }

  function renderRecent(rows) {
    recentBody.innerHTML = rows.length
      ? rows.map(inspectionRowHtml).join('')
      : '<tr><td colspan="8" class="empty">ยังไม่มีการตรวจ</td></tr>';
  }

  await load();
  const reload = debounce(load, 1000);
  api.subscribe('inspections', reload);
  api.subscribe('devices', reload);
  setInterval(load, 60 * 1000);
})();
