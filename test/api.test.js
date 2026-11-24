'use strict';
process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.SESSION_SECRET = 'a-long-test-secret-value-1234567890';
const assert = require('node:assert/strict');
const { Db, ObjectId } = require('./fake-mongo');
const { createApp } = require('../server');

let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

(async () => {
  const server = await createApp(new Db(), ObjectId);
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  let token = '';
  const call = async (method, url, body, tok) => {
    const r = await fetch(base + url, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, (tok === undefined ? token : tok) ? { Authorization: 'Bearer ' + (tok === undefined ? token : tok) } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text, headers: r.headers };
  };
  const sample = (over) => Object.assign({
    qtnAuto: true, date: '2026-11-24', client: { name: 'Global Venture', address: 'Sulthan Bathery', phone: '' },
    desc: { title: 'Detailed Description', showScope: true, showHead: true, heads: ['Area', 'Scope', 'Spec'], rows: [{ a: 'Kitchen', b: 'Cabinets', c: 'Plywood' }] },
    hw: { show: true, title: 'Hardware Specifications', rows: [{ a: 'Plywood', b: 'Trojan', c: '20 years' }] },
    value: { amount: '2448680', wordsOverride: '', suffix: 'ONLY' },
    pay: { adv: 60, mid: 30, midAt: 75, days: 70, warranty: 10, maint: 2, validity: 5, showAmts: false },
    terms: [{ title: '1. Payment Terms', items: ['{advance}% advance'] }], approval: 'ok', signers: ['A', 'B'], evil: '<script>', _id: 'hack'
  }, over || {});

  await t('health works without login', async () => { const r = await call('GET', '/api/health', undefined, ''); assert.equal(r.status, 200); });
  await t('API is closed without a token', async () => { assert.equal((await call('GET', '/api/quotations', undefined, '')).status, 401); });
  await t('wrong password is refused', async () => { assert.equal((await call('POST', '/api/login', { password: 'nope' }, '')).status, 401); });
  await t('right password gives a token', async () => {
    const r = await call('POST', '/api/login', { password: 'test-password-123' }, ''); assert.equal(r.status, 200);
    token = r.json.token; assert.ok(token.includes('.'));
  });
  await t('tampered token is refused', async () => {
    const bad = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
    assert.equal((await call('GET', '/api/quotations', undefined, bad)).status, 401);
  });
  await t('next number is LIV-2611-0001 before any save', async () => {
    assert.equal((await call('GET', '/api/quotations/next?date=2026-11-24')).json.qtnNo, 'LIV-2611-0001');
  });
  let first;
  await t('first save gets LIV-2611-0001', async () => {
    const r = await call('POST', '/api/quotations', sample()); assert.equal(r.status, 201);
    first = r.json.quotation; assert.equal(first.qtnNo, 'LIV-2611-0001');
  });
  await t('unknown fields and client-sent _id are dropped', async () => {
    assert.equal(first.evil, undefined); assert.notEqual(first._id, 'hack');
  });
  await t('second save gets 0002, peek shows 0003', async () => {
    assert.equal((await call('POST', '/api/quotations', sample())).json.quotation.qtnNo, 'LIV-2611-0002');
    assert.equal((await call('GET', '/api/quotations/next?date=2026-11-30')).json.qtnNo, 'LIV-2611-0003');
  });
  await t('a new month restarts at 0001', async () => {
    assert.equal((await call('POST', '/api/quotations', sample({ date: '2026-12-02' }))).json.quotation.qtnNo, 'LIV-2612-0001');
  });
  await t('20 saves at the same moment all get different numbers', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => call('POST', '/api/quotations', sample())));
    const nos = rs.map((r) => r.json.quotation.qtnNo);
    assert.equal(new Set(nos).size, 20); assert.ok(rs.every((r) => r.status === 201));
  });
  await t('manual number that already exists is refused (409)', async () => {
    const r = await call('POST', '/api/quotations', sample({ qtnAuto: false, qtnNo: 'LIV-2611-0001' })); assert.equal(r.status, 409);
  });
  await t('manual number that is free is saved', async () => {
    const r = await call('POST', '/api/quotations', sample({ qtnAuto: false, qtnNo: 'CUSTOM-7' })); assert.equal(r.json.quotation.qtnNo, 'CUSTOM-7');
  });
  await t('auto numbering skips a number taken manually', async () => {
    await call('POST', '/api/quotations', sample({ qtnAuto: false, qtnNo: 'LIV-2601-0002', date: '2026-01-05' }));
    const a = (await call('POST', '/api/quotations', sample({ date: '2026-01-06' }))).json.quotation.qtnNo;
    const b = (await call('POST', '/api/quotations', sample({ date: '2026-01-06' }))).json.quotation.qtnNo;
    assert.equal(a, 'LIV-2601-0001'); assert.equal(b, 'LIV-2601-0003');
  });
  await t('open one quotation', async () => {
    const r = await call('GET', '/api/quotations/' + first._id); assert.equal(r.json.quotation.client.name, 'Global Venture');
    assert.equal(r.json.quotation.value.amount, '2448680');
  });
  await t('update keeps the number and changes the data', async () => {
    const r = await call('PUT', '/api/quotations/' + first._id, sample({ qtnNo: first.qtnNo, client: { name: 'Changed', address: '', phone: '' } }));
    assert.equal(r.json.quotation.qtnNo, 'LIV-2611-0001'); assert.equal(r.json.quotation.client.name, 'Changed');
  });
  await t('update to a number used by another quotation is refused', async () => {
    assert.equal((await call('PUT', '/api/quotations/' + first._id, sample({ qtnNo: 'LIV-2611-0002' }))).status, 409);
  });
  await t('list shows newest first with summary fields', async () => {
    const r = await call('GET', '/api/quotations'); assert.ok(r.json.quotations.length > 20);
    const q = r.json.quotations.find((x) => x._id === first._id); assert.equal(q.clientName, 'Changed'); assert.equal(q.amount, '2448680');
  });
  await t('bad id gives 400, missing id gives 404', async () => {
    assert.equal((await call('GET', '/api/quotations/zzz')).status, 400);
    assert.equal((await call('GET', '/api/quotations/' + new ObjectId())).status, 404);
  });
  await t('delete removes it', async () => {
    assert.equal((await call('DELETE', '/api/quotations/' + first._id)).status, 200);
    assert.equal((await call('GET', '/api/quotations/' + first._id)).status, 404);
    assert.equal((await call('DELETE', '/api/quotations/' + first._id)).status, 404);
  });
  await t('company settings save and load', async () => {
    assert.equal((await call('GET', '/api/settings')).json.settings, null);
    await call('PUT', '/api/settings', { name: 'Livora Interior Studio', phone: '+91 8921179724', drawLabels: false, cover: 'data:image/jpeg;base64,AAAA', junk: 1 });
    const s = (await call('GET', '/api/settings')).json.settings;
    assert.equal(s.phone, '+91 8921179724'); assert.equal(s.cover, 'data:image/jpeg;base64,AAAA'); assert.equal(s.junk, undefined);
  });
  await t('a non-image "cover" is ignored', async () => {
    await call('PUT', '/api/settings', { name: 'X', cover: 'javascript:alert(1)' });
    assert.equal((await call('GET', '/api/settings')).json.settings.cover, '');
  });
  await t('the app page is served', async () => {
    const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.match(await r.text(), /Quotation Studio/);
  });
  await t('files outside public/ cannot be read', async () => {
    const r = await fetch(base + '/..%2fserver.js'); assert.ok([403, 404].includes(r.status));
    const r2 = await fetch(base + '/%2e%2e/.env.example'); assert.ok([403, 404].includes(r2.status));
  });
  await t('unknown API route is 404', async () => { assert.equal((await call('GET', '/api/nothing')).status, 404); });
  await t('bad JSON is 400', async () => {
    const r = await fetch(base + '/api/quotations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: '{oops' });
    assert.equal(r.status, 400);
  });

  server.close();
  console.log('\n' + pass + ' checks passed' + (process.exitCode ? ', some FAILED' : ''));
})();
