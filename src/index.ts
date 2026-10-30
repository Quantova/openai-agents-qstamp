// Copyright 2026 Quantova Inc
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type {
  DigestAlgorithm,
  QstampModule,
  Receipt,
  Span,
  StampRecord,
  Trace,
  TracingProcessor,
} from './types.js';

export type {
  DigestAlgorithm,
  QstampModule,
  Receipt,
  Span,
  StampRecord,
  Trace,
  TracingProcessor,
} from './types.js';

export interface QstampTracingProcessorOptions {
  qstamp: QstampModule;
  seed: Uint8Array;
  index: number;
  kind?: string | number | bigint;
  rpc?: string | string[];
  digestAlg?: DigestAlgorithm;
  flushOnTraceEnd?: boolean;
  project?: (span: Span) => unknown;
  onReceipts?: (receipts: Receipt[], traceId: string) => void;
  onError?: (error: unknown, traceId: string) => void;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + stableStringify((value as Record<string, unknown>)[key]));
  return '{' + entries.join(',') + '}';
}

function defaultProjection(span: Span): unknown {
  return {
    spanId: span.spanId,
    traceId: span.traceId,
    parentId: span.parentId ?? null,
    startedAt: span.startedAt ?? null,
    endedAt: span.endedAt ?? null,
    spanData: span.spanData ?? null,
  };
}

export class QstampTracingProcessor implements TracingProcessor {
  readonly #options: QstampTracingProcessorOptions;
  readonly #alg: DigestAlgorithm;
  readonly #flushOnTraceEnd: boolean;
  readonly #pending = new Map<string, StampRecord[]>();

  constructor(options: QstampTracingProcessorOptions) {
    if (!options || typeof options.qstamp !== 'object' || options.qstamp === null) {
      throw new Error('a qstamp module is required');
    }
    if (!(options.seed instanceof Uint8Array) || options.seed.length === 0) {
      throw new Error('a signing seed is required');
    }
    if (!Number.isInteger(options.index) || options.index < 0) {
      throw new Error('a whole account index is required');
    }
    this.#options = options;
    this.#alg = options.digestAlg ?? 'sha3-256';
    this.#flushOnTraceEnd = options.flushOnTraceEnd ?? true;
  }

  async onTraceStart(_trace: Trace): Promise<void> {}

  async onSpanStart(_span: Span): Promise<void> {}

  async onSpanEnd(span: Span): Promise<void> {
    if (typeof span?.traceId !== 'string' || typeof span?.spanId !== 'string') {
      return;
    }
    const project = this.#options.project ?? defaultProjection;
    const canonical = stableStringify(project(span));
    const digest = this.#options.qstamp.digestBytes(new TextEncoder().encode(canonical), this.#alg);
    const record: StampRecord = { digest: Uint8Array.from(digest), alg: this.#alg };
    const batch = this.#pending.get(span.traceId);
    if (batch) {
      batch.push(record);
    } else {
      this.#pending.set(span.traceId, [record]);
    }
  }

  async onTraceEnd(trace: Trace): Promise<void> {
    if (this.#flushOnTraceEnd && typeof trace?.traceId === 'string') {
      await this.#flushTrace(trace.traceId);
    }
  }

  async forceFlush(): Promise<void> {
    const ids = Array.from(this.#pending.keys());
    for (const id of ids) {
      await this.#flushTrace(id);
    }
  }

  async shutdown(_timeout?: number): Promise<void> {
    await this.forceFlush();
  }

  async #flushTrace(traceId: string): Promise<void> {
    const records = this.#pending.get(traceId);
    this.#pending.delete(traceId);
    if (!records || records.length === 0) {
      return;
    }
    try {
      const receipts = await this.#options.qstamp.stamp({
        seed: this.#options.seed,
        index: this.#options.index,
        records,
        ...(this.#options.kind !== undefined ? { kind: this.#options.kind } : {}),
        ...(this.#options.rpc !== undefined ? { rpc: this.#options.rpc } : {}),
      });
      this.#options.onReceipts?.(receipts, traceId);
    } catch (error) {
      if (this.#options.onError) {
        this.#options.onError(error, traceId);
        return;
      }
      throw error;
    }
  }
}

export default QstampTracingProcessor;
