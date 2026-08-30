/**
 * EPSE tool-call regeneration guard — Host-side Cordis plugin.
 *
 * When the model writes an EPSE tool-call frame (an opening tag and a closing
 * tag, paired) into its TEXT reply instead of issuing a native tool call, this
 * guard treats that response as a failed model request and lets the agent loop
 * retry it in place.
 *
 * Mechanism (two halves of one native path, no deletion and no re-prompting):
 *
 *  1. `llm/stream` — the guard wraps the provider stream, watches only the
 *     model's text deltas, and when the frame appears it swaps the terminal
 *     `finish` chunk for a `{ kind: 'error' }` finish carrying
 *     {@link FAILURE_CODE}. Because the attempt now ends in failure, the loop
 *     never appends an `assistant/message` for it: the malformed reply never
 *     reaches the model-visible surface, so nothing has to be removed later.
 *
 *  2. `agent/request-error` — the guard claims that exact failure code, records
 *     the durable `llm/retry` / `llm/retry-started` pair, and returns
 *     `{ kind: 'retry' }`. The loop re-requests inside the SAME turn and step
 *     from the unchanged derived history, so the original user request is not
 *     replayed and no second user bubble appears. The `llm/retry` record also
 *     makes the conversation UI reset that step's assistant node, so the
 *     malformed reply disappears from the transcript and the regenerated reply
 *     renders in its place.
 *
 * Detection scope: ONLY model-generated text chunks. It never inspects written
 * files, tool results, tool arguments, reasoning, or log-only events.
 */

import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';

export const name = 'epse-regeneration-guard';
export const inject = ['sessions', 'agents'];

/** Provider-neutral failure code this guard mints and exclusively claims. */
const FAILURE_CODE = 'EPSE_TOOL_CALL_FRAME';
/** Canonical policy identity separating this guard's retry chains from real ones. */
const POLICY_KEY = 'epse-regeneration-guard/v1';
/** Human-readable failure recorded with every claimed attempt. */
const FAILURE_MESSAGE = 'model emitted an EPSE tool-call frame as text instead of a native tool call';
/** Forced regenerations allowed per step when the config does not say otherwise. */
const DEFAULT_MAX_PER_STEP = 2;

export function apply(ctx, config) {
  const cfg = config || {};
  // Provider/model routes to restrict to; empty set = apply to ALL agents.
  const targets = new Set(Array.isArray(cfg.targetProviders) ? cfg.targetProviders : []);
  // Max forced regenerations per (session, turn, step) to avoid infinite loops.
  const maxPerStep =
    typeof cfg.maxRegenerationsPerTurn === 'number' && cfg.maxRegenerationsPerTurn >= 1
      ? Math.floor(cfg.maxRegenerationsPerTurn)
      : DEFAULT_MAX_PER_STEP;

  /** session -> Map<`turn:step`, forced failures already injected>. */
  const forced = new WeakMap();

  const normalize = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase();

  // Rule: the text contains BOTH an EPSE opening tag and an EPSE closing tag.
  // NFKC maps full-width forms (＜, ＥＰＳＥ) to ASCII; lowercasing handles case.
  // Opening: <|epse or <epse; Closing: </|epse or </epse.
  const hasEpseFrame = (text) => {
    const t = normalize(text);
    return /<\|?epse/.test(t) && /<\/\|?epse/.test(t);
  };

  const routeInScope = (provider, model) =>
    targets.size === 0 || targets.has(provider) || targets.has(model);

  const agentInScope = (agent) => {
    if (targets.size === 0) return true; // empty = every agent
    const opt = (agent && agent.options) || {};
    return targets.has(opt.provider) || targets.has(opt.model);
  };

  /** The turn/step currently open in a session log, or undefined outside one. */
  const openStep = (session) => {
    const events = session.events;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.type === 'step/start') return { turn: event.data.turn, step: event.data.step };
      if (event.type === 'step/end' || event.type === 'turn/end' || event.type === 'turn/start') return;
    }
    return undefined;
  };

  const budget = (session) => {
    let counts = forced.get(session);
    if (!counts) {
      counts = new Map();
      forced.set(session, counts);
    }
    return counts;
  };

  const mintRetryId = () =>
    `epse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  /** Accumulate one chunk's model-facing TEXT, ignoring every other block kind. */
  const textOf = (chunk) => {
    if (chunk.type === 'text-delta') return typeof chunk.text === 'string' ? chunk.text : '';
    if (chunk.type === 'block-end') {
      const block = chunk.block;
      return block && block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    }
    return '';
  };

  /**
   * Wrap one provider stream and end a framed attempt as a request failure.
   * @param options - the frozen request being streamed.
   * @param next - the downstream stream this listener wraps.
   */
  async function* guardStream(options, next) {
    const source = next();

    // Only ordinary loop-built conversation requests are eligible: auxiliary
    // calls (compaction, session titles) and hand-built one-shots are not this
    // guard's business, and neither owns a turn/step to retry inside.
    const session =
      options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId);
    if (
      session === undefined ||
      options.purpose !== undefined ||
      !isAgentLoopRequest(options) ||
      !routeInScope(options.provider, options.model)
    ) {
      yield* source;
      return;
    }

    const position = openStep(session);
    if (position === undefined) {
      yield* source;
      return;
    }

    const counts = budget(session);
    const key = `${position.turn}:${position.step}`;
    const used = counts.get(key) || 0;
    // Budget exhausted: let the reply land normally rather than failing the turn.
    if (used >= maxPerStep) {
      yield* source;
      return;
    }

    let text = '';
    let framed = false;
    let finished = false;
    const failureFinish = () => ({
      type: 'finish',
      reason: { kind: 'error', failure: { message: FAILURE_MESSAGE, code: FAILURE_CODE } },
    });
    for await (const chunk of source) {
      if (!framed) {
        const added = textOf(chunk);
        if (added !== '') {
          text += added;
          framed = hasEpseFrame(text);
        }
      }
      // Replace only a plain successful finish. `tool-calls` means the model DID
      // issue a native call, which is the correct format and never this guard's
      // business; an already-failed, aborted, or truncated attempt keeps its own
      // outcome and its own recovery owner.
      if (framed && chunk.type === 'finish' && chunk.reason?.kind === 'stop') {
        counts.set(key, used + 1);
        yield failureFinish();
        return;
      }
      if (chunk.type === 'finish') finished = true;
      yield chunk;
    }
    // A stream that ended without any terminal finish would be assembled as a
    // successful `stop`, landing the malformed reply. Close it as this guard's
    // failure instead.
    if (framed && !finished) {
      counts.set(key, used + 1);
      yield failureFinish();
    }
  }

  ctx.on('llm/stream', (options, next) => guardStream(options, next));

  /**
   * Claim the guard's own failure code and retry the step from unchanged history.
   * Any other failure is delegated downstream verbatim.
   */
  ctx.on(
    'agent/request-error',
    async (payload, next) => {
      const { agent, turn, step, provider, failure } = payload;
      if (!failure || failure.code !== FAILURE_CODE) return next();
      if (!agent || !agentInScope(agent)) return next();
      const session = agent.session;
      if (!session) return next();

      // Durably record the forced retry so the conversation UI resets this
      // step's assistant node (dropping the malformed reply from the
      // transcript) and renders the regenerated reply in its place.
      try {
        const prior = session.events.findLast(
          (event) =>
            event.type === 'llm/retry' &&
            event.data.turn === turn &&
            event.data.step === step &&
            event.data.provider === provider &&
            event.data.policyKey === POLICY_KEY,
        );
        const retry = (prior?.data.retry ?? 0) + 1;
        const retryId = prior?.data.retryId ?? mintRetryId();
        session.append('llm/retry', {
          retryId,
          turn,
          step,
          provider,
          mode: 'normal',
          policyKey: POLICY_KEY,
          retry,
          maxRetries: Math.max(maxPerStep, retry),
          delayMs: 0,
          failure,
        });
        session.append('llm/retry-started', { retryId, turn, step, retry });
      } catch (error) {
        // The durable notice is presentation, not correctness: regenerate anyway.
        ctx.logger?.warn?.('epse-regeneration-guard: could not record the forced retry: %o', error);
      }

      return { kind: 'retry' };
    },
    { prepend: true },
  );
}
