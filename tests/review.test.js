// Unit test ของปุ่มตรวจทานผล AI
// ส่วน A: api.review (js/supabase.js) กับ Supabase ปลอม
// ส่วน B: setupReview (js/review.js) กับฟังก์ชัน save ปลอม
// รหัส test (A01, B01, …) ตรงกับตารางใน tests/README.md

const INS_ID = '11111111-2222-3333-4444-555555555555';
const ADMIN = { email: 'admin@example.com', role: 'admin' };
const VIEWER = { email: 'viewer@example.com', role: 'viewer' };
const savedRow = (review) => ({ id: INS_ID, review, reviewed_by: ADMIN.email, reviewed_at: '2026-11-04T03:15:00Z' });

// ---------- helpers ส่วน B ----------

function mountReview(ins, profile, save) {
  const fixture = document.getElementById('fixture');
  fixture.innerHTML = '';
  fixture.appendChild(document.getElementById('review-template').content.cloneNode(true));
  const section = fixture.querySelector('#review');
  setupReview(section, ins, profile, save);
  const q = (sel) => section.querySelector(sel);
  return {
    section,
    actions: q('.review-actions'),
    hint: q('[data-review-hint]'),
    status: q('[data-review-status]'),
    msg: q('[data-review-msg]'),
    btnCorrect: q('[data-review="correct"]'),
    btnIncorrect: q('[data-review="incorrect"]'),
  };
}

// รอให้ promise ที่ค้างอยู่ (handler ของปุ่ม) ทำงานจนจบ
const flush = () => new Promise((r) => setTimeout(r, 0));

// save ที่ test เป็นคนสั่งให้จบเมื่อไหร่ก็ได้
function deferredSave() {
  const calls = [];
  const save = (id, value) => new Promise((resolve, reject) => calls.push({ id, value, resolve, reject }));
  return { save, calls };
}

function makeIns(extra = {}) {
  return { id: INS_ID, review: null, reviewed_by: null, reviewed_at: null, ...extra };
}

const isShown = (el) => !el.classList.contains('hidden');

// =====================================================================
// ส่วน A: api.review
// =====================================================================

test('A01 admin บันทึก "correct" สำเร็จ คืนแถวที่แก้แล้ว', async () => {
  fakeSb.respond = () => ({ data: [savedRow('correct')], error: null });
  const row = await api.review(INS_ID, 'correct');
  assertEqual(row, savedRow('correct'), 'แถวที่คืน');
});

test('A02 admin บันทึก "incorrect" สำเร็จ', async () => {
  fakeSb.respond = () => ({ data: [savedRow('incorrect')], error: null });
  const row = await api.review(INS_ID, 'incorrect');
  assertEqual(row.review, 'incorrect');
});

test('A03 ส่ง request ถูกต้อง: ตาราง inspections, แก้เฉพาะคอลัมน์ review, กรองด้วย id และขอแถวที่แก้กลับมา', async () => {
  fakeSb.respond = () => ({ data: [savedRow('correct')], error: null });
  await api.review(INS_ID, 'correct');
  assertEqual(fakeSb.calls.length, 1, 'จำนวน request');
  const { table, ops } = fakeSb.calls[0];
  assertEqual(table, 'inspections', 'ตาราง');
  assertEqual(ops[0], ['update', { review: 'correct' }], 'update payload (มีแค่ review เพราะ grant update ไว้คอลัมน์เดียว)');
  assertEqual(ops[1], ['eq', 'id', INS_ID], 'เงื่อนไข id');
  assert(ops[2][0] === 'select' && /\breview\b/.test(ops[2][1]) && /\bid\b/.test(ops[2][1]),
    `ต้องเรียก select เพื่อนับแถวที่แก้ได้ แต่ได้ ${JSON.stringify(ops[2])}`);
});

test('A04 [บั๊กเดิม] RLS ไม่ให้แก้ (viewer) Supabase ตอบ data = [] ไม่มี error → ต้อง throw REVIEW_DENIED', async () => {
  fakeSb.respond = () => ({ data: [], error: null });
  await assertRejects(api.review(INS_ID, 'correct'), (e) => {
    assertEqual(e.code, 'REVIEW_DENIED', 'error code');
    assert(e.message.includes('ไม่มีสิทธิ์'), `ข้อความ error: ${e.message}`);
  }, 'แก้ได้ 0 แถวแต่ไม่ throw (นี่คือบั๊กเดิม)');
});

test('A05 Supabase ตอบ data = null ไม่มี error → throw REVIEW_DENIED', async () => {
  fakeSb.respond = () => ({ data: null, error: null });
  await assertRejects(api.review(INS_ID, 'correct'), (e) => assertEqual(e.code, 'REVIEW_DENIED'));
});

test('A06 ไม่พบ id (ลบไปแล้ว / id ผิด) ได้ 0 แถว → throw REVIEW_DENIED', async () => {
  fakeSb.respond = () => ({ data: [], error: null });
  await assertRejects(api.review('00000000-0000-0000-0000-000000000000', 'incorrect'),
    (e) => assertEqual(e.code, 'REVIEW_DENIED'));
});

test('A07 Supabase ตอบ error (เช่น 42501 permission denied) → throw error ตัวเดิม', async () => {
  const pgErr = { code: '42501', message: 'permission denied for table inspections' };
  fakeSb.respond = () => ({ data: null, error: pgErr });
  const e = await assertRejects(api.review(INS_ID, 'correct'));
  assert(e === pgErr, 'ต้องส่ง error ของ Supabase ต่อโดยไม่เปลี่ยน');
});

test('A08 Supabase ตอบ error check constraint (23514) → throw', async () => {
  fakeSb.respond = () => ({ data: null, error: { code: '23514', message: 'violates check constraint' } });
  await assertRejects(api.review(INS_ID, 'correct'), (e) => assertEqual(e.code, '23514'));
});

test('A09 เน็ตหลุด (request reject) → throw ต่อ', async () => {
  fakeSb.respond = () => Promise.reject(new TypeError('Failed to fetch'));
  await assertRejects(api.review(INS_ID, 'correct'), (e) => assertEqual(e.message, 'Failed to fetch'));
});

test('A10 ค่าที่ไม่รองรับ ("maybe") → throw ทันทีโดยไม่ส่ง request', async () => {
  await assertRejects(api.review(INS_ID, 'maybe'), (e) => assert(e.message.includes('ค่าตรวจทานไม่ถูกต้อง')));
  assertEqual(fakeSb.calls.length, 0, 'ไม่ควรมี request');
});

test('A11 ค่า null / undefined / "" / "CORRECT" → throw โดยไม่ส่ง request', async () => {
  for (const v of [null, undefined, '', 'CORRECT', ' correct']) {
    await assertRejects(api.review(INS_ID, v), null, `ค่า ${JSON.stringify(v)} ควร throw`);
  }
  assertEqual(fakeSb.calls.length, 0, 'ไม่ควรมี request');
});

test('A12 ได้หลายแถว (ไม่ควรเกิดเพราะ id เป็น primary key) → คืนแถวแรก ไม่ throw', async () => {
  fakeSb.respond = () => ({ data: [savedRow('correct'), savedRow('correct')], error: null });
  const row = await api.review(INS_ID, 'correct');
  assertEqual(row.id, INS_ID);
});

// =====================================================================
// ส่วน B: setupReview (UI)
// =====================================================================

test('B01 viewer: ไม่เห็นปุ่ม และมีข้อความว่าเฉพาะ admin ตรวจทานได้', async () => {
  const ui = mountReview(makeIns(), VIEWER, () => { throw new Error('ไม่ควรถูกเรียก'); });
  assert(!isShown(ui.actions), 'ปุ่มต้องถูกซ่อน');
  assert(ui.hint.textContent.includes('เฉพาะผู้ดูแลระบบ'), `hint: ${ui.hint.textContent}`);
  assertEqual(ui.status.textContent, 'ยังไม่ได้ตรวจทาน');
  assert(!isShown(ui.msg), 'ข้อความผลบันทึกต้องซ่อน');
});

test('B02 viewer: เห็นผลตรวจทานที่ admin บันทึกไว้ (อ่านอย่างเดียว)', async () => {
  const ui = mountReview(makeIns({ review: 'incorrect', reviewed_by: ADMIN.email, reviewed_at: '2026-11-04T03:15:00Z' }), VIEWER);
  assert(ui.status.textContent.startsWith('ตรวจทานแล้ว: AI ตัดสินผิด'), `status: ${ui.status.textContent}`);
  assert(ui.status.textContent.includes(`โดย ${ADMIN.email}`), 'ต้องบอกว่าใครตรวจทาน');
  assert(!isShown(ui.actions), 'ปุ่มต้องถูกซ่อน');
});

test('B03 viewer: คลิกปุ่มที่ซ่อนอยู่ (เช่นผ่าน DevTools) ต้องไม่เรียก save', async () => {
  let called = 0;
  const ui = mountReview(makeIns(), VIEWER, async () => { called++; return savedRow('correct'); });
  ui.btnCorrect.click();
  await flush();
  assertEqual(called, 0, 'จำนวนครั้งที่เรียก save');
  assert(!isShown(ui.msg), 'ไม่ควรขึ้นข้อความบันทึกแล้ว');
});

test('B04 profile ไม่มี role / เป็น null / role ที่ไม่รู้จัก → ถือเป็น viewer', async () => {
  for (const p of [null, undefined, {}, { role: '' }, { role: 'editor' }, { role: 'Admin' }]) {
    const ui = mountReview(makeIns(), p);
    assert(!isShown(ui.actions), `profile ${JSON.stringify(p)} ไม่ควรเห็นปุ่ม`);
  }
});

test('B05 admin: เห็นปุ่มและคำอธิบาย', async () => {
  const ui = mountReview(makeIns(), ADMIN, async () => savedRow('correct'));
  assert(isShown(ui.actions), 'ปุ่มต้องแสดง');
  assert(ui.hint.textContent.includes('AI ตัดสินถูกต้องหรือไม่'), `hint: ${ui.hint.textContent}`);
  assert(!ui.btnCorrect.classList.contains('selected') && !ui.btnIncorrect.classList.contains('selected'), 'ยังไม่ควรมีปุ่มที่เลือก');
});

test('B06 admin: ผลตรวจทานเดิม "correct" → ปุ่มถูกต้องถูกเลือกไว้', async () => {
  const ui = mountReview(makeIns({ review: 'correct' }), ADMIN, async () => savedRow('correct'));
  assert(ui.btnCorrect.classList.contains('selected'), 'ปุ่มถูกต้องต้องถูกเลือก');
  assert(!ui.btnIncorrect.classList.contains('selected'), 'ปุ่ม AI ผิดต้องไม่ถูกเลือก');
});

test('B07 admin กด "ถูกต้อง" สำเร็จ: เรียก save ถูก, เลือกปุ่ม, อัปเดต ins และสถานะ, ขึ้นข้อความสำเร็จ', async () => {
  const ins = makeIns();
  const calls = [];
  const ui = mountReview(ins, ADMIN, async (id, value) => { calls.push([id, value]); return savedRow(value); });
  ui.btnCorrect.click();
  await flush();
  assertEqual(calls, [[INS_ID, 'correct']], 'อาร์กิวเมนต์ของ save');
  assert(ui.btnCorrect.classList.contains('selected'), 'ปุ่มถูกต้องต้องถูกเลือก');
  assertEqual(ins.review, 'correct', 'ins.review');
  assertEqual(ins.reviewed_by, ADMIN.email, 'ins.reviewed_by มาจากแถวที่ฐานข้อมูลคืนมา');
  assert(ui.status.textContent.includes('AI ตัดสินถูกต้อง'), `status: ${ui.status.textContent}`);
  assertEqual(ui.msg.textContent, 'บันทึกแล้ว: AI ตัดสินถูกต้อง');
  assert(isShown(ui.msg) && !ui.msg.classList.contains('error'), 'ข้อความสำเร็จต้องแสดงและไม่ใช่สีแดง');
});

test('B08 admin กด "AI ผิด" สำเร็จ: ข้อความบอกว่าจะนำไปติด label', async () => {
  const ui = mountReview(makeIns(), ADMIN, async (id, v) => savedRow(v));
  ui.btnIncorrect.click();
  await flush();
  assert(ui.btnIncorrect.classList.contains('selected'));
  assertEqual(ui.msg.textContent, 'บันทึกแล้ว: รูปนี้จะถูกนำไปติด label เพิ่ม');
});

test('B09 admin เปลี่ยนจาก "correct" เป็น "incorrect": ปุ่มที่เลือกสลับกัน', async () => {
  const ui = mountReview(makeIns({ review: 'correct' }), ADMIN, async (id, v) => savedRow(v));
  ui.btnIncorrect.click();
  await flush();
  assert(ui.btnIncorrect.classList.contains('selected'), 'AI ผิดต้องถูกเลือก');
  assert(!ui.btnCorrect.classList.contains('selected'), 'ถูกต้องต้องไม่ถูกเลือกแล้ว');
});

test('B10 [บั๊กเดิม] บันทึกไม่ได้ (REVIEW_DENIED): ต้องไม่ขึ้นว่าบันทึกแล้ว ไม่เลือกปุ่ม และ ins ไม่เปลี่ยน', async () => {
  const ins = makeIns();
  const ui = mountReview(ins, ADMIN, async () => { throw reviewDenied(); });
  ui.btnCorrect.click();
  await flush();
  assert(!ui.msg.textContent.includes('บันทึกแล้ว'), `ข้อความ: ${ui.msg.textContent}`);
  assert(ui.msg.textContent.startsWith('บันทึกไม่สำเร็จ:'), `ข้อความ: ${ui.msg.textContent}`);
  assert(ui.msg.textContent.includes('ไม่มีสิทธิ์'), 'ต้องบอกเหตุผล');
  assert(ui.msg.classList.contains('error'), 'ข้อความต้องเป็นสีแดง');
  assert(!ui.btnCorrect.classList.contains('selected'), 'ปุ่มต้องไม่ถูกเลือก');
  assertEqual(ins.review, null, 'ins.review ต้องคงเดิม');
  assertEqual(ui.status.textContent, 'ยังไม่ได้ตรวจทาน');
});

test('B11 บันทึกไม่สำเร็จขณะมีค่าเดิม "correct" แล้วกด "AI ผิด": ปุ่มถูกต้องยังเลือกอยู่', async () => {
  const ins = makeIns({ review: 'correct' });
  const ui = mountReview(ins, ADMIN, async () => { throw new Error('Failed to fetch'); });
  ui.btnIncorrect.click();
  await flush();
  assert(ui.btnCorrect.classList.contains('selected'), 'ค่าเดิมต้องยังถูกเลือก');
  assert(!ui.btnIncorrect.classList.contains('selected'), 'ค่าที่บันทึกไม่ได้ต้องไม่ถูกเลือก');
  assertEqual(ins.review, 'correct');
  assertEqual(ui.msg.textContent, 'บันทึกไม่สำเร็จ: Failed to fetch');
});

test('B12 ระหว่างรอบันทึก ปุ่มทั้งสองถูก disable และกลับมาใช้ได้หลังเสร็จ', async () => {
  const d = deferredSave();
  const ui = mountReview(makeIns(), ADMIN, d.save);
  ui.btnCorrect.click();
  assert(ui.btnCorrect.disabled && ui.btnIncorrect.disabled, 'ปุ่มต้อง disable ระหว่างรอ');
  d.calls[0].resolve(savedRow('correct'));
  await flush();
  assert(!ui.btnCorrect.disabled && !ui.btnIncorrect.disabled, 'ปุ่มต้องกลับมาใช้ได้');
});

test('B13 ปุ่มกลับมาใช้ได้แม้บันทึกล้มเหลว', async () => {
  const d = deferredSave();
  const ui = mountReview(makeIns(), ADMIN, d.save);
  ui.btnCorrect.click();
  d.calls[0].reject(new Error('boom'));
  await flush();
  assert(!ui.btnCorrect.disabled && !ui.btnIncorrect.disabled, 'ปุ่มต้องกลับมาใช้ได้');
});

test('B14 กดซ้ำระหว่างรอ (double click / กดอีกปุ่ม) → เรียก save ครั้งเดียว', async () => {
  const d = deferredSave();
  const ui = mountReview(makeIns(), ADMIN, d.save);
  ui.btnCorrect.click();
  // เปิดปุ่มกลับเองเพื่อทดสอบตัวกัน busy แยกจากการ disable ปุ่ม
  ui.btnCorrect.disabled = false;
  ui.btnIncorrect.disabled = false;
  ui.btnCorrect.click();
  ui.btnIncorrect.click();
  assertEqual(d.calls.length, 1, 'จำนวนครั้งที่เรียก save');
  d.calls[0].resolve(savedRow('correct'));
  await flush();
  assert(ui.btnCorrect.classList.contains('selected'));
});

test('B15 save คืน undefined (เช่นโหมดตัวอย่างรุ่นเก่า) → ใช้ค่าที่กดแทน', async () => {
  const ins = makeIns();
  const ui = mountReview(ins, ADMIN, async () => undefined);
  ui.btnIncorrect.click();
  await flush();
  assertEqual(ins.review, 'incorrect');
  assert(ui.btnIncorrect.classList.contains('selected'));
});

test('B16 error ที่ไม่ใช่ Error object (string) → แสดงข้อความนั้น', async () => {
  const ui = mountReview(makeIns(), ADMIN, () => Promise.reject('timeout'));
  ui.btnCorrect.click();
  await flush();
  assertEqual(ui.msg.textContent, 'บันทึกไม่สำเร็จ: timeout');
});

test('B17 ข้อความ error ถัดมาหลังสำเร็จ: ล้างสถานะสำเร็จและเป็นสีแดง', async () => {
  let fail = false;
  const ui = mountReview(makeIns(), ADMIN, async (id, v) => { if (fail) throw new Error('x'); return savedRow(v); });
  ui.btnCorrect.click();
  await flush();
  fail = true;
  ui.btnIncorrect.click();
  await flush();
  assert(ui.msg.classList.contains('error'), 'ต้องเป็นสีแดง');
  assert(ui.btnCorrect.classList.contains('selected'), 'ยังคงเป็นค่าที่บันทึกสำเร็จล่าสุด');
});

test('B18 reviewed_by มี HTML → แสดงเป็นข้อความ ไม่ถูกตีความเป็น HTML (XSS)', async () => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const ui = mountReview(makeIns({ review: 'correct', reviewed_by: evil }), VIEWER);
  await flush();
  assert(ui.status.textContent.includes(evil), 'ต้องเห็นเป็นข้อความดิบ');
  assertEqual(ui.status.querySelector('img'), null, 'ต้องไม่มี element img');
  assertEqual(window.__xss, undefined, 'script ต้องไม่ทำงาน');
});

test('B19 ค่า review แปลก (ไม่ใช่ correct/incorrect) ในฐานข้อมูล → แสดง "ยังไม่ได้ตรวจทาน" และไม่เลือกปุ่ม', async () => {
  const ui = mountReview(makeIns({ review: 'unknown' }), ADMIN);
  assertEqual(ui.status.textContent, 'ยังไม่ได้ตรวจทาน');
  assert(!ui.btnCorrect.classList.contains('selected') && !ui.btnIncorrect.classList.contains('selected'));
});

test('B20 ใช้ api.review เป็นค่าเริ่มต้น และ RLS ปฏิเสธ (0 แถว) → ขึ้นบันทึกไม่สำเร็จ (ทดสอบรวม A+B)', async () => {
  fakeSb.respond = () => ({ data: [], error: null });
  const ins = makeIns();
  const ui = mountReview(ins, ADMIN); // ไม่ส่ง save → ใช้ api.review จริงกับ Supabase ปลอม
  ui.btnIncorrect.click();
  await flush(); await flush();
  assertEqual(fakeSb.calls.length, 1, 'ต้องส่ง request 1 ครั้ง');
  assert(ui.msg.textContent.startsWith('บันทึกไม่สำเร็จ'), `ข้อความ: ${ui.msg.textContent}`);
  assertEqual(ins.review, null);
});

test('B21 ใช้ api.review เป็นค่าเริ่มต้น และบันทึกสำเร็จ → สถานะใช้ reviewed_by จากฐานข้อมูล', async () => {
  fakeSb.respond = () => ({ data: [{ ...savedRow('correct'), reviewed_by: 'boss@example.com' }], error: null });
  const ins = makeIns();
  const ui = mountReview(ins, ADMIN);
  ui.btnCorrect.click();
  await flush(); await flush();
  assertEqual(ins.reviewed_by, 'boss@example.com');
  assert(ui.status.textContent.includes('โดย boss@example.com'), `status: ${ui.status.textContent}`);
});

runTests();
