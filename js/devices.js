(async () => {
  const profile = await requireAuth();
  renderSidebar('devices', profile);
  hydrateIcons();

  const EVENT_TONES = {
    heartbeat_lost: 'danger',
    camera_error: 'danger',
    speaker_error: 'danger',
    model_error: 'danger',
    network_down: 'warning',
    high_temp: 'warning',
    queue_flush: 'primary',
    boot: 'neutral',
  };

  // สถานะกล้อง/ลำโพง: true = ปกติ, false = ผิดปกติ, null = ไม่ทราบ (เมื่อออฟไลน์ถือว่าไม่ทราบ เพราะค่าเก่า)
  function partStatus(value, online) {
    if (!online || value == null) return ['ไม่ทราบ', 'na'];
    return value ? ['ปกติ', 'ok'] : ['ผิดปกติ', 'bad'];
  }

  function metric(ic, label, value, cls = '') {
    return `<div class="metric">${icon(ic)}<div><div class="metric-label">${label}</div><div class="metric-value ${cls}">${esc(value)}</div></div></div>`;
  }

  function deviceCard(d) {
    const online = isOnline(d);
    const [cam, camCls] = partStatus(d.camera_ok, online);
    const [spk, spkCls] = partStatus(d.speaker_ok, online);
    const temp = online && d.cpu_temp != null ? `${d.cpu_temp}°C` : '—';
    const tempCls = !online || d.cpu_temp == null ? 'na' : d.cpu_temp >= 75 ? 'bad' : '';
    const foot = online
      ? `โมเดล ${d.model_version || '—'} · คิวค้างส่ง ${d.queue_size ?? '—'} รายการ`
      : `ติดต่อครั้งล่าสุด ${fmtDateTime(d.last_heartbeat_at)} · ข้อมูลในคิวจะส่งย้อนหลังเมื่อกลับมาออนไลน์`;

    return `<article class="card">
      <div class="device-head">
        <span class="device-chip ${online ? 'tone-primary' : 'tone-neutral'}">${icon('cpu')}</span>
        <div class="grow"><div class="device-name">${esc(d.name)}</div><div class="device-loc">${esc(d.location || '—')}</div></div>
        ${badge(online ? 'online' : 'offline')}
      </div>
      ${online ? '' : `<div class="banner banner-danger" style="font-size:13px;padding:10px 12px">${icon('alert')}<span class="grow">ไม่ได้รับ heartbeat เกิน ${OFFLINE_AFTER_MS / 60000} นาที</span></div>`}
      <div class="metrics">
        ${metric('thermometer', 'อุณหภูมิ CPU', temp, tempCls)}
        ${metric('activity', 'Heartbeat ล่าสุด', timeAgo(d.last_heartbeat_at), online ? '' : 'bad')}
        ${metric('camera', 'กล้อง', cam, camCls)}
        ${metric('speaker', 'ลำโพง', spk, spkCls)}
      </div>
      <p class="muted small">${esc(foot)}</p>
    </article>`;
  }

  function eventRow(e) {
    const tone = EVENT_TONES[e.type] || 'neutral';
    return `<tr>
      <td class="strong">${fmtDateTime(e.created_at)}</td>
      <td>${esc(e.devices?.name || '—')}</td>
      <td><span class="type-pill tone-${tone}">${esc(e.type)}</span></td>
      <td class="wrap">${esc(e.message)}</td>
    </tr>`;
  }

  async function load() {
    const btn = $('refresh');
    btn.disabled = true;
    try {
      const [devices, events] = await Promise.all([api.devices(), api.events(20)]);
      $('error').innerHTML = '';
      $('devices').innerHTML = devices.length ? devices.map(deviceCard).join('') : '<p class="muted">ยังไม่มีอุปกรณ์ที่ลงทะเบียน</p>';
      $('events').innerHTML = events.length ? events.map(eventRow).join('') : '<tr><td colspan="4" class="empty">ยังไม่มีเหตุการณ์</td></tr>';
      $('updated').textContent = 'อัปเดต ' + fmtTime(new Date().toISOString());
    } catch (err) {
      showError($('error'), err);
    } finally {
      btn.disabled = false;
    }
  }

  $('refresh').addEventListener('click', load);
  await load();
  const reload = debounce(load, 1000);
  api.subscribe('devices', reload);
  api.subscribe('device_events', reload);
  setInterval(load, 30 * 1000);
})();
