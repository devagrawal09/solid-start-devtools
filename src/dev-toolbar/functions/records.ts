import type { CallEvent, CallLive, CallRequestEvent } from '@solidjs/web';
import {
  callRecordToEvents,
  pushServerFunctionCall,
  requestRecordToEvent,
  settleRecordToEvents,
  type ServerFunctionCall,
} from './tracker.js';

/**
 * The slice of `OBSERVE.records` the panel subscribes to: the `"request"`
 * record (the request was handed to `fetch`) and the `"call"` record (the
 * call settled), each with its bodies. Structural, so a test can hand in a
 * fake channel.
 */
export interface CallRecordsChannel {
  subscribe(
    type: 'request',
    listener: (event: CallRequestEvent, live: CallLive) => void,
    options?: { bodies?: boolean },
  ): () => void;
  subscribe(
    type: 'call',
    listener: (event: CallEvent, live: CallLive) => void,
    options?: { bodies?: boolean },
  ): () => void;
}

/**
 * The panel's key for each call the records showed, by the runtime's live
 * object for the call. Other panels get the live object from the `"call"`
 * record too, so they can point the panel at the same call.
 */
const shownCalls = new WeakMap<object, string>();

/** The panel's key for a call, from the live object of its `"call"` record. */
export function instanceOfCall(live: object): string | undefined {
  return shownCalls.get(live);
}

/**
 * Feeds the server-function panel from the runtime's records. A call shows
 * up when its request is sent and completes when it settles; the two
 * records are joined by the `live` object, which the runtime hands to both
 * listeners for one call. A settled call whose request this never saw (the
 * subscription came mid-call) is shown whole from its `"call"` record.
 * Returns the unsubscribe.
 */
export function connectCallRecords(
  records: CallRecordsChannel,
  push: (event: ServerFunctionCall) => void = pushServerFunctionCall,
): () => void {
  let calls = 0;
  const instances = new WeakMap<CallLive, string>();
  const key = (id: string) => `${id}#${++calls}`;

  const offRequest = records.subscribe(
    'request',
    (event, live) => {
      const instance = key(event.id);
      const shown = requestRecordToEvent(event, live, instance);
      if (!shown) return;
      instances.set(live, instance);
      push(shown);
    },
    { bodies: true },
  );
  const offCall = records.subscribe(
    'call',
    (event, live) => {
      const instance = instances.get(live) ?? key(event.id);
      const events = instances.has(live)
        ? settleRecordToEvents(event, live, instance)
        : callRecordToEvents(event, live, instance);
      instances.delete(live);
      if (events.length) shownCalls.set(live, instance);
      for (const call of events) push(call);
    },
    { bodies: true },
  );
  return () => {
    offRequest();
    offCall();
  };
}
