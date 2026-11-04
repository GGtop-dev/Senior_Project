// supabase-js ปลอมสำหรับ unit test: บันทึกทุกการเรียก และตอบตามที่ test กำหนดใน fakeSb.respond
// ใช้แทน CDN ของ supabase-js โดยต้องโหลดก่อน js/supabase.js

const fakeSb = {
  calls: [],
  // (call) => { data, error } หรือ Promise ที่ reject (จำลองเน็ตหลุด)
  respond: () => ({ data: [], error: null }),
  reset() {
    this.calls = [];
    this.respond = () => ({ data: [], error: null });
  },
  from(table) {
    const call = { table, ops: [] };
    fakeSb.calls.push(call);
    const builder = {};
    ['select', 'update', 'insert', 'delete', 'eq', 'in', 'gte', 'lt', 'order', 'range', 'limit', 'maybeSingle'].forEach((op) => {
      builder[op] = (...args) => { call.ops.push([op, ...args]); return builder; };
    });
    // query builder ของ supabase-js เป็น thenable จะส่ง request เมื่อ await
    builder.then = (onOk, onErr) => Promise.resolve().then(() => fakeSb.respond(call)).then(onOk, onErr);
    return builder;
  },
  rpc(fn, args) {
    const call = { table: 'rpc:' + fn, ops: [['rpc', fn, args]] };
    fakeSb.calls.push(call);
    return { then: (onOk, onErr) => Promise.resolve().then(() => fakeSb.respond(call)).then(onOk, onErr) };
  },
  auth: { getSession: async () => ({ data: { session: null } }), signOut: async () => {} },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
};

window.supabase = { createClient: () => fakeSb };
