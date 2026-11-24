'use strict';
// Tiny in-memory stand-in for the parts of the MongoDB driver that server.js uses.
// Used only by the tests, so they run without a database.
const crypto = require('node:crypto');
class ObjectId {
  constructor(v) {
    if (v === undefined) v = crypto.randomBytes(12).toString('hex');
    if (v instanceof ObjectId) v = v.hex;
    if (!/^[0-9a-f]{24}$/i.test(String(v))) throw new Error('bad ObjectId');
    this.hex = String(v).toLowerCase();
  }
  toString() { return this.hex; }
}
const keyOf = (v) => (v instanceof ObjectId ? 'oid:' + v.hex : 'v:' + String(v));
const clone = (o) => {
  if (o instanceof ObjectId) return o;
  if (o instanceof Date) return new Date(o.getTime());
  if (Array.isArray(o)) return o.map(clone);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = clone(o[k]); return r; }
  return o;
};
class Collection {
  constructor() { this.docs = []; this.unique = []; }
  async createIndex(spec, opts) { if (opts && opts.unique) this.unique.push(Object.keys(spec)[0]); }
  match(d, q) { return Object.keys(q).every((k) => keyOf(d[k]) === keyOf(q[k])); }
  checkUnique(doc, ignore) {
    for (const f of this.unique) {
      if (this.docs.some((d) => d !== ignore && d[f] !== undefined && d[f] === doc[f])) {
        const e = new Error('E11000 duplicate key error ' + f); e.code = 11000; throw e;
      }
    }
  }
  async findOne(q) { const d = this.docs.find((x) => this.match(x, q)); return d ? clone(d) : null; }
  find(q) {
    let list = this.docs.filter((x) => this.match(x, q || {})).map(clone), lim = Infinity;
    const c = {
      sort(s) { const [k, dir] = Object.entries(s)[0]; list.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); return c; },
      limit(n) { lim = n; return c; },
      async toArray() { return list.slice(0, lim); }
    };
    return c;
  }
  async insertOne(doc) {
    const d = Object.assign({ _id: new ObjectId() }, clone(doc));
    this.checkUnique(d); this.docs.push(d);
    return { insertedId: d._id };
  }
  async updateOne(q, upd, opts) {
    let d = this.docs.find((x) => this.match(x, q));
    if (!d) { if (!(opts && opts.upsert)) return { matchedCount: 0 }; d = Object.assign({}, q); this.docs.push(d); }
    const next = Object.assign({}, d, clone(upd.$set || {}));
    this.checkUnique(next, d);
    Object.assign(d, next);
    return { matchedCount: 1 };
  }
  async findOneAndUpdate(q, upd, opts) {
    let d = this.docs.find((x) => this.match(x, q));
    if (!d) { if (!(opts && opts.upsert)) return null; d = Object.assign({}, q); this.docs.push(d); }
    for (const [k, v] of Object.entries(upd.$inc || {})) d[k] = (d[k] || 0) + v;
    return clone(d);
  }
  async deleteOne(q) {
    const i = this.docs.findIndex((x) => this.match(x, q));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
}
class Db {
  constructor() { this.c = {}; }
  collection(n) { return this.c[n] || (this.c[n] = new Collection()); }
  async command() { return { ok: 1 }; }
}
module.exports = { Db, ObjectId };
