# Supabase — ฐานข้อมูลของระบบตรวจ PPE

ไฟล์สำหรับสร้างฐานข้อมูล Supabase ใหม่ทั้งหมด (ใช้คู่กับ branch `web` และ `pi5`)

| ไฟล์ | ทำอะไร |
|---|---|
| `supabase/schema.sql` | ตาราง, RLS, trigger, ฟังก์ชัน retention (รันซ้ำได้) |
| `supabase/functions/cleanup-images/index.ts` | Edge Function ลบรูปที่เก่ากว่า 30 วัน |
| `supabase/retention_cron.sql` | ตั้ง pg_cron เรียก cleanup-images ทุกวันตี 3 เวลาไทย |
| `supabase/tests/*.sql` | เทสต์ RLS และ retention (รันใน SQL Editor) |

## ลำดับการสร้างฐานข้อมูลใหม่

1. สร้างโปรเจกต์ใน Supabase แล้วรัน `supabase/schema.sql` ทั้งไฟล์ใน SQL Editor
2. Deploy Edge Function: `supabase functions deploy cleanup-images`
3. Database → Extensions เปิด `pg_cron` และ `pg_net`
4. แก้ project ref ใน `supabase/retention_cron.sql` (บรรทัด `url :=`) เป็นของโปรเจกต์ตัวเอง แล้วรันทั้งไฟล์
5. คัดลอกค่า `cleanup_secret` ที่ได้จากข้อ 4 ไปใส่ Edge Functions → Secrets ชื่อ `CLEANUP_SECRET`
6. รันเทสต์ใน `supabase/tests/` ทีละไฟล์ใน SQL Editor ต้องผ่านทุกข้อ
7. ใส่ URL + publishable key ของโปรเจกต์ใหม่ใน `js/supabase.js` (branch `web`) และ `.env` (branch `pi5`)

## ห้าม commit

`service_role` key, `CLEANUP_SECRET` และไฟล์ `.env` ทุกชนิด (กันไว้ใน `.gitignore` แล้ว)
