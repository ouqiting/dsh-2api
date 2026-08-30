/**
 * Standalone behaviour check for the EPSE regeneration guard.
 *
 * Runs the plugin's two listeners against a REAL `Session` (so surface and
 * invariant rules apply verbatim) and a minimal fake Cordis context. Verifies:
 *  1. a framed reply is converted into a request failure, so the loop never
 *     appends an `assistant/message` for it;
 *  2. the guard claims that failure and returns `{ kind: 'retry' }`, recording
 *     the `llm/retry` / `llm/retry-started` pair the UI resets the step on;
 *  3. a clean reply passes through untouched;
 *  4. the per-step budget stops a second forced failure.
 */

import assert from 'node:assert/strict';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { markAgentLoopRequest, createUserMessage } from '@deepseek-ai/dsh-llm';
import { apply } from './index.js';

/** Collect the plugin's listeners without a real Cordis fiber. */
function fakeContext(session) {
  const listeners = { 'llm/stream': [], 'agent/request-error': [] };
  const ctx = {
    sessions: { get: (id) => (id === session.id ? session : undefined) },
    logger: { warn: () => {} },
    on: (event, listener) => {
      listeners[event].push(listener);
      return () => {};
    },
  };
  return { ctx, listeners };
}

/** Open a turn and step so the guard can locate its retry position. */
function openTurnAndStep(session, turn, step) {
  session.append('turn/start', { turn });
  session.append('step/start', { turn, step });
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  );
  session.append('request/header', {
    header: { config: { provider: 'ds2api', model: 'test-model' } },
    reason: 'initial',
  });
}

function request(session) {
  return markAgentLoopRequest(
    Object.freeze({
      provider: 'ds2api',
      model: 'test-model',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }),
  );
}

async function drain(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

const framedChunks = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'sure, calling <|EPSE' },
  { type: 'text-delta', index: 0, text: 'tool|> ... </|EPSE|>' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'sure, calling <|EPSEtool|> ... </|EPSE|>' } },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
  { type: 'finish', reason: { kind: 'stop' } },
];

const cleanChunks = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'an ordinary answer' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'an ordinary answer' } },
  { type: 'finish', reason: { kind: 'stop' } },
];

async function* stream(chunks) {
  for (const chunk of chunks) yield chunk;
}

// ---------------------------------------------------------------- framed reply
{
  const session = Session.create(SessionId('sess-framed'));
  const { ctx, listeners } = fakeContext(session);
  apply(ctx, {});
  openTurnAndStep(session, 1, 1);

  const guardStream = listeners['llm/stream'][0];
  const chunks = await drain(guardStream(request(session), () => stream(framedChunks)));
  const finish = chunks.at(-1);

  assert.equal(finish.type, 'finish', 'stream must still end with a finish chunk');
  assert.equal(finish.reason.kind, 'error', 'a framed reply must end as a request failure');
  assert.equal(finish.reason.failure.code, 'EPSE_TOOL_CALL_FRAME');
  assert.ok(
    chunks.some((chunk) => chunk.type === 'text-delta'),
    'earlier chunks pass through so streaming stays live',
  );
  assert.ok(
    !chunks.some((chunk) => chunk.type === 'finish' && chunk.reason.kind === 'stop'),
    'the successful finish must not reach the assembler',
  );

  const recover = listeners['agent/request-error'][0];
  const decision = await recover(
    {
      agent: { session, options: { provider: 'ds2api', model: 'test-model' } },
      turn: 1,
      step: 1,
      provider: 'ds2api',
      failure: finish.reason.failure,
      retryPolicy: undefined,
      signal: new AbortController().signal,
    },
    () => Promise.resolve(undefined),
  );

  assert.deepEqual(decision, { kind: 'retry' }, 'the guard must claim its own failure and retry');

  const retry = session.events.findLast((event) => event.type === 'llm/retry');
  const started = session.events.findLast((event) => event.type === 'llm/retry-started');
  assert.ok(retry, 'a durable llm/retry record must exist');
  assert.equal(retry.data.turn, 1);
  assert.equal(retry.data.step, 1);
  assert.equal(retry.data.retry, 1);
  assert.equal(retry.data.provider, 'ds2api');
  assert.equal(retry.data.delayMs, 0);
  assert.ok(started, 'a durable llm/retry-started record must exist');
  assert.equal(started.data.retryId, retry.data.retryId);
  assert.equal(started.data.retry, 1);

  assert.ok(
    !session.events.some((event) => event.type === 'assistant/message'),
    'the malformed reply never becomes a surface message',
  );
  assert.equal(session.deriveMessages().length, 1, 'model history keeps only the user request');

  console.log('ok  framed reply becomes a claimed request failure and a durable retry');
}

// ----------------------------------------------------------------- clean reply
{
  const session = Session.create(SessionId('sess-clean'));
  const { ctx, listeners } = fakeContext(session);
  apply(ctx, {});
  openTurnAndStep(session, 1, 1);

  const guardStream = listeners['llm/stream'][0];
  const chunks = await drain(guardStream(request(session), () => stream(cleanChunks)));
  assert.deepEqual(chunks, cleanChunks, 'a clean reply must pass through byte-for-byte');

  const recover = listeners['agent/request-error'][0];
  let delegated = false;
  const decision = await recover(
    {
      agent: { session, options: {} },
      turn: 1,
      step: 1,
      provider: 'ds2api',
      failure: { message: 'rate limited', code: 'RATE_LIMIT' },
      retryPolicy: undefined,
      signal: new AbortController().signal,
    },
    () => {
      delegated = true;
      return Promise.resolve(undefined);
    },
  );
  assert.ok(delegated, 'a foreign failure must be delegated downstream');
  assert.equal(decision, undefined);

  console.log('ok  clean replies and foreign failures are untouched');
}

// ----------------------------------------------- explicit budget ceiling of 1
{
  const session = Session.create(SessionId('sess-budget'));
  const { ctx, listeners } = fakeContext(session);
  apply(ctx, { maxRegenerationsPerTurn: 1 });
  openTurnAndStep(session, 1, 1);

  const guardStream = listeners['llm/stream'][0];
  const first = await drain(guardStream(request(session), () => stream(framedChunks)));
  assert.equal(first.at(-1).reason.kind, 'error', 'first framed attempt is failed');

  const second = await drain(guardStream(request(session), () => stream(framedChunks)));
  assert.equal(
    second.at(-1).reason.kind,
    'stop',
    'budget exhausted: the reply lands instead of failing the turn forever',
  );

  console.log('ok  an explicit budget of 1 forces exactly one regeneration');
}

// ------------------------------------------------------- default budget of two
{
  const session = Session.create(SessionId('sess-default-budget'));
  const { ctx, listeners } = fakeContext(session);
  apply(ctx, {}); // no maxRegenerationsPerTurn: the default applies
  openTurnAndStep(session, 1, 1);

  const guardStream = listeners['llm/stream'][0];
  const outcomes = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const chunks = await drain(guardStream(request(session), () => stream(framedChunks)));
    outcomes.push(chunks.at(-1).reason.kind);
  }
  assert.deepEqual(
    outcomes,
    ['error', 'error', 'stop'],
    'the default budget forces two regenerations, then lets the third reply land',
  );

  // Each forced failure is claimed and recorded, numbering 1 then 2 on one chain.
  const recover = listeners['agent/request-error'][0];
  for (const expected of [1, 2]) {
    const decision = await recover(
      {
        agent: { session, options: { provider: 'ds2api', model: 'test-model' } },
        turn: 1,
        step: 1,
        provider: 'ds2api',
        failure: { message: 'framed', code: 'EPSE_TOOL_CALL_FRAME' },
        retryPolicy: undefined,
        signal: new AbortController().signal,
      },
      () => Promise.resolve(undefined),
    );
    assert.deepEqual(decision, { kind: 'retry' });
    const retry = session.events.findLast((event) => event.type === 'llm/retry');
    assert.equal(retry.data.retry, expected, 'retry numbering must increment on one chain');
    assert.ok(retry.data.maxRetries >= expected, 'maxRetries must cover the attempt number');
  }
  const chain = new Set(
    session.events.filter((e) => e.type === 'llm/retry').map((e) => e.data.retryId),
  );
  assert.equal(chain.size, 1, 'both attempts share one retryId chain');

  console.log('ok  the default budget is two regenerations on a single retry chain');
}

// --------------------------------------------------- out-of-scope route bypass
{
  const session = Session.create(SessionId('sess-scope'));
  const { ctx, listeners } = fakeContext(session);
  apply(ctx, { targetProviders: ['some-other-provider'] });
  openTurnAndStep(session, 1, 1);

  const guardStream = listeners['llm/stream'][0];
  const chunks = await drain(guardStream(request(session), () => stream(framedChunks)));
  assert.equal(chunks.at(-1).reason.kind, 'stop', 'an out-of-scope route is not guarded');

  console.log('ok  targetProviders narrows the guard to declared routes');
}

console.log('\nall checks passed');
