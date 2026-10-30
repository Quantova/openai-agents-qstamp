// Copyright 2026 Quantova Inc
// SPDX-License-Identifier: Apache-2.0 OR MIT

export interface Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentId?: string | null;
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
  readonly spanData?: unknown;
}

export interface Trace {
  readonly traceId: string;
  readonly name?: string;
}

export interface TracingProcessor {
  onTraceStart(trace: Trace): Promise<void>;
  onTraceEnd(trace: Trace): Promise<void>;
  onSpanStart(span: Span): Promise<void>;
  onSpanEnd(span: Span): Promise<void>;
  shutdown(timeout?: number): Promise<void>;
  forceFlush(): Promise<void>;
}

export type DigestAlgorithm = 'sha3-256' | 'sha256';

export interface StampRecord {
  digest: Uint8Array;
  alg?: DigestAlgorithm;
}

export interface Receipt {
  format: string;
  chain: { id: string; genesis: string };
  contract: string;
  kind: string;
  record: { alg: DigestAlgorithm; digest: string; salt: string };
  proof: { index: number; size: number; path: string[] };
  root: string;
  anchor: { tx: string; height: number; block: string; time: number; sender: string };
}

export interface StampOptions {
  seed: Uint8Array;
  index: number;
  records: StampRecord[];
  kind?: string | number | bigint;
  rpc?: string | string[];
  maxFee?: string | number;
  timeoutMs?: number;
}

export interface QstampModule {
  stamp(options: StampOptions): Promise<Receipt[]>;
  digestBytes(bytes: Uint8Array, alg?: DigestAlgorithm): Uint8Array;
}
