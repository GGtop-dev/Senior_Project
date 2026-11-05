# โปรแกรมฝั่ง Raspberry Pi

ตรวจ PPE ด้วย YOLO ตัดสินผล สั่งลำโพง แล้วส่งผลขึ้น Supabase ให้หน้าเว็บใน `web/`

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `main.py` | จุดเริ่ม, heartbeat และ event ของอุปกรณ์, `--selftest` |
| `inspector.py` | ขั้นตอนการตรวจหนึ่งครั้ง (สูงสุด 3 รอบ) |
| `hardware.py` | โมเดล, กล้อง, ลำโพง, อุณหภูมิ CPU |
| `outbox.py` | คิวบนดิสก์ (SQLite) และตัวส่งข้อมูลที่ส่งย้อนหลังได้เมื่อเน็ตกลับมา |
| `supabase_client.py` | เรียก Auth, Database และ Storage ของ Supabase ผ่าน REST |
| `config.py`, `.env.example` | ค่าตั้งทั้งหมด |
| `ppe-pi.service` | ให้รันเองตอนเปิดเครื่องด้วย systemd |

## ลำดับการตรวจ

1. รอจนเจอ PPE ในเฟรมติดกัน 3 เฟรม (โมเดลไม่มีคลาส `person` จึงใช้ PPE แทนการเจอคน)
2. ถ่ายแล้วตรวจ ถ้าสวมครบตาม `REQUIRED_ITEMS` ได้ **ผ่าน** ทันที
3. ถ้ายังขาด ลำโพงบอกว่าขาดอะไร แล้วรอ 4 วินาทีก่อนถ่ายรอบใหม่ ครบ 3 รอบแล้วยังขาดถือว่า **ไม่ผ่าน**
4. ถ้ารอบไหนไม่เจออะไรเลย (คนเดินออก) ถือว่า **ตรวจไม่ได้**
5. ใส่ผลลงคิว แล้วรอให้คนออกจากจุดก่อนเริ่มตรวจคนถัดไป

ผลตรวจทุกครั้งลงคิวในเครื่องก่อน เน็ตหลุดหรือไฟดับก็ไม่หาย ส่งซ้ำได้โดยไม่เกิดข้อมูลซ้ำ เพราะ Pi สร้าง uuid ของการตรวจเอง เก็บรูปทุกครั้งที่ไม่ผ่านหรือตรวจไม่ได้ ส่วนครั้งที่ผ่านเก็บแค่ 20% (`PASSED_IMAGE_RATE`)

## ติดตั้ง

**ฝั่ง Supabase** (ทำครั้งเดียวต่อเครื่อง)

1. รัน `supabase/schema.sql` ใน SQL Editor
2. Authentication → Users → Add user สร้างบัญชีอุปกรณ์ เช่น `pi-01@devices.local` แล้วติ๊ก Auto Confirm
3. ผูกบัญชีกับเครื่อง:

   ```sql
   insert into public.devices (name, location, auth_user_id)
   values ('Pi-01 · จุดตรวจ A', 'อาคารผลิต 1 · ประตูทางเข้า',
           (select id from auth.users where email = 'pi-01@devices.local'));
   ```

**ฝั่ง Pi** (Raspberry Pi OS 64-bit, Python 3.10 ขึ้นไป)

```bash
sudo apt install -y python3-venv alsa-utils espeak-ng
cp -r pi ~/ppe-pi && cd ~/ppe-pi
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp ../newtrain/runs/A4/weights/best.pt models/best.pt   # หรือ copy จากเครื่อง train
cp .env.example .env && nano .env                         # ใส่ URL, anon key, บัญชีอุปกรณ์
.venv/bin/python main.py --selftest                       # ทดสอบการเชื่อมต่อ
.venv/bin/python main.py                                  # รันจริง (Ctrl+C เพื่อหยุด)
```

`--selftest` จะ login, ส่ง heartbeat และส่งผลตรวจทดสอบหนึ่งรายการ (ตรวจไม่ได้, รุ่นโมเดล `selftest`) ถ้าผ่านจะเห็นรายการในหน้าประวัติ แล้วค่อยลบทิ้ง

ให้รันเองตอนเปิดเครื่อง:

```bash
sudo cp ppe-pi.service /etc/systemd/system/
sudo systemctl enable --now ppe-pi
journalctl -u ppe-pi -f
```

## ปรับแต่ง

- **สิ่งที่ต้องสวม:** `REQUIRED_ITEMS` ใน `.env` ใช้ชื่อคลาสแบบตัวเล็กคั่นด้วย `_` (`gloves`, `helmet`, `mask`, `protective_apron`, `safety_shoes`, `sleeve`, `jeans`, `non_jeans_pants`, `safety_glasses`) ค่าเริ่มต้นคือหมวก, ถุงมือ, รองเท้านิรภัย และกางเกงที่ไม่ใช่ยีนส์ ต้องปรับให้ตรงกฎของหน้างาน
- **เสียง:** ใส่ไฟล์ `sounds/passed.wav`, `failed.wav`, `undetermined.wav`, `missing.wav` ถ้าไม่มีไฟล์จะใช้ espeak-ng อ่านข้อความภาษาไทยแทน `DRY_SOUND=true` จะพิมพ์ข้อความลง log แทนการเล่นเสียง
- **ความเร็ว:** export โมเดลเป็น NCNN (`yolo export model=best.pt format=ncnn imgsz=960`) แล้วตั้ง `MODEL_PATH=models/best_ncnn_model` จะเร็วกว่า `.pt` บน Pi มาก

## ข้อจำกัด

- โมเดลไม่มีคลาส `person` ถ้าคนที่ไม่สวม PPE เลยสักชิ้นมายืน ระบบจะไม่เริ่มตรวจ ถ้าจะแก้ต้องเพิ่มคลาส person ตอน train
- อุปกรณ์ใช้ anon key กับบัญชีของตัวเอง RLS ให้เพิ่มข้อมูลได้แค่ของเครื่องตัวเอง ห้ามใส่ `service_role` key ในเครื่อง
