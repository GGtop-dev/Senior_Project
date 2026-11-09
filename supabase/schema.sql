-- =============================================================================
-- PPE Inspection Dashboard: Supabase schema
-- รันทั้งไฟล์ใน Supabase → SQL Editor (รันซ้ำได้)
--
-- ผู้ใช้ 2 แบบ:
--   1) คนดูเว็บ   : login ด้วย Google ต้องมีอีเมลอยู่ใน profiles (ทุกคนเป็น admin)
--   2) Raspberry Pi: login ด้วยบัญชีอุปกรณ์ (email/password ของ Supabase Auth)
--                   ผูกกับแถวใน devices ผ่าน devices.auth_user_id
-- ทุกตารางเปิด RLS ฝั่ง anon ไม่มีสิทธิ์อะไรเลย
-- ห้ามใช้ service_role key ในเว็บหรือบน Pi
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- รายชื่ออีเมลที่เข้าเว็บได้ (สมาชิกเพิ่มกันเองในหน้า users.html ก่อนที่คนนั้นจะ login ครั้งแรก)
-- ทุกคนเป็น admin (ตัดสินเมื่อ 4 พ.ย. 2026 ว่าไม่มี role อื่น) คอลัมน์ role เก็บไว้เผื่ออนาคต
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null default 'admin' check (role = 'admin'),
  added_by    text,  -- อีเมลของคนที่เพิ่ม (trigger ใส่ให้ ห้ามส่งมาจากเว็บ)
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_email_key on public.profiles (lower(email));

-- ย้ายจากโครงเดิม (role admin / viewer): รันซ้ำได้
alter table public.profiles add column if not exists added_by text;
update public.profiles set role = 'admin' where role <> 'admin';
alter table public.profiles alter column role set default 'admin';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = 'admin');

create table if not exists public.devices (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  location           text,
  auth_user_id       uuid unique references auth.users (id) on delete set null,
  last_heartbeat_at  timestamptz,
  status             text not null default 'offline' check (status in ('online', 'offline')),
  -- ค่าที่ Pi ส่งมาพร้อม heartbeat
  cpu_temp           numeric(5, 1),
  camera_ok          boolean,
  speaker_ok         boolean,
  model_version      text,
  queue_size         integer check (queue_size >= 0),
  created_at         timestamptz not null default now()
);

-- เฟสระบุตัวตน (ยังไม่ใช้ในเว็บ)
create table if not exists public.employees (
  id             uuid primary key default gen_random_uuid(),
  employee_code  text not null unique,
  name           text not null,
  department     text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.inspections (
  -- Pi สร้าง uuid เองตอนเริ่มตรวจ ถ้าส่งซ้ำจากคิวออฟไลน์จะชน primary key แทนที่จะได้แถวซ้ำ
  id                   uuid primary key default gen_random_uuid(),
  device_id            uuid not null references public.devices (id) on delete restrict,
  employee_id          uuid references public.employees (id) on delete set null,
  identity_confidence  real check (identity_confidence between 0 and 1),
  status               text not null check (status in ('passed', 'failed', 'undetermined')),
  missing_items        text[] not null default '{}',
  model_version        text,
  started_at           timestamptz not null,
  ended_at             timestamptz,
  -- ผลตรวจทานจาก admin บนหน้า inspection.html
  review               text check (review in ('correct', 'incorrect')),
  reviewed_by          text,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (status = 'failed' or cardinality(missing_items) = 0)
);
create index if not exists inspections_started_idx        on public.inspections (started_at desc);
create index if not exists inspections_device_started_idx on public.inspections (device_id, started_at desc);
create index if not exists inspections_status_started_idx on public.inspections (status, started_at desc);

create table if not exists public.captures (
  id             uuid primary key default gen_random_uuid(),
  inspection_id  uuid not null references public.inspections (id) on delete cascade,
  attempt_no     smallint not null check (attempt_no between 1 and 3),
  -- path ใน bucket "captures" รูปแบบ <device_id>/<inspection_id>/<attempt_no>.jpg
  image_path     text,
  -- [{ "class": "helmet", "confidence": 0.91, "box": [x1, y1, x2, y2] }] box เป็นค่า 0–1
  detections     jsonb not null default '[]' check (jsonb_typeof(detections) = 'array'),
  inference_ms   integer check (inference_ms >= 0),
  captured_at    timestamptz not null default now(),
  unique (inspection_id, attempt_no)
);
-- เวลาที่ระบบลบรูปตามนโยบายเก็บ 30 วัน (image_path จะเป็น null)
alter table public.captures add column if not exists image_deleted_at timestamptz;
create index if not exists captures_image_path_idx on public.captures (image_path) where image_path is not null;
create index if not exists captures_captured_idx   on public.captures (captured_at) where image_path is not null;

create table if not exists public.device_events (
  id          bigint generated always as identity primary key,
  device_id   uuid not null references public.devices (id) on delete cascade,
  type        text not null,  -- boot, heartbeat_lost, network_down, queue_flush, high_temp, camera_error, speaker_error, model_error
  message     text,
  created_at  timestamptz not null default now()
);
create index if not exists device_events_created_idx on public.device_events (created_at desc);

-- -----------------------------------------------------------------------------
-- Helper functions (security definer เพื่อไม่ให้ policy เรียกตัวเองวน)
-- -----------------------------------------------------------------------------

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where lower(email) = lower(auth.jwt() ->> 'email')
$$;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() is not null
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

-- id ของอุปกรณ์ที่ login อยู่ (null ถ้าไม่ใช่ Pi)
create or replace function public.current_device_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.devices where auth_user_id = auth.uid()
$$;

-- Pi เรียกทุก 30–60 วินาที: supabase.rpc('device_heartbeat', {...})
-- ใช้ฟังก์ชันแทนการให้ Pi update ตาราง devices ตรงๆ เพื่อไม่ให้แก้ชื่อหรือแถวของเครื่องอื่นได้
create or replace function public.device_heartbeat(
  p_cpu_temp      numeric default null,
  p_camera_ok     boolean default null,
  p_speaker_ok    boolean default null,
  p_model_version text    default null,
  p_queue_size    integer default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.devices set
    last_heartbeat_at = now(),
    status            = 'online',
    cpu_temp          = p_cpu_temp,
    camera_ok         = p_camera_ok,
    speaker_ok        = p_speaker_ok,
    model_version     = coalesce(p_model_version, model_version),
    queue_size        = p_queue_size
  where auth_user_id = auth.uid();
  if not found then
    raise exception 'not a registered device' using errcode = '42501';
  end if;
end $$;

-- ตั้ง reviewed_by / reviewed_at ให้อัตโนมัติเมื่อมีการเปลี่ยน review
create or replace function public.stamp_review()
returns trigger language plpgsql as $$
begin
  if new.review is distinct from old.review then
    new.reviewed_by := auth.jwt() ->> 'email';
    new.reviewed_at := case when new.review is null then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists inspections_stamp_review on public.inspections;
create trigger inspections_stamp_review
  before update of review on public.inspections
  for each row execute function public.stamp_review();

-- profiles: ทำอีเมลเป็นตัวเล็ก, บังคับ role = admin, บันทึกว่าใครเพิ่ม
-- และกันไม่ให้ลบบัญชีตัวเองหรือลบจนไม่เหลือสมาชิก (กันที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่มในเว็บ)
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.email := lower(btrim(new.email));
    new.role := 'admin';
    new.added_by := nullif(me, '');
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.email := lower(btrim(new.email));
    new.added_by := old.added_by;
    return new;
  end if;
  -- DELETE: ล็อกตารางก่อนนับ เพื่อไม่ให้สองคนลบพร้อมกันจนไม่เหลือใคร
  lock table public.profiles in share row exclusive mode;
  if me <> '' and lower(old.email) = me then
    raise exception 'ลบบัญชีของตัวเองไม่ได้' using errcode = 'P0001';
  end if;
  if (select count(*) from public.profiles) <= 1 then
    raise exception 'ต้องมีสมาชิกอย่างน้อย 1 คน' using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard();

revoke all on function public.device_heartbeat(numeric, boolean, boolean, text, integer) from public, anon;
grant execute on function public.device_heartbeat(numeric, boolean, boolean, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Table privileges (ชั้นแรก) + RLS (ชั้นที่สอง)
-- -----------------------------------------------------------------------------

revoke all on public.profiles, public.devices, public.employees,
              public.inspections, public.captures, public.device_events from anon;

-- inspections: แก้ได้แค่คอลัมน์ review ส่วนคอลัมน์อื่นห้ามแก้หลังบันทึก
revoke update on public.inspections from authenticated;
grant  update (review) on public.inspections to authenticated;
-- captures / device_events: บันทึกแล้วห้ามแก้
revoke update on public.captures, public.device_events from authenticated;

alter table public.profiles      enable row level security;
alter table public.devices       enable row level security;
alter table public.employees     enable row level security;
alter table public.inspections   enable row level security;
alter table public.captures      enable row level security;
alter table public.device_events enable row level security;

-- profiles: ทุกคนเห็นแถวของตัวเอง (requireAuth ใช้ตรวจ) admin เห็นและจัดการได้ทั้งหมด
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- devices: สมาชิกอ่านได้ทั้งหมด Pi อ่านได้แค่แถวตัวเอง admin เพิ่ม/แก้/ลบ
drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated
  using (public.is_member() or auth_user_id = auth.uid());
drop policy if exists devices_admin_write on public.devices;
create policy devices_admin_write on public.devices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- employees
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (public.is_member());
drop policy if exists employees_admin_write on public.employees;
create policy employees_admin_write on public.employees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- inspections: สมาชิกอ่าน Pi เพิ่มได้เฉพาะของเครื่องตัวเอง admin ตรวจทาน (update review)
drop policy if exists inspections_select on public.inspections;
create policy inspections_select on public.inspections for select to authenticated
  using (public.is_member());
drop policy if exists inspections_device_insert on public.inspections;
create policy inspections_device_insert on public.inspections for insert to authenticated
  with check (device_id = public.current_device_id() and review is null);
drop policy if exists inspections_admin_review on public.inspections;
create policy inspections_admin_review on public.inspections for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists inspections_admin_delete on public.inspections;
create policy inspections_admin_delete on public.inspections for delete to authenticated
  using (public.is_admin());

-- captures: Pi เพิ่มได้เฉพาะของ inspection ที่เป็นของเครื่องตัวเอง
drop policy if exists captures_select on public.captures;
create policy captures_select on public.captures for select to authenticated
  using (public.is_member());
drop policy if exists captures_device_insert on public.captures;
create policy captures_device_insert on public.captures for insert to authenticated
  with check (exists (
    select 1 from public.inspections i
    where i.id = inspection_id and i.device_id = public.current_device_id()
  ));

-- device_events
drop policy if exists device_events_select on public.device_events;
create policy device_events_select on public.device_events for select to authenticated
  using (public.is_member());
drop policy if exists device_events_device_insert on public.device_events;
create policy device_events_device_insert on public.device_events for insert to authenticated
  with check (device_id = public.current_device_id());

-- หมายเหตุ: policy captures_device_insert ต้องอ่าน inspections ได้ แต่ Pi ไม่ใช่สมาชิก
-- จึงให้ Pi อ่าน inspection ของเครื่องตัวเองได้ด้วย
drop policy if exists inspections_device_select on public.inspections;
create policy inspections_device_select on public.inspections for select to authenticated
  using (device_id = public.current_device_id());

-- -----------------------------------------------------------------------------
-- Storage: bucket "captures" แบบ private (เว็บใช้ signed URL อายุ 10 นาที)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 2 * 1024 * 1024, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists captures_storage_select on storage.objects;
create policy captures_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'captures' and public.is_member());

-- Pi อัปโหลดได้เฉพาะในโฟลเดอร์ <device_id ของตัวเอง>/
drop policy if exists captures_storage_device_insert on storage.objects;
create policy captures_storage_device_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = public.current_device_id()::text
  );

drop policy if exists captures_storage_admin_delete on storage.objects;
create policy captures_storage_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and public.is_admin());

-- -----------------------------------------------------------------------------
-- เก็บรูป 30 วัน แล้วลบอัตโนมัติ (นับวันตามเวลาไทย)
-- รูปที่ถ่ายวันที่ X ถูกลบวันที่ X + 30 ตอนตี 3 โดย Edge Function "cleanup-images"
-- ที่ pg_cron เรียกทุกวัน (ตั้งค่าใน supabase/retention_cron.sql)
-- เว็บแจ้งเตือนก่อนวันลบ 7 วันและ 1 วันจาก retention_upcoming()
-- ต้องลบไฟล์ผ่าน Storage API เพราะลบแถวใน storage.objects ด้วย SQL ตรงๆ ไฟล์จริงจะไม่ถูกลบ
-- -----------------------------------------------------------------------------

-- รูปที่ถ่ายก่อนเวลานี้ถึงกำหนดลบแล้ว (= 00:00 น. ของวันที่ วันนี้ - 29 ตามเวลาไทย)
create or replace function public.retention_cutoff()
returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Bangkok')::date - 29)::timestamp at time zone 'Asia/Bangkok')
$$;

-- สำหรับเว็บ: จำนวนรูปที่จะถูกลบในวันนี้ถึงอีก 7 วัน แยกตามวันที่ลบ (security invoker จึงผ่าน RLS ของ captures)
create or replace function public.retention_upcoming()
returns table (delete_on date, images bigint)
language sql stable security invoker set search_path = public as $$
  select (c.captured_at at time zone 'Asia/Bangkok')::date + 30 as delete_on, count(*) as images
  from public.captures c
  where c.image_path is not null
    and c.captured_at >= (((now() at time zone 'Asia/Bangkok')::date - 30)::timestamp at time zone 'Asia/Bangkok')
    and c.captured_at <  (((now() at time zone 'Asia/Bangkok')::date - 22)::timestamp at time zone 'Asia/Bangkok')
  group by 1
  order by 1
$$;

-- สำหรับ Edge Function เท่านั้น: path ของไฟล์ที่ถึงกำหนดลบ
-- ใช้เวลาถ่ายจาก captures ถ้ามี ไม่งั้น (ไฟล์ที่ไม่มีแถว captures อ้างถึง) ใช้เวลาอัปโหลด
create or replace function public.retention_expired_objects(p_limit integer default 500)
returns table (name text)
language sql stable security definer set search_path = public, storage as $$
  select o.name
  from storage.objects o
  left join public.captures c on c.image_path = o.name
  where o.bucket_id = 'captures'
    and coalesce(c.captured_at, o.created_at) < public.retention_cutoff()
  order by coalesce(c.captured_at, o.created_at)
  limit greatest(1, least(p_limit, 1000))
$$;

-- สำหรับ Edge Function เท่านั้น: ล้าง image_path ของรูปที่ถึงกำหนดลบ คืนจำนวนแถว
create or replace function public.retention_mark_expired()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.captures
     set image_path = null, image_deleted_at = now()
   where image_path is not null and captured_at < public.retention_cutoff();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.retention_upcoming() from public, anon;
grant execute on function public.retention_upcoming() to authenticated;
revoke all on function public.retention_expired_objects(integer) from public, anon, authenticated;
revoke all on function public.retention_mark_expired() from public, anon, authenticated;
grant execute on function public.retention_expired_objects(integer) to service_role;
grant execute on function public.retention_mark_expired() to service_role;

-- -----------------------------------------------------------------------------
-- Realtime: หน้า dashboard / devices subscribe ตารางเหล่านี้ (ยังผ่าน RLS)
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['inspections', 'devices', 'device_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- (ไม่บังคับ) ตั้ง status = offline อัตโนมัติด้วย pg_cron
-- เว็บคำนวณออนไลน์จาก last_heartbeat_at เองอยู่แล้ว ส่วนนี้มีไว้ให้ค่าในตารางตรงกัน
-- เปิด extension pg_cron ใน Database → Extensions ก่อน แล้วค่อยเอา comment ออก
-- -----------------------------------------------------------------------------
-- select cron.schedule('mark-devices-offline', '* * * * *', $$
--   update public.devices set status = 'offline'
--   where status = 'online' and last_heartbeat_at < now() - interval '3 minutes'
-- $$);

-- -----------------------------------------------------------------------------
-- ข้อมูลเริ่มต้น: แก้อีเมลและชื่ออุปกรณ์ แล้วเอา comment ออกก่อนรัน
-- -----------------------------------------------------------------------------
insert into public.profiles (email) values ('ggttyyrr7@gmail.com') on conflict do nothing;
--
-- สร้างบัญชีอุปกรณ์ใน Authentication → Users → Add user (email/password, Auto Confirm)
-- แล้วผูกกับเครื่อง:
-- insert into public.devices (name, location, auth_user_id)
-- values ('Pi-01 · จุดตรวจ A', 'อาคารผลิต 1 · ประตูทางเข้า',
--         (select id from auth.users where email = 'pi-01@devices.local'));
