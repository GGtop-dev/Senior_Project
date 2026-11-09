-- =============================================================================
-- ทดสอบสิทธิ์ตรวจทานผล AI (inspections.review) ที่ฝั่งฐานข้อมูล
-- รันทั้งไฟล์ใน Supabase → SQL Editor หลังรัน schema.sql แล้ว
--
-- ตั้งแต่ 4 พ.ย. 2026 ทุกคนใน profiles เป็น admin จึงไม่มีกรณี viewer แล้ว
-- คนที่ "ไม่มีสิทธิ์" คือคนที่ login ได้แต่ไม่อยู่ใน profiles (รวมบัญชี Pi และคนที่ถูกลบออก)
--
-- ข้อมูลทดสอบทั้งหมดถูก rollback ใน subtransaction เสมอ ไม่เหลือในฐานข้อมูลไม่ว่าผ่านหรือไม่ผ่าน
-- ผ่านทั้งหมด → "Success. No rows returned" (และ NOTICE: review RLS: ผ่านทั้งหมด …)
-- ไม่ผ่าน    → ERROR: review RLS: ไม่ผ่าน … พร้อมรายการรหัส test ที่ไม่ผ่าน
-- รหัส test (S01, S02, …) ตรงกับตารางใน web/tests/README.md
-- =============================================================================

do $$
declare
  admin_email  constant text := 'rls-test-admin@example.test';
  admin2_email constant text := 'rls-test-admin2@example.test';
  other_email  constant text := 'rls-test-outsider@example.test';
  newbie_email constant text := 'rls-test-newbie@example.test';
  dev_id   uuid;
  ins_id   uuid;
  n        int;
  r        record;
  total    int := 0;
  failures text[] := '{}';
begin
  begin -- subtransaction: ยกเลิกทุกอย่างตอนท้ายด้วย exception '__rollback__'

    -- ---------- fixtures (รันในฐานะ postgres ไม่มี jwt) ----------
    perform set_config('request.jwt.claims', '', true);
    insert into public.profiles (email) values (admin_email), (admin2_email);
    insert into public.devices (name, location) values ('rls-test-device', 'test') returning id into dev_id;
    insert into public.inspections (device_id, status, started_at)
      values (dev_id, 'passed', now()) returning id into ins_id;

    -- ---------- S01 admin แก้ review ได้ 1 แถว ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.inspections set review = 'correct' where id = ins_id;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then failures := failures || format('S01 admin update: คาด 1 แถว ได้ %s', n); end if;

    -- ---------- S02 trigger บันทึก reviewed_by / reviewed_at ----------
    total := total + 1;
    select review, reviewed_by, reviewed_at into r from public.inspections where id = ins_id;
    if r.review is distinct from 'correct' or r.reviewed_by is distinct from admin_email or r.reviewed_at is null then
      failures := failures || format('S02 stamp: ได้ review=%s reviewed_by=%s reviewed_at=%s', r.review, r.reviewed_by, r.reviewed_at);
    end if;

    -- ---------- S03 admin update ... returning ได้แถวกลับมา (แบบเดียวกับ .select() ในเว็บ) ----------
    total := total + 1;
    execute 'set local role authenticated';
    update public.inspections set review = 'incorrect' where id = ins_id
      returning id, review, reviewed_by, reviewed_at into r;
    execute 'reset role';
    if r.id is distinct from ins_id or r.review is distinct from 'incorrect' then
      failures := failures || format('S03 returning: ได้ %s', r);
    end if;

    -- ---------- S04 [บั๊กเดิม] คนที่ไม่อยู่ใน profiles แก้ไม่ได้: 0 แถว ไม่มี error และค่าไม่เปลี่ยน ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', other_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.inspections set review = 'correct' where id = ins_id;
    get diagnostics n = row_count;
    execute 'reset role';
    select review into r from public.inspections where id = ins_id;
    if n <> 0 or r.review is distinct from 'incorrect' then
      failures := failures || format('S04 outsider update: คาด 0 แถวและค่าเดิม incorrect ได้ %s แถว ค่า %s', n, r.review);
    end if;

    -- ---------- S05 สมาชิกอ่านแถวได้ ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', admin2_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.inspections where id = ins_id;
    execute 'reset role';
    if n <> 1 then failures := failures || format('S05 member select: คาด 1 แถว ได้ %s', n); end if;

    -- ---------- S06 คนที่ไม่อยู่ใน profiles อ่านไม่ได้ ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', other_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.inspections where id = ins_id;
    execute 'reset role';
    if n <> 0 then failures := failures || format('S06 outsider select: คาด 0 แถว ได้ %s', n); end if;

    -- ---------- S07 อีเมลตัวพิมพ์ใหญ่ของ admin ยังเป็น admin (เทียบแบบ lower) ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', upper(admin_email), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.inspections set review = 'correct' where id = ins_id;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then failures := failures || format('S07 admin upper-case email: คาด 1 แถว ได้ %s', n); end if;

    -- ---------- S08 admin แก้คอลัมน์อื่นไม่ได้ (grant update เฉพาะ review) ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      update public.inspections set status = 'failed', missing_items = '{helmet}' where id = ins_id;
      failures := failures || 'S08 admin update status: คาด permission denied แต่แก้ได้'::text;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- ---------- S09 admin ปลอม reviewed_by เองไม่ได้ ----------
    total := total + 1;
    execute 'set local role authenticated';
    begin
      update public.inspections set reviewed_by = 'someone-else@example.test' where id = ins_id;
      failures := failures || 'S09 admin update reviewed_by: คาด permission denied แต่แก้ได้'::text;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- ---------- S10 ค่า review ที่ไม่รองรับถูก check constraint ปฏิเสธ ----------
    total := total + 1;
    execute 'set local role authenticated';
    begin
      update public.inspections set review = 'maybe' where id = ins_id;
      failures := failures || 'S10 review=maybe: คาด check_violation แต่บันทึกได้'::text;
    exception when check_violation then null;
    end;
    execute 'reset role';

    -- ---------- S11 admin ล้างผลตรวจทาน (null) → reviewed_at เป็น null ----------
    total := total + 1;
    execute 'set local role authenticated';
    update public.inspections set review = null where id = ins_id;
    execute 'reset role';
    select review, reviewed_at into r from public.inspections where id = ins_id;
    if r.review is not null or r.reviewed_at is not null then
      failures := failures || format('S11 clear: ได้ review=%s reviewed_at=%s', r.review, r.reviewed_at);
    end if;

    -- ---------- S12 anon (ไม่ได้ login) ไม่มีสิทธิ์ใดๆ กับ inspections ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
    begin
      update public.inspections set review = 'correct' where id = ins_id;
      failures := failures || 'S12 anon update: คาด permission denied แต่ไม่ error'::text;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- ---------- S13 สมาชิกที่เพิ่มใหม่แก้ได้ทันที (ไม่มี cache สิทธิ์) ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '', true);
    insert into public.profiles (email) values (newbie_email);
    perform set_config('request.jwt.claims', json_build_object('email', newbie_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.inspections set review = 'incorrect' where id = ins_id;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then failures := failures || format('S13 new member: คาด 1 แถว ได้ %s', n); end if;

    -- ---------- S14 สมาชิกที่ถูกลบออกแก้ไม่ได้ทันที ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '', true);
    delete from public.profiles where email = admin2_email;
    perform set_config('request.jwt.claims', json_build_object('email', admin2_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.inspections set review = 'correct' where id = ins_id;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 0 then failures := failures || format('S14 removed member: คาด 0 แถว ได้ %s', n); end if;

    raise exception '__rollback__';
  exception when raise_exception then
    if sqlerrm <> '__rollback__' then raise; end if;
  end;

  if cardinality(failures) > 0 then
    raise exception E'review RLS: ไม่ผ่าน % จาก % test\n%', cardinality(failures), total, array_to_string(failures, E'\n');
  end if;
  raise notice 'review RLS: ผ่านทั้งหมด % test', total;
end $$;
