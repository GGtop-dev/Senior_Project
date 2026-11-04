(async () => {
  const profile = await requireAuth();
  renderSidebar('history', profile);
  hydrateIcons();

  const id = new URLSearchParams(location.search).get('id');
  let ins = null;
  try {
    ins = id ? await api.inspection(id) : null;
  } catch (err) {
    showError($('error'), err);
    $('crumb').textContent = 'ผิดพลาด';
    return;
  }
  if (!ins) {
    $('crumb').textContent = 'ไม่พบข้อมูล';
    $('error').innerHTML = `<div class="banner banner-warning">${icon('alert')}<span class="grow">ไม่พบการตรวจนี้ หรือคุณไม่มีสิทธิ์ดู</span><a class="link" href="history.html">กลับไปหน้าประวัติ</a></div>`;
    return;
  }

  const caps = sortedCaptures(ins);
  // PPE ที่ต้องมี = ที่เคยตรวจเจอในรอบใดรอบหนึ่ง + ที่ระบบบันทึกว่าขาด
  const required = new Set(ins.missing_items || []);
  caps.forEach((c) => (c.detections || []).forEach((d) => { if (d.class !== 'person') required.add(d.class); }));

  const urlCache = {};
  const imageUrl = (path) => {
    if (!path) return Promise.resolve(null);
    if (!urlCache[path]) urlCache[path] = api.signedUrl(path).catch((err) => { console.error(err); return null; });
    return urlCache[path];
  };

  const detectedIn = (c) => new Set((c.detections || []).map((d) => d.class));
  const missingIn = (c) => {
    const found = detectedIn(c);
    return [...required].filter((k) => !found.has(k));
  };
  const attemptStatus = (c) => {
    if (!detectedIn(c).has('person')) return 'undetermined';
    return missingIn(c).length ? 'failed' : 'passed';
  };

  // ---------- Header & summary ----------
  $('crumb').textContent = shortId(ins.id);
  document.title = `การตรวจ ${shortId(ins.id)} · PPE Inspect`;
  $('title').innerHTML = `การตรวจ ${esc(shortId(ins.id))} ${badge(ins.status)}`;
  $('sub').textContent = [
    fmtDate(ins.started_at),
    `${fmtTime(ins.started_at)} – ${fmtTime(ins.ended_at)}`,
    ins.devices?.name || 'ไม่ทราบจุดตรวจ',
  ].join(' · ');

  const avgMs = caps.length ? Math.round(caps.reduce((s, c) => s + (c.inference_ms || 0), 0) / caps.length) : null;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
  $('summary').innerHTML = [
    kv('ผลตรวจ', badge(ins.status)),
    kv('PPE ที่ขาด', esc(missingText(ins))),
    kv('จุดตรวจ', esc(ins.devices?.name || '—')),
    kv('พนักงาน', ins.employee_id
      ? esc(ins.employee_id) + (ins.identity_confidence != null ? ` <span class="muted">(${Number(ins.identity_confidence).toFixed(2)})</span>` : '')
      : '<span class="muted">ยังไม่ระบุตัวตน</span>'),
    kv('จำนวนรอบ', attemptsText(ins)),
    kv('รุ่นโมเดล', esc(ins.model_version || '—')),
    kv('เวลาประมวลผล', avgMs != null ? `${avgMs} ms / รอบ` : '—'),
    kv('รหัสการตรวจ', `<span class="small" title="${esc(ins.id)}">${esc(ins.id)}</span>`),
  ].join('');

  // ---------- Capture viewer ----------
  let selected = caps.length - 1;

  async function renderCapture() {
    const box = $('capture');
    const dl = $('download');
    if (!caps.length) {
      $('capture-title').textContent = 'รูปที่ถ่าย';
      box.innerHTML = '<div class="capture-empty">ไม่มีรูปที่บันทึกไว้สำหรับการตรวจนี้</div>';
      $('det-title').textContent = 'ผลตรวจจับ PPE';
      $('detections').innerHTML = '<p class="muted">ไม่มีข้อมูลการตรวจจับ</p>';
      return;
    }
    const c = caps[selected];
    $('capture-title').textContent = `รูปที่ถ่าย · รอบที่ ${c.attempt_no} / ${MAX_ATTEMPTS}`;
    $('det-title').textContent = `ผลตรวจจับ PPE (รอบที่ ${c.attempt_no})`;

    const url = await imageUrl(c.image_path);
    if (caps[selected] !== c) return; // ผู้ใช้เปลี่ยนรอบระหว่างโหลด

    const boxes = (c.detections || []).filter((d) => Array.isArray(d.box)).map((d) => {
      const [x1, y1, x2, y2] = d.box;
      const color = d.class === 'person' ? 'var(--primary)' : 'var(--success)';
      return `<div class="bbox${y1 < 0.06 ? ' label-inside' : ''}" style="--c:${color};left:${x1 * 100}%;top:${y1 * 100}%;width:${(x2 - x1) * 100}%;height:${(y2 - y1) * 100}%">
        <span>${esc(ppeLabel(d.class))} ${Number(d.confidence).toFixed(2)}</span></div>`;
    }).join('');
    const missing = missingIn(c);
    const note = c.image_path
      ? `โหลดผ่าน signed URL · หมดอายุใน ${SIGNED_URL_TTL / 60} นาที`
      : DEMO ? 'โหมดตัวอย่าง · ไม่มีไฟล์รูปจริง' : 'ไม่มีไฟล์รูปของรอบนี้';

    box.innerHTML = `
      ${url ? `<img src="${esc(url)}" alt="รูปจากกล้อง รอบที่ ${c.attempt_no}">` : '<div class="capture-empty"></div>'}
      ${boxes}
      ${missing.length ? `<div class="missing-tags">${missing.map((m) => `<span>ไม่พบ${esc(ppeLabel(m))}</span>`).join('')}</div>` : ''}
      <div class="capture-note">${esc(note)}</div>`;

    if (url) {
      dl.href = url;
      dl.removeAttribute('aria-disabled');
    } else {
      dl.removeAttribute('href');
      dl.setAttribute('aria-disabled', 'true');
    }

    // รายการ PPE ของรอบที่เลือก
    const dets = Object.fromEntries((c.detections || []).map((d) => [d.class, d]));
    const items = [...required];
    $('detections').innerHTML = items.length
      ? items.map((k) => {
        const d = dets[k];
        return `<div class="det${d ? '' : ' missing'}">
          <span class="det-icon ${d ? 'tone-success' : 'tone-danger'}">${icon(d ? 'check' : 'x')}</span>
          <span class="name">${esc(ppeLabel(k))}</span>
          <span class="val">${d ? Number(d.confidence).toFixed(2) : 'ไม่พบ'}</span>
        </div>`;
      }).join('')
      : `<p class="muted">${detectedIn(c).has('person') ? 'ไม่พบ PPE ในรอบนี้' : 'ไม่พบคนในเฟรมอย่างชัดเจน'}</p>`;
  }

  async function renderThumbs() {
    const urls = await Promise.all(caps.map((c) => imageUrl(c.image_path)));
    $('thumbs').innerHTML = caps.map((c, i) => `
      <button class="thumb${i === selected ? ' active' : ''}" type="button" data-i="${i}">
        <span class="thumb-img"${urls[i] ? ` style="background-image:url('${esc(urls[i])}')"` : ''}></span>
        รอบ ${c.attempt_no} · ${STATUS_LABELS[attemptStatus(c)]}
      </button>`).join('');
  }

  $('thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    selected = Number(b.dataset.i);
    renderThumbs();
    renderCapture();
  });
  $('toggle-boxes').addEventListener('change', (e) => $('capture').classList.toggle('hide-boxes', !e.target.checked));

  // ---------- Review ----------
  setupReview($('review'), ins, profile);

  $('content').classList.remove('hidden');
  hydrateIcons($('content'));
  await Promise.all([renderThumbs(), renderCapture()]);
})();
