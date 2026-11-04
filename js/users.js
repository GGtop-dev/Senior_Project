// หน้าจัดการผู้ใช้: ทุกคนเป็น admin เพิ่ม/ลบสมาชิกได้
// การกันลบตัวเองและลบจนไม่เหลือใครทำที่ฐานข้อมูล (trigger profiles_guard) หน้าเว็บแค่ปิดปุ่มให้ไม่สับสน

(async () => {
  const profile = await requireAuth();
  renderSidebar('users', profile);
  hydrateIcons();

  const me = normalizeEmail(profile.email);
  let members = [];
  let pendingDelete = null;

  const AVATAR_COLORS = ['#2563EB', '#0F766E', '#7C3AED', '#B45309', '#BE185D', '#475569'];
  const avatarColor = (email) => AVATAR_COLORS[[...email].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

  function toast(text) {
    const el = Object.assign(document.createElement('div'), { className: 'toast', role: 'status', textContent: text });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function render() {
    const q = normalizeEmail($('search').value);
    const rows = members.filter((m) => !q || m.email.includes(q));
    $('member-count').textContent = `สมาชิก ${fmtNum(members.length)} คน`;
    if (!rows.length) {
      $('members').innerHTML = `<tr><td colspan="5" class="empty">${q ? 'ไม่พบอีเมลที่ค้นหา' : 'ยังไม่มีสมาชิก'}</td></tr>`;
      return;
    }
    const onlyOne = members.length <= 1;
    $('members').innerHTML = rows.map((m) => {
      const self = m.email === me;
      const reason = self ? 'ลบบัญชีของตัวเองไม่ได้' : onlyOne ? 'ต้องมีสมาชิกอย่างน้อย 1 คน' : '';
      const del = reason
        ? `<button class="btn btn-secondary" type="button" disabled title="${esc(reason)}">ลบ</button>`
        : `<button class="btn btn-danger" type="button" data-delete="${esc(m.id)}" aria-label="ลบ ${esc(m.email)}">${icon('trash')}ลบ</button>`;
      return `<tr>
        <td><span class="member"><span class="avatar" style="background:${avatarColor(m.email)}">${esc(m.email.slice(0, 2).toUpperCase())}</span>
          <span>${esc(m.email)}${self ? '<span class="tag tag-you">คุณ</span>' : ''}</span></span></td>
        <td><span class="tag tag-role">${esc(m.role || 'admin')}</span></td>
        <td>${esc(fmtDate(m.created_at))}</td>
        <td>${esc(m.added_by || '—')}</td>
        <td style="text-align:right">${del}</td>
      </tr>`;
    }).join('');
  }

  async function load() {
    try {
      members = (await api.profiles()).map((m) => ({ ...m, email: normalizeEmail(m.email) }));
      $('error').innerHTML = '';
      render();
    } catch (err) {
      showError($('error'), err);
    }
  }

  // ---------- dialogs ----------

  function setError(id, text) {
    $(id).textContent = text || '';
    $(id).classList.toggle('hidden', !text);
  }

  document.querySelectorAll('dialog [data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  $('add-open').addEventListener('click', () => {
    $('add-form').reset();
    setError('add-error', '');
    $('add-dialog').showModal();
    $('new-email').focus();
  });

  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = normalizeEmail($('new-email').value);
    if (!EMAIL_RE.test(email)) return setError('add-error', 'รูปแบบอีเมลไม่ถูกต้อง');
    if (members.some((m) => m.email === email)) return setError('add-error', 'อีเมลนี้อยู่ในรายชื่อแล้ว');
    setError('add-error', '');
    $('add-submit').disabled = true;
    try {
      await api.addProfile(email, me);
      $('add-dialog').close();
      toast(`เพิ่ม ${email} แล้ว`);
      await load();
    } catch (err) {
      console.error(err);
      setError('add-error', 'เพิ่มไม่สำเร็จ: ' + (err?.message || err));
    } finally {
      $('add-submit').disabled = false;
    }
  });

  $('members').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delete]');
    if (!b) return;
    pendingDelete = members.find((m) => m.id === b.dataset.delete) || null;
    if (!pendingDelete) return;
    $('delete-email').textContent = pendingDelete.email;
    setError('delete-error', '');
    $('delete-dialog').showModal();
  });

  $('delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingDelete) return;
    $('delete-submit').disabled = true;
    try {
      await api.removeProfile(pendingDelete.id, me);
      $('delete-dialog').close();
      toast(`ลบ ${pendingDelete.email} แล้ว`);
      pendingDelete = null;
      await load();
    } catch (err) {
      console.error(err);
      setError('delete-error', 'ลบไม่สำเร็จ: ' + (err?.message || err));
    } finally {
      $('delete-submit').disabled = false;
    }
  });

  $('search').addEventListener('input', debounce(render, 150));

  await load();
})();
