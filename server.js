'use strict';
/**
 * Livora Quotation Studio – server
 * Node.js (built-in http) + MongoDB (official driver). No other dependencies.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'livora';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_HOURS = parseFloat(process.env.SESSION_HOURS || '72');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 12 * 1024 * 1024;

/* ------------------------------------------------------------------ helpers */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8'
};
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {});
  if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body); h['Content-Type'] = 'application/json; charset=utf-8';
  }
  res.writeHead(status, h); res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body;
    try { body = req.body; }
    catch (e) { return reject(new HttpError(400, 'Body is not valid JSON')); }
    if (body !== undefined) {
      if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return resolve(body);
      try { return resolve(JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body))); }
      catch (e) { return reject(new HttpError(400, 'Body is not valid JSON')); }
    }

    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request is too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new HttpError(400, 'Body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

/* --------------------------------------------------------------------- auth */
function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(data) { return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url'); }
function makeToken() {
  const payload = b64u(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
  return payload + '.' + sign(payload);
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function tokenValid(token) {
  if (!token || token.indexOf('.') < 0) return false;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig, sign(payload))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > Date.now(); }
  catch (e) { return false; }
}
const attempts = new Map(); // ip -> {n, until}
function throttle(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now() && a.n >= 8) throw new HttpError(429, 'Too many wrong passwords. Wait a few minutes and try again.');
}
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { n: 1, until: Date.now() + 10 * 60 * 1000 });
  else a.n++;
}

/* -------------------------------------------------------------------- model */
function pickQuotation(b) {
  // Only keep known, sanitised fields. Large free-text blobs are fine, unknown keys are dropped.
  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 2000);
  const rows = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 400).map((r) => ({ a: str(r && r.a), b: str(r && r.b), c: str(r && r.c) }));
  const d = b.desc || {}, h = b.hw || {}, v = b.value || {}, p = b.pay || {}, c = b.client || {};
  const n = (x, dflt) => { x = parseFloat(x); return Number.isFinite(x) ? x : dflt; };
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null,
    client: { name: str(c.name, 300), address: str(c.address, 1000), phone: str(c.phone, 60) },
    desc: {
      title: str(d.title, 200), showScope: d.showScope !== false, showHead: d.showHead !== false,
      heads: [0, 1, 2].map((i) => str((d.heads || [])[i], 80)), rows: rows(d.rows)
    },
    hw: { show: h.show !== false, title: str(h.title, 200), rows: rows(h.rows) },
    value: { amount: str(v.amount, 30), wordsOverride: str(v.wordsOverride, 400), suffix: str(v.suffix, 40) },
    pay: {
      adv: n(p.adv, 0), mid: n(p.mid, 0), midAt: n(p.midAt, 0), days: n(p.days, 0),
      warranty: n(p.warranty, 0), maint: n(p.maint, 0), validity: n(p.validity, 0), showAmts: !!p.showAmts
    },
    terms: (Array.isArray(b.terms) ? b.terms : []).slice(0, 40).map((t) => ({
      title: str(t && t.title, 200), items: (Array.isArray(t && t.items) ? t.items : []).slice(0, 60).map((x) => str(x, 1200))
    })),
    approval: str(b.approval, 3000),
    signers: (Array.isArray(b.signers) ? b.signers : []).slice(0, 8).map((x) => str(x, 120))
  };
}
function pickSettings(b) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 500);
  const cover = typeof b.cover === 'string' && b.cover.startsWith('data:image/') && b.cover.length < 8 * 1024 * 1024 ? b.cover : '';
  return {
    name: str(b.name, 200), address: str(b.address, 500), website: str(b.website, 200),
    facebook: str(b.facebook, 200), instagram: str(b.instagram, 200), phone: str(b.phone, 60),
    cover, drawLabels: !!b.drawLabels
  };
}
function monthKey(date) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
  return 'LIV-' + d.slice(2, 4) + d.slice(5, 7);
}
const pad = (n, w) => String(n).padStart(w, '0');

/* ---------------------------------------------------------------------- app */
async function createApp(db, ObjectId) {
  const Q = db.collection('quotations'), C = db.collection('counters'), S = db.collection('settings');
  await Q.createIndex({ qtnNo: 1 }, { unique: true });
  await Q.createIndex({ updatedAt: -1 });

  const oid = (id) => { try { return new ObjectId(String(id)); } catch (e) { throw new HttpError(400, 'Invalid quotation id'); } };
  const unwrap = (r) => (r && Object.prototype.hasOwnProperty.call(r, 'value') && !r.seq ? r.value : r);
  const isDup = (e) => e && (e.code === 11000 || /E11000/.test(String(e.message)));

  async function nextSerial(key) {
    const r = unwrap(await C.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }));
    return r.seq;
  }
  async function peekSerial(key) { const r = await C.findOne({ _id: key }); return (r ? r.seq : 0) + 1; }
  const fmtNo = (key, n) => key + '-' + pad(n, 4);

  const out = (doc) => (doc ? Object.assign({}, doc, { _id: String(doc._id) }) : doc);

  async function handle(req, res, url) {
    const m = req.method, p = url.pathname;

    if (p === '/api/health' && m === 'GET') {
      await db.command({ ping: 1 });
      return send(res, 200, { ok: true, db: DB_NAME });
    }
    if (p === '/api/login' && m === 'POST') {
      const ip = req.socket.remoteAddress || 'x';
      throttle(ip);
      const b = await readJson(req);
      if (!safeEqual(b.password || '', ADMIN_PASSWORD)) { failed(ip); throw new HttpError(401, 'Wrong password'); }
      attempts.delete(ip);
      return send(res, 200, { token: makeToken(), hours: SESSION_HOURS });
    }

    if (p.startsWith('/api/')) {
      const auth = req.headers.authorization || '';
      if (!tokenValid(auth.startsWith('Bearer ') ? auth.slice(7) : '')) throw new HttpError(401, 'Please log in');
    }

    if (p === '/api/settings') {
      if (m === 'GET') { const s = await S.findOne({ _id: 'company' }); return send(res, 200, { settings: s ? (delete s._id, s) : null }); }
      if (m === 'PUT') {
        const data = pickSettings(await readJson(req));
        await S.updateOne({ _id: 'company' }, { $set: data }, { upsert: true });
        return send(res, 200, { settings: data });
      }
    }

    if (p === '/api/quotations/next' && m === 'GET') {
      const key = monthKey(url.searchParams.get('date'));
      return send(res, 200, { qtnNo: fmtNo(key, await peekSerial(key)) });
    }

    if (p === '/api/quotations' && m === 'GET') {
      const full = url.searchParams.get('full') === '1';
      const docs = await Q.find({}).sort({ updatedAt: -1 }).limit(2000).toArray();
      return send(res, 200, {
        quotations: docs.map((d) => full ? out(d) : ({
          _id: String(d._id), qtnNo: d.qtnNo, date: d.date, clientName: (d.client || {}).name || '',
          amount: (d.value || {}).amount || '', updatedAt: d.updatedAt
        }))
      });
    }

    if (p === '/api/quotations' && m === 'POST') {
      const b = await readJson(req), data = pickQuotation(b), now = new Date();
      const auto = b.qtnAuto !== false || !String(b.qtnNo || '').trim();
      const key = monthKey(data.date);
      for (let tries = 0; tries < 25; tries++) {
        const qtnNo = auto ? fmtNo(key, await nextSerial(key)) : String(b.qtnNo).trim().slice(0, 40);
        try {
          const doc = Object.assign({ qtnNo, createdAt: now, updatedAt: now }, data);
          const r = await Q.insertOne(doc);
          return send(res, 201, { quotation: out(Object.assign({ _id: r.insertedId }, doc)) });
        } catch (e) {
          if (!isDup(e)) throw e;
          if (!auto) throw new HttpError(409, 'Quotation number ' + qtnNo + ' is already used');
        }
      }
      throw new HttpError(500, 'Could not find a free quotation number');
    }

    const mm = /^\/api\/quotations\/([^/]+)$/.exec(p);
    if (mm) {
      const _id = oid(mm[1]);
      if (m === 'GET') {
        const d = await Q.findOne({ _id });
        if (!d) throw new HttpError(404, 'Quotation not found');
        return send(res, 200, { quotation: out(d) });
      }
      if (m === 'PUT') {
        const b = await readJson(req), data = pickQuotation(b), set = Object.assign({ updatedAt: new Date() }, data);
        const wanted = String(b.qtnNo || '').trim().slice(0, 40);
        if (wanted) set.qtnNo = wanted;
        try { await Q.updateOne({ _id }, { $set: set }); }
        catch (e) { if (isDup(e)) throw new HttpError(409, 'Quotation number ' + wanted + ' is already used'); throw e; }
        const d = await Q.findOne({ _id });
        if (!d) throw new HttpError(404, 'Quotation not found');
        return send(res, 200, { quotation: out(d) });
      }
      if (m === 'DELETE') {
        const r = await Q.deleteOne({ _id });
        if (!r.deletedCount) throw new HttpError(404, 'Quotation not found');
        return send(res, 200, { ok: true });
      }
    }

    if (p.startsWith('/api/')) throw new HttpError(404, 'Unknown API route');
    return serveStatic(req, res, p);
  }

  function serveStatic(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel = decodeURIComponent(p);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
    let st;
    try { st = fs.statSync(file); } catch (e) { throw new HttpError(404, 'Not found'); }
    if (!st.isFile()) throw new HttpError(404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    try { await handle(req, res, new URL(req.url, 'http://localhost')); }
    catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Server error. Check the server window for details.' });
    }
  });
}

/* -------------------------------------------------------------------- start */
async function main() {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.startsWith('change-this')) { console.error('Set ADMIN_PASSWORD in the .env file.'); process.exit(1); }
  if (!SESSION_SECRET || SESSION_SECRET.length < 16 || SESSION_SECRET.startsWith('change-this')) { console.error('Set SESSION_SECRET (16+ characters) in the .env file.'); process.exit(1); }
  const { MongoClient, ObjectId } = require('mongodb');
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try { await client.connect(); await client.db(DB_NAME).command({ ping: 1 }); }
  catch (e) { console.error('Cannot connect to MongoDB at ' + MONGODB_URI.replace(/\/\/[^@]*@/, '//***@') + '\n' + e.message); process.exit(1); }
  const server = await createApp(client.db(DB_NAME), ObjectId);
  server.listen(PORT, () => console.log('Livora Quotation Studio is running at http://localhost:' + PORT + '  (database: ' + DB_NAME + ')'));
  const stop = () => server.close(() => client.close().then(() => process.exit(0)));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

let vercelServerPromise;
async function vercelHandler(req, res) {
  try {
    if (!ADMIN_PASSWORD || ADMIN_PASSWORD.startsWith('change-this')) throw new Error('ADMIN_PASSWORD is not configured');
    if (!SESSION_SECRET || SESSION_SECRET.length < 16 || SESSION_SECRET.startsWith('change-this')) throw new Error('SESSION_SECRET is not configured');
    if (!vercelServerPromise) {
      const { MongoClient, ObjectId } = require('mongodb');
      const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      vercelServerPromise = (async () => {
        await client.connect();
        await client.db(DB_NAME).command({ ping: 1 });
        return createApp(client.db(DB_NAME), ObjectId);
      })().catch((e) => {
        vercelServerPromise = null;
        throw e;
      });
    }
    const server = await vercelServerPromise;
    server.emit('request', req, res);
  } catch (e) {
  console.error('VERCEL ERROR:', e.stack || e.message || e);

  if (!res.headersSent) {
    send(res, 500, {
      error: e.message || 'Unknown initialization error'
    });
  } else {
    res.end();
  }
}




// Export the handler function for Vercel
module.exports = vercelHandler;

// Keep helper functions available
module.exports.createApp = createApp;
module.exports.makeToken = makeToken;
module.exports.monthKey = monthKey;

// Start normally when running locally
if (require.main === module) {
  main();
}
