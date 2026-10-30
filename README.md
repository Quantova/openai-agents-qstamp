# openai-agents-qstamp

Post quantum on chain provenance for OpenAI Agents traces.

This is a tracing processor for the OpenAI Agents SDK. It writes a tamper evident Qstamp anchor for every agent span and keeps the span data private. Only a 32 byte digest of each span leaves the process, so the agent inputs and outputs stay with you while the proof that they occurred in one exact form at a point in time is anchored on the Quantova network.

## Why this exists

Agent frameworks emit traces and spans, but they carry no cryptographic, signer bound, tamper evident record of what an agent did. A log can be edited after the fact and nothing detects it. This processor binds each span to a post quantum signed commitment so an auditor who holds the original span can prove it is genuine and unaltered, and cannot prove anything about a span they do not hold.

## Install

```
npm install @quantovainc/openai-agents-qstamp @quantovainc/qstamp
```

## Use

```ts
import { addTraceProcessor } from '@openai/agents';
import * as qstamp from '@quantovainc/qstamp';
import { QstampTracingProcessor } from '@quantovainc/openai-agents-qstamp';

addTraceProcessor(
  new QstampTracingProcessor({
    qstamp,
    seed: mySigningSeed,
    index: 0,
    kind: 7757,
    onReceipts(receipts, traceId) {
      store(traceId, receipts);
    },
  }),
);
```

Each span is projected to a canonical form and hashed with SHA3. The digests for a trace are batched and anchored when the trace ends, which keeps the on chain cost to one entry per batch. The receipts returned by the stamp call are handed back through the onReceipts callback for you to keep next to the records.

## What leaves the process

Only the 32 byte digest of each span. The raw span payload is never sent to the chain. An auditor recomputes the digest from the record you hold and checks it against the anchored commitment, so the content stays private.

## Options

The processor takes the Qstamp module, a signing seed, an account index, an optional record kind, an optional rpc endpoint, an optional digest algorithm, a flag to control whether it anchors when a trace ends, an optional projection function to choose what of a span is committed, and callbacks for receipts and for errors.

## Verifying

Receipts verify with the reference Qstamp SDK, or offline in Go with the qstamp-go module.

## Tests

```
npm run build
npm test
```

The suite covers batching and flush on trace end, the privacy property that raw span data never reaches the stamp call, a deterministic digest that does not depend on object key order, draining of pending traces on force flush and shutdown, error routing, and rejection of bad construction.

## License

Apache 2.0 or MIT. See the LICENSE files.
