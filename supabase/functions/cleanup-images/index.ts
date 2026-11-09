// Edge Function: ลบรูปที่เก็บครบ 30 วันออกจาก bucket "captures"
// pg_cron เรียกทุกวันตอนตี 3 (เวลาไทย) ดู supabase/retention_cron.sql
// กติกาว่ารูปไหนถึงกำหนดลบอยู่ในฐานข้อมูล (public.retention_cutoff) ที่เดียว
//
// ป้องกันคนอื่นเรียก: ต้องส่ง header x-cleanup-secret ตรงกับ secret CLEANUP_SECRET
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้ใน Edge Function อัตโนมัติ (ไม่ต้องตั้งเอง และห้ามใส่ในเว็บ/Pi)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BUCKET = 'captures';
const BATCH = 500;      // Storage API ลบได้สูงสุด 1000 ไฟล์ต่อครั้ง
const MAX_ROUNDS = 40;  // สูงสุด 20,000 ไฟล์ต่อการรันหนึ่งครั้ง ที่เหลือรอรอบถัดไป

Deno.serve(async (req) => {
  const secret = Deno.env.get('CLEANUP_SECRET');
  if (!secret || req.headers.get('x-cleanup-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  let removed = 0;
  const errors: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data: rows, error } = await sb.rpc('retention_expired_objects', { p_limit: BATCH });
    if (error) { errors.push('list: ' + error.message); break; }
    const names = (rows ?? []).map((r: { name: string }) => r.name);
    if (!names.length) break;

    const { data: gone, error: delError } = await sb.storage.from(BUCKET).remove(names);
    if (delError) { errors.push('remove: ' + delError.message); break; }
    removed += gone?.length ?? 0;
    if (!gone?.length) { errors.push('remove: ไม่มีไฟล์ถูกลบ หยุดเพื่อไม่ให้วนไม่จบ'); break; }
  }

  // ล้าง image_path ของรูปที่ถึงกำหนด (รวมแถวที่ไฟล์หายไปก่อนแล้ว) ให้เว็บขึ้นว่า "ลบตามนโยบายแล้ว"
  const { data: marked, error: markError } = await sb.rpc('retention_mark_expired');
  if (markError) errors.push('mark: ' + markError.message);

  const result = { removed, marked: marked ?? 0, errors, at: new Date().toISOString() };
  console.log(JSON.stringify(result));
  return Response.json(result, { status: errors.length ? 500 : 200 });
});
