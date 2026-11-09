-- =============================================================================
-- ทดสอบสิทธิ์และกฎของตารางสมาชิก (profiles) ที่ฝั่งฐานข้อมูล
-- รันทั้งไฟล์ใน Supabase → SQL Editor หลังรัน schema.sql แล้ว
--
-- ข้อมูลทดสอบ (รวมถึงการลบสมาชิกจริงในข้อ U09) ถูก rollback ใน subtransaction เสมอ
-- ผ่านทั้งหมด → "Success. No rows returned" (และ NOTICE: profiles RLS: ผ่านทั้งหมด …)
-- ไม่ผ่าน    → ERROR: profiles RLS: ไม่ผ่าน … พร้อมรายการรหัส test ที่ไม่ผ่าน
-- รหัส test (U01, U02, …) ตรงกับตารางใน web/tests/README.md
-- =============================================================================

do $$
declare
  admin_email  constant text := 'rls-test-admin@example.test';
  other_email  constant text := 'rls-test-outsider@example.test';
  n        int;
  r        record;
  total    int := 0;
  failures text[] := '{}';
begin
  begin -- subtransaction: ยกเลิกทุกอย่างตอนท้ายด้วย exception '__rollback__'

    perform set_config('request.jwt.claims', '', true);
    insert into public.profiles (email) values (admin_email);

    -- ---------- U01 admin เพิ่มสมาชิก: อีเมลตัวเล็ก ตัดช่องว่าง role = admin added_by = คนเพิ่ม ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.profiles (email) values ('  RLS-Test-New@Example.TEST ') returning email, role, added_by into r;
    execute 'reset role';
    if r.email is distinct from 'rls-test-new@example.test' or r.role is distinct from 'admin' or r.added_by is distinct from admin_email then
      failures := failures || format('U01 insert: ได้ email=%s role=%s added_by=%s', r.email, r.role, r.added_by);
    end if;

    -- ---------- U02 ส่ง role / added_by มาเอง → ถูกแทนด้วยค่าจาก trigger ----------
    total := total + 1;
    execute 'set local role authenticated';
    begin
      insert into public.profiles (email, role, added_by) values ('rls-test-spoof@example.test', 'viewer', 'someone-else@example.test')
        returning role, added_by into r;
      if r.role is distinct from 'admin' or r.added_by is distinct from admin_email then
        failures := failures || format('U02 spoof: ได้ role=%s added_by=%s', r.role, r.added_by);
      end if;
    exception when others then
      failures := failures || format('U02 spoof: error %s', sqlerrm);
    end;
    execute 'reset role';

    -- ---------- U03 อีเมลซ้ำ (ไม่สนตัวพิมพ์) → unique_violation ----------
    total := total + 1;
    execute 'set local role authenticated';
    begin
      insert into public.profiles (email) values ('RLS-TEST-NEW@example.test');
      failures := failures || 'U03 duplicate: คาด unique_violation แต่เพิ่มได้'::text;
    exception when unique_violation then null;
    end;
    execute 'reset role';

    -- ---------- U04 แก้ role เป็นอย่างอื่นไม่ได้ (มีแค่ admin) ----------
    total := total + 1;
    execute 'set local role authenticated';
    begin
      update public.profiles set role = 'viewer' where email = 'rls-test-new@example.test';
      failures := failures || 'U04 role viewer: คาด check_violation แต่แก้ได้'::text;
    exception when check_violation then null;
    end;
    execute 'reset role';

    -- ---------- U05 admin เห็นสมาชิกทุกคน ----------
    total := total + 1;
    execute 'set local role authenticated';
    select count(*) into n from public.profiles where email like 'rls-test-%';
    execute 'reset role';
    if n <> 3 then failures := failures || format('U05 admin select: คาด 3 แถว ได้ %s', n); end if;

    -- ---------- U06 admin ลบสมาชิกคนอื่นได้ ----------
    total := total + 1;
    execute 'set local role authenticated';
    delete from public.profiles where email = 'rls-test-spoof@example.test';
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then failures := failures || format('U06 delete other: คาด 1 แถว ได้ %s', n); end if;

    -- ---------- U07 ลบบัญชีของตัวเองไม่ได้ ----------
    total := total + 1;
    execute 'set local role authenticated';
    begin
      delete from public.profiles where email = admin_email;
      failures := failures || 'U07 delete self: คาด error แต่ลบได้'::text;
    exception when raise_exception then
      if sqlerrm <> 'ลบบัญชีของตัวเองไม่ได้' then failures := failures || format('U07 delete self: error ผิด %s', sqlerrm); end if;
    end;
    execute 'reset role';

    -- ---------- U08 คนที่ไม่อยู่ใน profiles: เพิ่มไม่ได้ เห็นไม่ได้ ลบไม่ได้ ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', other_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      insert into public.profiles (email) values (other_email);
      failures := failures || 'U08 outsider insert: คาด RLS ปฏิเสธ แต่เพิ่มได้'::text;
    exception when insufficient_privilege then null;
    end;
    select count(*) into n from public.profiles;
    if n <> 0 then failures := failures || format('U08 outsider select: คาด 0 แถว ได้ %s', n); end if;
    delete from public.profiles where email = admin_email;
    get diagnostics n = row_count;
    if n <> 0 then failures := failures || format('U08 outsider delete: คาด 0 แถว ได้ %s', n); end if;
    execute 'reset role';

    -- ---------- U09 ลบจนไม่เหลือสมาชิกไม่ได้ ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '', true);
    delete from public.profiles where email <> admin_email; -- rollback ตอนท้าย สมาชิกจริงไม่หาย
    begin
      delete from public.profiles where email = admin_email;
      failures := failures || 'U09 delete last: คาด error แต่ลบได้'::text;
    exception when raise_exception then
      if sqlerrm <> 'ต้องมีสมาชิกอย่างน้อย 1 คน' then failures := failures || format('U09 delete last: error ผิด %s', sqlerrm); end if;
    end;

    -- ---------- U10 anon ไม่มีสิทธิ์อ่าน profiles ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
    begin
      select count(*) into n from public.profiles;
      failures := failures || 'U10 anon select: คาด permission denied แต่อ่านได้'::text;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    raise exception '__rollback__';
  exception when raise_exception then
    if sqlerrm <> '__rollback__' then raise; end if;
  end;

  if cardinality(failures) > 0 then
    raise exception E'profiles RLS: ไม่ผ่าน % จาก % test\n%', cardinality(failures), total, array_to_string(failures, E'\n');
  end if;
  raise notice 'profiles RLS: ผ่านทั้งหมด % test', total;
end $$;
