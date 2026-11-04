// ส่วน "ตรวจทานผล AI" ในหน้ารายละเอียดการตรวจ
// แยกจาก inspection.js เพื่อให้ทดสอบได้โดยไม่ต้องโหลดทั้งหน้า (ดู tests/review.test.html)
// ต้องโหลดหลัง supabase.js (REVIEW_VALUES, api) และ ui.js (fmtDateTime)

const REVIEW_LABELS = { correct: 'AI ตัดสินถูกต้อง', incorrect: 'AI ตัดสินผิด' };

// ซ่อนปุ่มบนหน้าเว็บเพื่อไม่ให้ผู้ใช้สับสน ส่วนสิทธิ์จริงตรวจที่ RLS ฝั่งฐานข้อมูล
function canReview(profile) {
  return profile?.role === 'admin';
}

function reviewStatusText(ins) {
  if (!REVIEW_VALUES.includes(ins.review)) return 'ยังไม่ได้ตรวจทาน';
  let s = `ตรวจทานแล้ว: ${REVIEW_LABELS[ins.review]}`;
  if (ins.reviewed_by) s += ` · โดย ${ins.reviewed_by}`;
  if (ins.reviewed_at) s += ` · ${fmtDateTime(ins.reviewed_at)}`;
  return s;
}

// section: element ที่มี [data-review], .review-actions, [data-review-hint], [data-review-status], [data-review-msg]
// save(id, value): คืนแถวที่แก้แล้ว หรือ throw ถ้าบันทึกไม่ได้ (ค่าเริ่มต้นคือ api.review)
function setupReview(section, ins, profile, save = (id, value) => api.review(id, value)) {
  const buttons = [...section.querySelectorAll('[data-review]')];
  const actions = section.querySelector('.review-actions');
  const hint = section.querySelector('[data-review-hint]');
  const status = section.querySelector('[data-review-status]');
  const msg = section.querySelector('[data-review-msg]');

  const render = () => {
    buttons.forEach((b) => b.classList.toggle('selected', b.dataset.review === ins.review));
    status.textContent = reviewStatusText(ins);
  };
  const say = (text, isError) => {
    msg.textContent = text;
    msg.classList.toggle('error', Boolean(isError));
    msg.classList.remove('hidden');
  };

  const admin = canReview(profile);
  actions.classList.toggle('hidden', !admin);
  hint.textContent = admin
    ? 'AI ตัดสินถูกต้องหรือไม่? รูปที่ AI ทายผิดจะถูกนำไปติด label เพิ่ม'
    : 'เฉพาะผู้ดูแลระบบ (admin) ที่ตรวจทานผลได้';
  render();
  if (!admin) return;

  let busy = false;
  buttons.forEach((b) => b.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const value = b.dataset.review;
    buttons.forEach((x) => { x.disabled = true; });
    try {
      const row = await save(ins.id, value);
      ins.review = row?.review ?? value;
      ins.reviewed_by = row?.reviewed_by ?? null;
      ins.reviewed_at = row?.reviewed_at ?? null;
      render();
      say(ins.review === 'correct' ? 'บันทึกแล้ว: AI ตัดสินถูกต้อง' : 'บันทึกแล้ว: รูปนี้จะถูกนำไปติด label เพิ่ม', false);
    } catch (err) {
      console.error(err);
      render(); // คงค่าเดิมไว้ ไม่แสดงว่าเลือกแล้วถ้าบันทึกไม่ได้
      say('บันทึกไม่สำเร็จ: ' + (err?.message || err), true);
    } finally {
      busy = false;
      buttons.forEach((x) => { x.disabled = false; });
    }
  }));
}
