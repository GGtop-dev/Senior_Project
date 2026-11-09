-- =============================================================================
-- ทดสอบนโยบายเก็บรูป 30 วัน (retention_upcoming / retention_mark_expired และสิทธิ์)
-- รันทั้งไฟล์ใน Supabase → SQL Editor หลังรัน schema.sql แล้ว
-- ข้อมูลทดสอบทั้งหมดถูก rollback เสมอ (รวมถึงแถวจริงที่ retention_mark_expired แตะ)
-- ผ่านทั้งหมด → NOTICE: retention: ผ่านทั้งหมด … / ไม่ผ่าน → ERROR พร้อมรหัส test
-- =============================================================================

do $$
declare
  admin_email constant text := 'rls-test-admin@example.test';
  other_email constant text := 'rls-test-outsider@example.test';
  today date := (now() at time zone 'Asia/Bangkok')::date;
  dev_id uuid;
  before_up jsonb;
  after_up  jsonb;
  n int;
  r record;
  total int := 0;
  failures text[] := '{}';
begin
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into public.profiles (email) values (admin_email);
    insert into public.devices (name, location) values ('rls-test-device', 'test') returning id into dev_id;

    perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select coalesce(jsonb_object_agg(delete_on, images), '{}') into before_up from public.retention_upcoming();
    execute 'reset role';

    -- รูปที่ถ่าย 30, 29 (00:00 พอดี), 23 และ 22 วันก่อน
    with ins as (
      insert into public.inspections (device_id, status, started_at)
      select dev_id, 'passed', now() from generate_series(1, 4) returning id
    ), numbered as (select id, row_number() over () as k from ins)
    insert into public.captures (inspection_id, attempt_no, image_path, captured_at)
    select id, 1, 'rls-test/' || k || '.jpg',
      case k
        when 1 then ((today - 30) + time '12:00')::timestamp at time zone 'Asia/Bangkok'
        when 2 then (today - 29)::timestamp at time zone 'Asia/Bangkok'
        when 3 then ((today - 23) + time '12:00')::timestamp at time zone 'Asia/Bangkok'
        else        ((today - 22) + time '12:00')::timestamp at time zone 'Asia/Bangkok'
      end
    from numbered;

    -- ---------- R01 สมาชิกเห็นจำนวนรูปที่จะถูกลบ วันนี้ / พรุ่งนี้ / อีก 7 วัน แต่ไม่รวมอีก 8 วัน ----------
    total := total + 1;
    execute 'set local role authenticated';
    select coalesce(jsonb_object_agg(delete_on, images), '{}') into after_up from public.retention_upcoming();
    execute 'reset role';
    if coalesce((after_up ->> today::text)::int, 0)       - coalesce((before_up ->> today::text)::int, 0)       <> 1
    or coalesce((after_up ->> (today + 1)::text)::int, 0) - coalesce((before_up ->> (today + 1)::text)::int, 0) <> 1
    or coalesce((after_up ->> (today + 7)::text)::int, 0) - coalesce((before_up ->> (today + 7)::text)::int, 0) <> 1
    or after_up ? (today + 8)::text then
      failures := failures || format('R01 upcoming: ก่อน %s หลัง %s', before_up, after_up);
    end if;

    -- ---------- R02 คนที่ไม่อยู่ใน profiles ไม่เห็นอะไร ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', other_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.retention_upcoming();
    execute 'reset role';
    if n <> 0 then failures := failures || format('R02 outsider: คาด 0 แถว ได้ %s', n); end if;

    -- ---------- R03 anon เรียก retention_upcoming ไม่ได้ ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
    begin
      perform public.retention_upcoming();
      failures := failures || 'R03 anon: คาด permission denied'::text;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- ---------- R04 ผู้ใช้ที่ login (รวม admin) เรียกฟังก์ชันลบไม่ได้ ----------
    total := total + 1;
    perform set_config('request.jwt.claims', json_build_object('email', admin_email, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.retention_mark_expired();
      failures := failures || 'R04 mark_expired: คาด permission denied'::text;
    exception when insufficient_privilege then null;
    end;
    begin
      perform * from public.retention_expired_objects(10);
      failures := failures || 'R04 expired_objects: คาด permission denied'::text;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';

    -- ---------- R05 service_role: ล้าง image_path เฉพาะรูปที่ถ่ายก่อน 00:00 ของ (วันนี้ - 29) ----------
    total := total + 1;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
    perform public.retention_mark_expired();
    execute 'reset role';
    for r in select image_path, image_deleted_at, captured_at from public.captures c
             join public.inspections i on i.id = c.inspection_id where i.device_id = dev_id order by captured_at loop
      if r.captured_at < (today - 29)::timestamp at time zone 'Asia/Bangkok' then
        if r.image_path is not null or r.image_deleted_at is null then
          failures := failures || format('R05 รูปอายุ 30 วันต้องถูกล้าง: path=%s deleted_at=%s', r.image_path, r.image_deleted_at);
        end if;
      elsif r.image_path is null or r.image_deleted_at is not null then
        failures := failures || format('R05 รูปถ่ายเมื่อ %s ยังไม่ถึงกำหนด แต่ถูกล้าง', r.captured_at);
      end if;
    end loop;

    raise exception '__rollback__';
  exception when raise_exception then
    if sqlerrm <> '__rollback__' then raise; end if;
  end;

  if cardinality(failures) > 0 then
    raise exception E'retention: ไม่ผ่าน % จาก % test\n%', cardinality(failures), total, array_to_string(failures, E'\n');
  end if;
  raise notice 'retention: ผ่านทั้งหมด % test', total;
end $$;
