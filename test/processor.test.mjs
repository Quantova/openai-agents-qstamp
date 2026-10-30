import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { QstampTracingProcessor } from '../dist/index.js';

function fakeQstamp() {
  const calls = [];
  return {
    calls,
    digestBytes(bytes, alg) {
      return Uint8Array.from(createHash(alg === 'sha256' ? 'sha256' : 'sha3-256').update(bytes).digest());
    },
    async stamp(options) {
      calls.push(options);
      return options.records.map((r, i) => ({
        format: 'qstamp-receipt/1',
        chain: { id: 'Q-test', genesis: '00' },
        contract: 'Qc',
        kind: String(options.kind ?? '0'),
        record: { alg: r.alg ?? 'sha3-256', digest: Buffer.from(r.digest).toString('hex'), salt: '00' },
        proof: { index: i, size: options.records.length, path: [] },
        root: '00',
        anchor: { tx: 'tx' + i, height: 1, block: 'b', time: 1, sender: 'Qs' },
      }));
    },
  };
}

const seed = new Uint8Array(32).fill(7);

function span(traceId, spanId, data) {
  return { traceId, spanId, parentId: null, startedAt: 's', endedAt: 'e', spanData: data };
}

test('buffers spans per trace and flushes on trace end', async () => {
  const q = fakeQstamp();
  const receipts = [];
  const p = new QstampTracingProcessor({ qstamp: q, seed, index: 0, kind: 7757, onReceipts: (r, id) => receipts.push([id, r.length]) });
  await p.onTraceStart({ traceId: 't1' });
  await p.onSpanEnd(span('t1', 's1', { type: 'function', name: 'search' }));
  await p.onSpanEnd(span('t1', 's2', { type: 'generation', output: 'secret answer' }));
  assert.equal(q.calls.length, 0, 'nothing anchored before trace end');
  await p.onTraceEnd({ traceId: 't1' });
  assert.equal(q.calls.length, 1, 'one batch anchored');
  assert.equal(q.calls[0].records.length, 2);
  assert.deepEqual(receipts, [['t1', 2]]);
});

test('only digests leave, raw span data never reaches stamp', async () => {
  const q = fakeQstamp();
  const p = new QstampTracingProcessor({ qstamp: q, seed, index: 0 });
  await p.onSpanEnd(span('t2', 's1', { secret: 'do-not-leak-this-string' }));
  await p.onTraceEnd({ traceId: 't2' });
  const blob = JSON.stringify(q.calls, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));
  assert.ok(!blob.includes('do-not-leak-this-string'), 'span payload must not be present in stamp arguments');
  for (const r of q.calls[0].records) {
    assert.equal(r.digest.length, 32, 'each record carries a 32 byte digest only');
  }
});

test('digest is deterministic and independent of key order', async () => {
  const q = fakeQstamp();
  const p = new QstampTracingProcessor({ qstamp: q, seed, index: 0 });
  await p.onSpanEnd({ traceId: 't3', spanId: 's1', spanData: { a: 1, b: 2 } });
  await p.onSpanEnd({ traceId: 't3', spanId: 's1', spanData: { b: 2, a: 1 } });
  await p.onTraceEnd({ traceId: 't3' });
  const [d0, d1] = q.calls[0].records.map((r) => Buffer.from(r.digest).toString('hex'));
  assert.equal(d0, d1, 'canonical digest must not depend on object key order');
});

test('forceFlush and shutdown drain pending traces', async () => {
  const q = fakeQstamp();
  const p = new QstampTracingProcessor({ qstamp: q, seed, index: 0, flushOnTraceEnd: false });
  await p.onSpanEnd(span('t4', 's1', { type: 'function' }));
  await p.onSpanEnd(span('t5', 's1', { type: 'function' }));
  assert.equal(q.calls.length, 0);
  await p.forceFlush();
  assert.equal(q.calls.length, 2, 'both pending traces anchored on flush');
  await p.shutdown();
  assert.equal(q.calls.length, 2, 'nothing double anchored');
});

test('stamp failure is routed to onError and does not throw', async () => {
  const q = fakeQstamp();
  q.stamp = async () => {
    throw new Error('chain unreachable');
  };
  const errors = [];
  const p = new QstampTracingProcessor({ qstamp: q, seed, index: 0, onError: (e, id) => errors.push([id, String(e.message)]) });
  await p.onSpanEnd(span('t6', 's1', { type: 'function' }));
  await p.onTraceEnd({ traceId: 't6' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 't6');
});

test('rejects bad construction', () => {
  assert.throws(() => new QstampTracingProcessor({ qstamp: null, seed, index: 0 }));
  assert.throws(() => new QstampTracingProcessor({ qstamp: fakeQstamp(), seed: new Uint8Array(0), index: 0 }));
  assert.throws(() => new QstampTracingProcessor({ qstamp: fakeQstamp(), seed, index: -1 }));
});

test('empty trace does not anchor', async () => {
  const q = fakeQstamp();
  const p = new QstampTracingProcessor({ qstamp: q, seed, index: 0 });
  await p.onTraceEnd({ traceId: 'empty' });
  assert.equal(q.calls.length, 0);
});
