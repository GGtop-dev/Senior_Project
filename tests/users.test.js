// Unit test ของ API สมาชิก (js/supabase.js): profiles, addProfile, removeProfile
// รหัส test ตรงกับตารางใน tests/README.md

const ROW = { id: 'p-9', email: 'new.member@example.com', role: 'admin', added_by: 'admin@example.com', created_at: '2026-11-04T03:00:00Z' };
const opsOf = (i = 0) => fakeSb.calls[i].ops;

async function rejects(promise) {
  try { await promise; } catch (e) { return e; }
  throw new Error('คาดว่าจะ throw แต่ไม่ throw');
}

test('E01 profiles() ดึง id, email, role, added_by, created_at เรียงจากเก่าไปใหม่', async () => {
  fakeSb.respond = () => ({ data: [ROW], error: null });
  assertEqual(await api.profiles(), [ROW]);
  assertEqual(fakeSb.calls[0].table, 'profiles');
  assertEqual(opsOf()[0], ['select', 'id, email, role, added_by, created_at']);
  assertEqual(opsOf()[1], ['order', 'created_at', { ascending: true }]);
});

test('E02 profiles() error → throw', async () => {
  fakeSb.respond = () => ({ data: null, error: { message: 'permission denied' } });
  assertEqual((await rejects(api.profiles())).message, 'permission denied');
});

test('E03 addProfile ตัดช่องว่างและทำเป็นตัวเล็ก แล้วส่งแค่ email (role / added_by ให้ trigger ใส่)', async () => {
  fakeSb.respond = () => ({ data: [ROW], error: null });
  const row = await api.addProfile('  New.Member@Example.COM ', 'admin@example.com');
  assertEqual(row, ROW);
  assertEqual(opsOf()[0], ['insert', { email: 'new.member@example.com' }]);
  assert(opsOf()[1][0] === 'select', 'ต้องขอแถวกลับมาเพื่อเช็คว่าบันทึกจริง');
});

test('E04 อีเมลรูปแบบผิด → throw ทันที ไม่ส่ง request', async () => {
  for (const bad of ['', '   ', 'abc', 'a@b', 'a b@c.com', '@example.com', 'name@', null, undefined]) {
    const e = await rejects(api.addProfile(bad));
    assertEqual(e.message, 'รูปแบบอีเมลไม่ถูกต้อง', `ค่า ${JSON.stringify(bad)}`);
  }
  assertEqual(fakeSb.calls.length, 0);
});

test('E05 อีเมลซ้ำ (unique 23505) → "อีเมลนี้อยู่ในรายชื่อแล้ว"', async () => {
  fakeSb.respond = () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } });
  assertEqual((await rejects(api.addProfile('dup@example.com'))).message, 'อีเมลนี้อยู่ในรายชื่อแล้ว');
});

test('E06 RLS ไม่ให้เพิ่ม (42501) → ส่ง error ต่อ', async () => {
  fakeSb.respond = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } });
  assertEqual((await rejects(api.addProfile('x@example.com'))).code, '42501');
});

test('E07 insert สำเร็จแต่ไม่ได้แถวกลับมา → throw (ไม่ขึ้นว่าเพิ่มแล้ว)', async () => {
  fakeSb.respond = () => ({ data: [], error: null });
  assert((await rejects(api.addProfile('x@example.com'))).message.includes('ไม่มีสิทธิ์'));
});

test('E08 removeProfile สำเร็จ: delete ตาม id และขอแถวที่ลบกลับมา', async () => {
  fakeSb.respond = () => ({ data: [{ id: 'p-9' }], error: null });
  await api.removeProfile('p-9', 'admin@example.com');
  assertEqual(opsOf()[0], ['delete']);
  assertEqual(opsOf()[1], ['eq', 'id', 'p-9']);
  assertEqual(opsOf()[2], ['select', 'id']);
});

test('E09 removeProfile ลบได้ 0 แถว (RLS / ไม่พบ) → throw', async () => {
  fakeSb.respond = () => ({ data: [], error: null });
  assert((await rejects(api.removeProfile('p-9'))).message.startsWith('ไม่ได้ลบ'));
});

test('E10 trigger ฐานข้อมูลปฏิเสธ (ลบตัวเอง / คนสุดท้าย) → ข้อความจาก trigger ส่งต่อถึงผู้ใช้', async () => {
  for (const msg of ['ลบบัญชีของตัวเองไม่ได้', 'ต้องมีสมาชิกอย่างน้อย 1 คน']) {
    fakeSb.respond = () => ({ data: null, error: { code: 'P0001', message: msg } });
    assertEqual((await rejects(api.removeProfile('p-1'))).message, msg);
  }
});

test('E11 normalizeEmail / EMAIL_RE', () => {
  assertEqual(normalizeEmail('  A@B.Co '), 'a@b.co');
  assertEqual(normalizeEmail(null), '');
  assert(EMAIL_RE.test('first.last+tag@sub.example.co.th'));
  assert(!EMAIL_RE.test('no-at-sign.example.com'));
});

runTests();
