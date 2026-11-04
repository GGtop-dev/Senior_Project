// ---------------------------------------------------------------------------
// ตั้งค่า Supabase
// ใส่ค่าจาก Supabase → Project Settings → API ใส่ได้เฉพาะ anon key เท่านั้น
// ห้ามใส่ service_role key ในไฟล์นี้ เพราะทุกคนที่เปิดเว็บอ่านได้
// ถ้ายังเป็นค่า YOUR_PROJECT อยู่ เว็บจะรันใน "โหมดตัวอย่าง" ด้วยข้อมูลจาก js/mock-data.js
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://gbvjhoolyapfrwyhjvra.supabase.co';
// ใส่ publishable key (sb_publishable_...) หรือ legacy anon key
const SUPABASE_ANON_KEY = 'sb_publishable_PPhC5yW0R47BJZr0TvFrfg_kNPqclHS';

const DEMO = SUPABASE_URL.includes('YOUR_PROJECT') || SUPABASE_ANON_KEY.startsWith('YOUR_');
const OFFLINE_AFTER_MS = 3 * 60 * 1000; // ไม่ได้รับ heartbeat เกิน 3 นาที = ออฟไลน์
const SIGNED_URL_TTL = 600;              // signed URL หมดอายุใน 10 นาที
const IMAGE_BUCKET = 'captures';         // bucket แบบ private
const MAX_ATTEMPTS = 3;

const sb = DEMO ? null : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const NEVER = new Promise(() => {});

// ---------- Auth ----------

// เรียกที่หัวทุกหน้า (ยกเว้น index.html) ถ้ายังไม่ login หรืออีเมลไม่อยู่ใน profiles จะส่งกลับหน้า login
async function requireAuth() {
  if (DEMO) return { email: 'demo@example.com', role: 'admin' };

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.replace('index.html');
    return NEVER;
  }
  const { data: profile, error } = await sb
    .from('profiles')
    .select('email, role')
    .eq('email', session.user.email)
    .maybeSingle();
  if (error || !profile) {
    await sb.auth.signOut();
    location.replace('index.html?error=unauthorized');
    return NEVER;
  }
  return profile;
}

function signInWithGoogle() {
  return sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: new URL('dashboard.html', location.href).href },
  });
}

async function signOut() {
  if (!DEMO) await sb.auth.signOut();
  location.href = 'index.html';
}

// ---------- Data ----------

const INSPECTION_SELECT =
  '*, devices(name, location), captures(attempt_no, detections, inference_ms, image_path, captured_at)';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

// f: { from: Date, to: Date (ไม่รวม), deviceId, status, search }
function applyFilters(q, f) {
  if (f.from) q = q.gte('started_at', f.from.toISOString());
  if (f.to) q = q.lt('started_at', f.to.toISOString());
  if (f.deviceId) q = q.eq('device_id', f.deviceId);
  if (f.status) q = q.eq('status', f.status);
  // id เป็น uuid ค้นหาบางส่วนผ่าน PostgREST ไม่ได้ จึงค้นได้เฉพาะรหัสเต็ม
  if (f.search) q = q.eq('id', UUID_RE.test(f.search) ? f.search : NO_MATCH_ID);
  return q;
}

function demoMatch(r, f) {
  const t = new Date(r.started_at);
  if (f.from && t < f.from) return false;
  if (f.to && t >= f.to) return false;
  if (f.deviceId && r.device_id !== f.deviceId) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.search && !r.id.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}

function demoWithRelations(r) {
  const d = MOCK.devices.find((x) => x.id === r.device_id);
  return {
    ...r,
    devices: d ? { name: d.name, location: d.location } : null,
    captures: MOCK.capturesByInspection[r.id] || [],
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (s) => String(s ?? '').trim().toLowerCase();

const REVIEW_VALUES = ['correct', 'incorrect'];

function reviewDenied() {
  const err = new Error('บัญชีนี้ไม่มีสิทธิ์ตรวจทาน หรือไม่พบการตรวจนี้');
  err.code = 'REVIEW_DENIED';
  return err;
}

const api = {
  async devices() {
    if (DEMO) return MOCK.devices.map((d) => ({ ...d }));
    const { data, error } = await sb.from('devices').select('*').order('name');
    if (error) throw error;
    return data;
  },

  // คืน { rows, count } เรียงจากใหม่ไปเก่า
  // ตัวเลือกเพิ่ม: page/pageSize, countOnly, select: 'summary' (ไม่ดึง captures)
  async inspections(f = {}) {
    if (DEMO) {
      const all = MOCK.inspections.filter((r) => demoMatch(r, f));
      if (f.countOnly) return { rows: [], count: all.length };
      let rows = all;
      if (f.pageSize) {
        const s = (f.page - 1) * f.pageSize;
        rows = all.slice(s, s + f.pageSize);
      }
      return { rows: rows.map(demoWithRelations), count: all.length };
    }

    const select = f.countOnly
      ? 'id'
      : f.select === 'summary'
        ? 'id, status, missing_items, started_at, device_id'
        : f.select === 'people' // หน้าแจ้งเตือน: ต้องรู้ว่าเป็นพนักงานคนไหน
          ? 'id, status, missing_items, started_at, device_id, employee_id, employees(name, employee_code, department)'
          : INSPECTION_SELECT;
    let q = sb.from('inspections').select(select, { count: 'exact', head: !!f.countOnly });
    q = applyFilters(q, f).order('started_at', { ascending: false });
    if (f.pageSize) {
      const s = (f.page - 1) * f.pageSize;
      q = q.range(s, s + f.pageSize - 1);
    }
    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: data || [], count: count ?? 0 };
  },

  async countByStatus(f = {}) {
    const keys = ['all', 'passed', 'failed', 'undetermined'];
    const res = await Promise.all(
      keys.map((k) => this.inspections({ ...f, status: k === 'all' ? null : k, countOnly: true })),
    );
    return Object.fromEntries(keys.map((k, i) => [k, res[i].count]));
  },

  async inspection(id) {
    if (DEMO) {
      const r = MOCK.inspections.find((x) => x.id === id);
      return r ? demoWithRelations(r) : null;
    }
    if (!UUID_RE.test(id)) return null;
    const { data, error } = await sb.from('inspections').select(INSPECTION_SELECT).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async events(limit = 20) {
    if (DEMO) {
      return MOCK.events.slice(0, limit).map((e) => ({
        ...e,
        devices: { name: MOCK.devices.find((d) => d.id === e.device_id)?.name },
      }));
    }
    const { data, error } = await sb
      .from('device_events')
      .select('*, devices(name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async signedUrl(path) {
    if (DEMO || !path) return null;
    const { data, error } = await sb.storage.from(IMAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    if (error) throw error;
    return data.signedUrl;
  },

  // บันทึกผลตรวจทาน คืนแถวที่แก้แล้ว { id, review, reviewed_by, reviewed_at }
  // RLS ให้ update ได้เฉพาะ admin แต่ถ้าไม่มีสิทธิ์ Supabase จะไม่ตอบ error เพียงแก้ได้ 0 แถว
  // จึงต้องขอแถวที่แก้กลับมา (select) แล้วเช็คเอง ไม่อย่างนั้นเว็บจะขึ้นว่าบันทึกแล้วทั้งที่ไม่ได้บันทึก
  async review(id, value) {
    if (!REVIEW_VALUES.includes(value)) throw new Error(`ค่าตรวจทานไม่ถูกต้อง: ${value}`);
    if (DEMO) {
      const r = MOCK.inspections.find((x) => x.id === id);
      if (!r) throw reviewDenied();
      Object.assign(r, { review: value, reviewed_by: 'demo@example.com', reviewed_at: new Date().toISOString() });
      return { id: r.id, review: r.review, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at };
    }
    const { data, error } = await sb
      .from('inspections')
      .update({ review: value })
      .eq('id', id)
      .select('id, review, reviewed_by, reviewed_at');
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) throw reviewDenied();
    return data[0];
  },

  // เหตุการณ์ของอุปกรณ์ตามช่วงเวลาและประเภท (หน้าแจ้งเตือน)
  async eventsSince(from, types) {
    if (DEMO) {
      return MOCK.events
        .filter((e) => new Date(e.created_at) >= from && (!types || types.includes(e.type)))
        .map((e) => ({ ...e, devices: { name: MOCK.devices.find((d) => d.id === e.device_id)?.name } }));
    }
    let q = sb.from('device_events').select('*, devices(name)').gte('created_at', from.toISOString());
    if (types) q = q.in('type', types);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return data;
  },

  // ---------- สมาชิก (profiles) ----------
  // ทุกคนเป็น admin; trigger profiles_guard ใส่ added_by, ทำอีเมลเป็นตัวเล็ก
  // และกันการลบบัญชีตัวเอง / ลบจนไม่เหลือใคร

  async profiles() {
    if (DEMO) return MOCK.profiles.map((p) => ({ ...p }));
    const { data, error } = await sb
      .from('profiles')
      .select('id, email, role, added_by, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  async addProfile(email, addedBy) {
    const clean = normalizeEmail(email);
    if (!EMAIL_RE.test(clean)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    if (DEMO) {
      if (MOCK.profiles.some((p) => p.email === clean)) throw new Error('อีเมลนี้อยู่ในรายชื่อแล้ว');
      const row = { id: crypto.randomUUID(), email: clean, role: 'admin', added_by: addedBy || null, created_at: new Date().toISOString() };
      MOCK.profiles.push(row);
      return { ...row };
    }
    const { data, error } = await sb
      .from('profiles')
      .insert({ email: clean })
      .select('id, email, role, added_by, created_at');
    if (error) {
      if (error.code === '23505') throw new Error('อีเมลนี้อยู่ในรายชื่อแล้ว');
      throw error;
    }
    if (!data?.length) throw new Error('ไม่ได้บันทึก: บัญชีนี้ไม่มีสิทธิ์เพิ่มสมาชิก');
    return data[0];
  },

  async removeProfile(id, myEmail) {
    if (DEMO) {
      const i = MOCK.profiles.findIndex((p) => p.id === id);
      if (i < 0) throw new Error('ไม่พบสมาชิกนี้');
      if (MOCK.profiles[i].email === normalizeEmail(myEmail)) throw new Error('ลบบัญชีของตัวเองไม่ได้');
      if (MOCK.profiles.length <= 1) throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
      MOCK.profiles.splice(i, 1);
      return;
    }
    const { data, error } = await sb.from('profiles').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('ไม่ได้ลบ: ไม่พบสมาชิกนี้ หรือบัญชีนี้ไม่มีสิทธิ์');
  },

  // Realtime: เรียก cb เมื่อตารางมีการเปลี่ยนแปลง คืนฟังก์ชันสำหรับยกเลิก
  // ชื่อ channel ต้องไม่ซ้ำ เพราะหน้าเดียวอาจ subscribe ตารางเดียวกันหลายที่ (หน้า + กระดิ่ง)
  subscribe(table, cb) {
    if (DEMO) return () => {};
    const ch = sb
      .channel(`rt-${table}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, cb)
      .subscribe();
    return () => sb.removeChannel(ch);
  },
};
