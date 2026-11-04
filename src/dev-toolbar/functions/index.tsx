import { createEffect, createMemo, createSignal, For, Loading, Show } from 'solid-js';
import type { JSX } from '@solidjs/web';
import {
  BODY_FORMAT_FILE_KEY,
  BODY_FORMAT_KEY,
  BodyFormat,
  isUploadBody,
  splitUploadBody,
} from './body-format.js';
import { Badge } from '../../ui/Badge.js';
import IconButton from '../../ui/IconButton.js';
import Placeholder from '../../ui/Placeholder.js';
import { Section } from '../../ui/Section.js';
import { Select, SelectOption } from '../../ui/Select.js';
import { Tab, TabGroup, TabList, TabPanel } from '../../ui/Tabs.js';
import { Text } from '../../ui/Text.js';
import { TrashIcon } from '../icons.js';
import { CopyReportButton } from '../report/CopyReportButton.js';
import { readReportBody, serverFunctionReport } from '../report/function-report.js';
import { pageRoute } from '../report/markdown.js';
import { BlobViewer } from './BlobViewer.js';
import { FormDataViewer } from './FormDataViewer.js';
import { HeadersViewer } from './HeadersViewer.js';
import { HexViewer } from './HexViewer.js';
import { SerovalViewer } from './SerovalViewer.js';
import './styles.css';
import { type ServerFunctionRequest, type ServerFunctionResponse } from './tracker.js';
import { URLSearchParamsViewer } from './URLSearchParamsViewer.js';

async function getFile(source: Response | Request): Promise<File> {
  const formData = await source.formData();
  const file = formData.get(BODY_FORMAT_FILE_KEY);
  if (!(file && file instanceof File)) {
    throw new Error('invalid file input');
  }
  return file;
}

interface JsonViewerProps {
  source: Promise<string>;
}

// Plain-JSON bodies (JSON-safe argument lists go over the wire as raw JSON).
function JsonViewer(props: JsonViewerProps): JSX.Element {
  const data = createMemo(async () => {
    const text = await props.source;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  });

  return (
    <Loading>
      <Show when={data()} keyed>
        {(current) => (
          <pre data-solid-json-viewer>
            <Text options={{ size: 'xs', font: 'mono' }}>{current}</Text>
          </pre>
        )}
      </Show>
    </Loading>
  );
}

async function getURLSearchParams(source: Response | Request): Promise<URLSearchParams> {
  const text = await source.text();
  return new URLSearchParams(text);
}

interface UploadViewerProps {
  source: Request | Response;
}

// The arguments of a call that sends files, with its files beside them.
function UploadViewer(props: UploadViewerProps): JSX.Element {
  const parts = createMemo(() => splitUploadBody(props.source));

  return (
    <Loading>
      <Show when={parts()} keyed>
        {(current) => (
          <>
            <SerovalViewer stream={new Response(current.args)} />
            <FormDataViewer source={current.files} />
          </>
        )}
      </Show>
    </Loading>
  );
}

interface ContentViewerProps {
  source: ServerFunctionRequest | ServerFunctionResponse;
}

function ContentViewer(props: ContentViewerProps): JSX.Element {
  const body = createMemo(() => {
    const original = props.source.source;
    if (!original.body) {
      return undefined;
    }
    const source = original.clone();
    const startType = source.headers.get(BODY_FORMAT_KEY);
    const contentType = source.headers.get('Content-Type');
    switch (true) {
      case isUploadBody(source.headers):
        return <UploadViewer source={source} />;
      case startType === BodyFormat.Serialized:
        return <SerovalViewer stream={source} />;
      case startType === BodyFormat.Json:
      case contentType?.startsWith('application/json'):
        return <JsonViewer source={source.text()} />;
      case startType === BodyFormat.String:
        return <HexViewer bytes={source.bytes()} />;
      case startType === BodyFormat.File:
        return <BlobViewer source={getFile(source)} />;
      case startType === BodyFormat.FormData:
      case contentType?.startsWith('multipart/form-data'):
        return <FormDataViewer source={source.formData()} />;
      case startType === BodyFormat.URLSearchParams:
      case contentType?.startsWith('application/x-www-form-urlencoded'):
        return <URLSearchParamsViewer source={getURLSearchParams(source)} />;
      case startType === BodyFormat.Blob:
        return <BlobViewer source={source.blob()} />;
      case startType === BodyFormat.ArrayBuffer:
      case startType === BodyFormat.Uint8Array:
        return <HexViewer bytes={source.bytes()} />;
    }
    return undefined;
  });

  return (
    <>
      <Show when={body()}>
        <Section title="Body">{body()}</Section>
      </Show>
      <Section collapsible title="Headers">
        <HeadersViewer headers={props.source.source.headers} />
      </Section>
    </>
  );
}

interface RequestViewerProps {
  request: ServerFunctionRequest;
}

function convertRequestToEntries(request: Request) {
  return [
    ['Cache', request.cache],
    ['Credentials', request.credentials],
    ['Destination', request.destination],
    ['Integrity', request.integrity],
    ['Keep Alive', request.keepalive],
    ['Mode', request.mode],
    ['Redirect', request.redirect],
    ['Referrer', request.referrer],
    ['Referrer Policy', request.referrerPolicy],
    ['URL', request.url],
  ];
}

function RequestViewer(props: RequestViewerProps): JSX.Element {
  return (
    <TabPanel value="request">
      <ContentViewer source={props.request} />
      <Section collapsible defaultOpen={false} title="Information">
        <div data-solid-properties data-solid-kv-table>
          <For each={convertRequestToEntries(props.request.source)}>
            {([key, value]) => (
              <div data-solid-property data-solid-kv-row>
                <Text
                  data-solid-kv-key
                  options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}
                >
                  {key}
                </Text>
                <Text data-solid-kv-value options={{ size: 'xs', font: 'mono', wrap: 'wrap' }}>
                  {`${value}`}
                </Text>
              </div>
            )}
          </For>
        </div>
      </Section>
    </TabPanel>
  );
}

interface ResponseViewerProps {
  request: ServerFunctionRequest;
  response?: ServerFunctionResponse;
}

/**
 * Why a request has no response: the fetch itself rejected, and the runtime's
 * record carried the thrown value (`meta.error`). `undefined` while pending.
 */
function failureOf(request: ServerFunctionRequest): string | undefined {
  const error = request.meta?.error;
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}

function convertResponseToEntries(response: Response) {
  return [
    ['OK', response.ok],
    ['Redirected', response.redirected],
    ['Status', response.status],
    ['Status Text', response.statusText],
    ['Type', response.type],
    ['URL', response.url],
  ];
}

function ResponseViewer(props: ResponseViewerProps): JSX.Element {
  return (
    <TabPanel value="response">
      <Show
        when={props.response}
        fallback={
          <Placeholder>
            <Show
              when={failureOf(props.request)}
              fallback={<Text options={{ size: 'xs' }}>Waiting for response.</Text>}
            >
              {(failure) => <Text options={{ size: 'xs' }}>{`Request failed: ${failure()}`}</Text>}
            </Show>
          </Placeholder>
        }
      >
        {(instance) => (
          <>
            <ContentViewer source={instance()} />
            <Section collapsible defaultOpen={false} title="Information">
              <div data-solid-properties data-solid-kv-table>
                <For each={convertResponseToEntries(instance().source)}>
                  {([key, value]) => (
                    <div data-solid-property data-solid-kv-row>
                      <Text
                        data-solid-kv-key
                        options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}
                      >
                        {key}
                      </Text>
                      <Text
                        data-solid-kv-value
                        options={{ size: 'xs', font: 'mono', wrap: 'wrap' }}
                      >
                        {`${value}`}
                      </Text>
                    </div>
                  )}
                </For>
                <div data-solid-property data-solid-kv-row>
                  <Text
                    data-solid-kv-key
                    options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}
                  >
                    Timing
                  </Text>
                  <Text data-solid-kv-value options={{ size: 'xs', font: 'mono', wrap: 'wrap' }}>
                    {`${((instance().time - props.request.time) / 1000).toFixed(2)}s`}
                  </Text>
                </div>
              </div>
            </Section>
          </>
        )}
      </Show>
    </TabPanel>
  );
}

export interface ServerFunctionInstance {
  request: ServerFunctionRequest;
  response?: ServerFunctionResponse;
}

interface ServerFunctionInstanceDetailProps {
  value: ServerFunctionInstance;
}

function ServerFunctionInstanceDetail(props: ServerFunctionInstanceDetailProps) {
  return (
    <>
      <span data-solid-functions-instance-detail>
        <Badge type="info">{props.value.request.source.method}</Badge>
        <Text title={props.value.request.id} options={{ size: 'xs' }}>
          {props.value.request.meta?.name ?? props.value.request.id}
        </Text>
      </span>
      <Show
        when={props.value.response}
        keyed
        fallback={
          <Show when={failureOf(props.value.request) !== undefined}>
            <Badge type="failure">ERR</Badge>
          </Show>
        }
      >
        {(response) => {
          if (response.source.ok) {
            return <Badge type="success">{response.source.status}</Badge>;
          }
          return <Badge type="failure">{response.source.status}</Badge>;
        }}
      </Show>
    </>
  );
}

interface ServerFunctionInstanceViewerProps {
  instance: ServerFunctionInstance;
  onDelete: () => void;
}

async function copyCallReport(instance: ServerFunctionInstance): Promise<string> {
  const [requestBody, responseBody] = await Promise.all([
    readReportBody(instance.request.source),
    instance.response ? readReportBody(instance.response.source) : undefined,
  ]);
  return serverFunctionReport({ ...instance, requestBody, responseBody, route: pageRoute() });
}

function ServerFunctionInstanceViewer(props: ServerFunctionInstanceViewerProps): JSX.Element {
  const [tab, setTab] = createSignal<'request' | 'response'>('request');
  return (
    <div data-solid-function-instance-viewer>
      <div data-solid-function-instance-viewer-nav>
        <div data-solid-function-instance-viewer-nav-left>
          <div>
            <ServerFunctionInstanceDetail value={props.instance} />
          </div>
        </div>
        <div>
          <Show when={props.instance.response}>
            {(response) => (
              <span data-solid-function-instance-timing>
                <Text options={{ size: 'xs', weight: 'semibold', font: 'mono', wrap: 'nowrap' }}>
                  {`${((response().time - props.instance.request.time) / 1000).toFixed(2)}s`}
                </Text>
              </span>
            )}
          </Show>
          <CopyReportButton label="this call" report={() => copyCallReport(props.instance)} />
          <IconButton onClick={props.onDelete}>
            <TrashIcon title="Delete instance" />
          </IconButton>
        </div>
      </div>
      <div data-solid-function-instance-viewer-content>
        <TabGroup horizontal value={tab()} onChange={(value) => setTab(value ?? 'request')}>
          <TabList>
            <Tab value="request">Request</Tab>
            <Tab value="response">Response</Tab>
          </TabList>
          <RequestViewer request={props.instance.request} />
          <ResponseViewer request={props.instance.request} response={props.instance.response} />
        </TabGroup>
      </div>
    </div>
  );
}

function EmptyServerFunctions(): JSX.Element {
  return (
    <Placeholder>
      <Text options={{ size: 'xs' }}>No server function calls detected.</Text>
    </Placeholder>
  );
}

export interface ServerFunctionViewerProps {
  instances: Record<string, ServerFunctionInstance | undefined>;
  /**
   * A call another panel asked to show. Pass a new object for every request,
   * so asking for the same call twice still selects it.
   */
  focus?: { instance: string };
  onDeleteInstance: (value: string) => void;
  show?: boolean;
}

export function ServerFunctionViewer(props: ServerFunctionViewerProps): JSX.Element {
  const [currentInstance, setCurrentInstance] = createSignal<string>();

  createEffect(
    () => props.focus,
    (request) => {
      if (request) setCurrentInstance(request.instance);
    },
  );

  const keys = createMemo(() => Object.keys(props.instances));

  return (
    <Show when={props.show}>
      <div data-solid-dev-toolbar-panel>
        <div data-solid-functions-viewer>
          {/* list of calls */}
          <div data-solid-functions-sidebar>
            <div data-solid-functions-nav>
              <Text options={{ size: 'sm', font: 'sans' }}>Calls</Text>
              <Text data-solid-functions-count options={{ size: 'xs', font: 'mono' }}>
                {keys().length}
              </Text>
            </div>
            <div data-solid-functions-instances-container>
              <Show when={keys().length} fallback={<EmptyServerFunctions />}>
                <Select
                  data-solid-functions-instances
                  horizontal={false}
                  value={currentInstance()}
                  onChange={(current) => setCurrentInstance(current)}
                >
                  <For each={keys()}>
                    {(instance) => (
                      <SelectOption value={instance}>
                        <Show when={props.instances[instance]}>
                          {(current) => <ServerFunctionInstanceDetail value={current()} />}
                        </Show>
                      </SelectOption>
                    )}
                  </For>
                </Select>
              </Show>
            </div>
          </div>
          {/* request/response viewer */}
          <div data-solid-functions-detail>
            <Show
              when={currentInstance()}
              fallback={
                <Placeholder>
                  <Text options={{ size: 'xs' }}>Select a server function call.</Text>
                </Placeholder>
              }
            >
              {(value) => (
                <Show when={props.instances[value()]}>
                  {(instance) => (
                    <ServerFunctionInstanceViewer
                      instance={instance()}
                      onDelete={() => {
                        setCurrentInstance(undefined);
                        props.onDeleteInstance(value());
                      }}
                    />
                  )}
                </Show>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
