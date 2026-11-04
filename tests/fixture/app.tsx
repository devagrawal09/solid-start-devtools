import { render } from '@solidjs/web';
import { DevToolbar, mountDevToolbar, pushServerFunctionCall } from '@solidjs/start-devtools';
import { serializeString } from '@solidjs/web/server-functions/client';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';

function Broken(): never {
  throw new Error('client boom');
}

const serverFunctionInstance = 'load-user-1';
let responseStatus = 201;

function emitServerFunctionRequest() {
  pushServerFunctionCall({
    type: 'request',
    id: 'load-user',
    instance: serverFunctionInstance,
    source: new Request('/_server', { method: 'POST', body: '{}' }),
    meta: { name: 'loadUser' },
    time: 10,
  });
}

function emitServerFunctionResponse() {
  pushServerFunctionCall({
    type: 'response',
    id: 'load-user',
    instance: serverFunctionInstance,
    source: new Response('{}', { status: responseStatus }),
    meta: { name: 'loadUser' },
    time: 20,
  });
  responseStatus = 500;
}

// A call whose arguments hold a file, as `enableRichArguments` sends it.
async function emitUploadRequest() {
  const form = new FormData();
  form.set('args', await serializeString([{ note: 'avatar' }]));
  form.set('file0', new Blob(['hello'], { type: 'text/plain' }), 'avatar.txt');
  pushServerFunctionCall({
    type: 'request',
    id: 'upload-avatar',
    instance: 'upload-avatar-1',
    source: new Request('/_server', {
      method: 'POST',
      body: form,
      headers: { 'X-Server-Function-Format': '0' },
    }),
    meta: { name: 'uploadAvatar' },
    time: 30,
  });
}

// Reads a signal in its body, outside any tracking scope, which the runtime
// reports as a warning.
function DraftReader() {
  const [draft] = createSignal('draft text', { name: 'draft' });
  const text = draft();
  return <p id="fixture-draft">{text}</p>;
}

function Greeting(props: { name: string }) {
  return <p id="fixture-greeting">{`hello ${props.name}`}</p>;
}

function Counter() {
  const [count, setCount] = createSignal(0, { name: 'count' });
  const doubled = createMemo(() => count() * 2, { name: 'doubled' });

  createEffect(
    () => doubled(),
    (value) => {
      Reflect.set(window, '__doubled', value);
    },
    { name: 'report-doubled' },
  );

  return (
    <button id="increment-count" onClick={() => setCount((value) => value + 1)}>
      {`count ${count()} doubled ${doubled()}`}
    </button>
  );
}

function App() {
  const [broken, setBroken] = createSignal(false);
  const [writer, setWriter] = createSignal(false);

  return (
    <main>
      <p id="fixture-content">app content</p>
      <Greeting name="ada" />
      <Counter />
      <button id="emit-server-function-request" onClick={emitServerFunctionRequest}>
        emit server function request
      </button>
      <button id="emit-server-function-response" onClick={emitServerFunctionResponse}>
        emit server function response
      </button>
      <button id="emit-upload-request" onClick={emitUploadRequest}>
        emit upload request
      </button>
      <button id="emit-warning" onClick={() => setWriter((value) => !value)}>
        emit warning
      </button>
      <Show when={writer()}>
        <DraftReader />
      </Show>
      <button id="throw-client-error" onClick={() => setBroken(true)}>
        throw client error
      </button>
      <Show when={broken()}>
        <Broken />
      </Show>
    </main>
  );
}

if (new URLSearchParams(location.search).has('mount')) {
  const first = mountDevToolbar();
  const second = mountDevToolbar();
  Object.assign(window, {
    __disposeToolbar: first,
    __sameDispose: first === second,
  });
} else {
  render(
    () => (
      <DevToolbar>
        <App />
      </DevToolbar>
    ),
    document.getElementById('app')!,
  );
}
