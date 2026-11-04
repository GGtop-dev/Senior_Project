// ตัวรัน unit test ขนาดเล็กที่ใช้ร่วมกันในหน้า tests/*.test.html (ไม่ต้องใช้ Node)
// แต่ละไฟล์ test เรียก test(name, fn) แล้วจบด้วย runTests()
// ต้องมี <div id="summary">, <ul id="results"> และ <div id="fixture"> ในหน้า

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || 'ไม่เท่ากัน'}\n  ได้:     ${a}\n  คาดว่า: ${e}`);
}
async function assertRejects(promise, check, message) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  if (!err) throw new Error(message || 'คาดว่าจะ throw แต่ไม่ throw');
  if (check) check(err);
  return err;
}

async function runTests() {
  const list = document.getElementById('results');
  const results = [];
  const origError = console.error;
  for (const t of tests) {
    fakeSb.reset();
    if (typeof window.beforeEachTest === 'function') await window.beforeEachTest();
    console.error = () => {}; // โค้ดที่ทดสอบ log error ตามปกติ ไม่ต้องแสดงตอนทดสอบ
    let error = null;
    try { await t.fn(); } catch (e) { error = e; }
    console.error = origError;
    results.push({ name: t.name, ok: !error, error: error ? String(error.message || error) : null });
    const li = document.createElement('li');
    li.className = error ? 'fail' : 'pass';
    li.textContent = `${error ? '✗' : '✓'} ${t.name}`;
    if (error) {
      const pre = document.createElement('pre');
      pre.textContent = error.message || String(error);
      li.appendChild(pre);
    }
    list.appendChild(li);
  }
  document.getElementById('fixture').innerHTML = '';
  const failed = results.filter((r) => !r.ok).length;
  const summary = document.getElementById('summary');
  summary.dataset.status = failed ? 'fail' : 'pass';
  summary.textContent = failed
    ? `ไม่ผ่าน ${failed} จาก ${results.length} test`
    : `ผ่านทั้งหมด ${results.length} test`;
  window.__TEST_RESULTS__ = { passed: results.length - failed, failed, results };

}
