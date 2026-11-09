-- =============================================================================
-- ตั้งเวลาลบรูปอัตโนมัติทุกวัน ตี 3 เวลาไทย (= 20:00 UTC) รันครั้งเดียวหลัง deploy Edge Function
-- ก่อนรัน: Database → Extensions เปิด pg_cron และ pg_net
-- รันซ้ำได้: secret ไม่ถูกสร้างใหม่ และ job ชื่อเดิมถูกแทนที่
-- =============================================================================

-- 1) สร้าง secret สุ่มเก็บใน Vault (ถ้ายังไม่มี)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cleanup_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'cleanup_secret');
  end if;
end $$;

-- 2) ตั้ง job รายวัน
select cron.schedule(
  'cleanup-images',
  '0 20 * * *',
  $$
  select net.http_post(
    -- เปลี่ยน gbvjhoolyapfrwyhjvra เป็น project ref ของตัวเอง (Project Settings → General)
    url := 'https://gbvjhoolyapfrwyhjvra.supabase.co/functions/v1/cleanup-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- 3) ดูค่า secret เพื่อนำไปใส่ใน Edge Functions → Secrets ชื่อ CLEANUP_SECRET
--    (เอาไปใส่ที่เดียวนั้น ห้ามใส่ในเว็บ, Pi หรือ git)
select decrypted_secret as cleanup_secret from vault.decrypted_secrets where name = 'cleanup_secret';

-- ตรวจผลการรันย้อนหลัง:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'cleanup-images') order by start_time desc limit 5;
--   select status_code, content from net._http_response order by created desc limit 5;
-- ยกเลิก:
--   select cron.unschedule('cleanup-images');
