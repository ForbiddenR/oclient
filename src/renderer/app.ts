import type {
  BootNotificationCallError,
  BootNotificationCallResult,
  BootNotificationPayload,
  ConnectionState,
  HeaderEntry,
  SessionEvent,
  TransportProtocol
} from '../shared/types';

interface HeaderDraft {
  id: string;
  enabled: boolean;
  name: string;
  value: string;
}

const MAX_EVENTS = 200;

export function createApp(root: HTMLElement): void {
  const state = {
    headers: [createHeaderDraft()],
    caCertificatePath: '',
    connectionState: 'idle' as ConnectionState,
    events: [] as SessionEvent[],
    bootResult: undefined as SessionEvent & { type: 'boot-result' } | undefined
  };

  root.innerHTML = `
    <section class="shell" aria-label="OCPP Bench">
      <header class="hero-panel">
        <div>
          <p class="eyebrow">OCPP-J session bench</p>
          <h1>Boot a charge point against any central system.</h1>
          <p class="lede">Choose the transport, trust chain, and handshake headers, then inspect the first OCPP 1.6J BootNotification exchange.</p>
        </div>
        <div class="state-line" aria-label="Session workflow state">
          <div class="node is-active" data-step="transport"><span>Transport</span></div>
          <div class="wire"></div>
          <div class="node" data-step="socket"><span>Socket</span></div>
          <div class="wire"></div>
          <div class="node" data-step="boot"><span>BootNotification</span></div>
          <div class="wire"></div>
          <div class="node" data-step="result"><span>Result</span></div>
        </div>
      </header>

      <section class="workspace">
        <form id="controlForm" class="panel control-panel">
          <section class="panel-section">
            <div class="section-heading">
              <span class="section-kicker">01 / Transport</span>
              <h2>Central system endpoint</h2>
            </div>

            <div class="segmented" role="radiogroup" aria-label="Transport protocol">
              <label>
                <input type="radio" name="protocol" value="ws" checked />
                <span>ws</span>
              </label>
              <label>
                <input type="radio" name="protocol" value="wss" />
                <span>wss</span>
              </label>
            </div>

            <label class="field">
              <span>Endpoint</span>
              <input id="addressInput" name="address" type="text" value="127.0.0.1:9000/CP001" autocomplete="off" spellcheck="false" />
              <small>Use a full URL or omit the scheme and let the selected transport apply it.</small>
            </label>

            <label class="field compact">
              <span>Subprotocol</span>
              <input id="subprotocolInput" name="subprotocol" type="text" value="ocpp1.6" autocomplete="off" spellcheck="false" />
            </label>

            <div id="caSection" class="certificate-card" hidden>
              <div>
                <span class="field-label">CA certificate</span>
                <p id="caPath" class="path-readout">No certificate selected</p>
              </div>
              <div class="button-row tight">
                <button id="pickCaButton" class="secondary" type="button">Choose CA</button>
                <button id="clearCaButton" class="ghost" type="button">Clear</button>
              </div>
            </div>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <span class="section-kicker">02 / Headers</span>
              <h2>Upgrade headers</h2>
            </div>
            <div class="header-table" role="group" aria-label="Custom headers">
              <div class="header-row header-head" aria-hidden="true">
                <span>On</span>
                <span>Name</span>
                <span>Value</span>
                <span></span>
              </div>
              <div id="headerRows"></div>
            </div>
            <button id="addHeaderButton" class="inline-action" type="button">+ Add header</button>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <span class="section-kicker">03 / BootNotification</span>
              <h2>Charge point identity</h2>
            </div>

            <div class="field-grid">
              <label class="field">
                <span>Vendor</span>
                <input id="vendorInput" name="chargePointVendor" type="text" value="Workbench EV" required />
              </label>
              <label class="field">
                <span>Model</span>
                <input id="modelInput" name="chargePointModel" type="text" value="Bench-16J" required />
              </label>
            </div>

            <details class="advanced-fields">
              <summary>Optional OCPP fields</summary>
              <div class="field-grid">
                <label class="field"><span>Charge point serial</span><input id="chargePointSerialInput" type="text" /></label>
                <label class="field"><span>Charge box serial</span><input id="chargeBoxSerialInput" type="text" /></label>
                <label class="field"><span>Firmware version</span><input id="firmwareInput" type="text" /></label>
                <label class="field"><span>ICCID</span><input id="iccidInput" type="text" /></label>
                <label class="field"><span>IMSI</span><input id="imsiInput" type="text" /></label>
                <label class="field"><span>Meter serial</span><input id="meterSerialInput" type="text" /></label>
                <label class="field"><span>Meter type</span><input id="meterTypeInput" type="text" /></label>
              </div>
            </details>
          </section>

          <div class="dock-actions">
            <button id="connectButton" class="primary" type="submit">Connect</button>
            <button id="disconnectButton" class="secondary" type="button" disabled>Disconnect</button>
            <button id="bootButton" class="accent" type="button" disabled>Send BootNotification</button>
          </div>
        </form>

        <aside class="panel console-panel" aria-label="Session console">
          <div class="console-header">
            <div>
              <p class="eyebrow">Live circuit trace</p>
              <h2>Session console</h2>
            </div>
            <div id="statusBadge" class="status-badge is-idle">Idle</div>
          </div>

          <section id="resultCard" class="result-card empty">
            <span class="section-kicker">BootNotification result</span>
            <h3>No response yet</h3>
            <p>Connect to a central system and send BootNotification to see the parsed status, time, and interval here.</p>
          </section>

          <section class="log-card">
            <div class="log-toolbar">
              <span>Raw frames and events</span>
              <button id="clearLogButton" class="ghost" type="button">Clear</button>
            </div>
            <ol id="eventLog" class="event-log" aria-live="polite"></ol>
          </section>
        </aside>
      </section>
    </section>
  `;

  const form = mustQuery<HTMLFormElement>(root, '#controlForm');
  const caSection = mustQuery<HTMLElement>(root, '#caSection');
  const caPath = mustQuery<HTMLElement>(root, '#caPath');
  const pickCaButton = mustQuery<HTMLButtonElement>(root, '#pickCaButton');
  const clearCaButton = mustQuery<HTMLButtonElement>(root, '#clearCaButton');
  const addHeaderButton = mustQuery<HTMLButtonElement>(root, '#addHeaderButton');
  const headerRows = mustQuery<HTMLElement>(root, '#headerRows');
  const connectButton = mustQuery<HTMLButtonElement>(root, '#connectButton');
  const disconnectButton = mustQuery<HTMLButtonElement>(root, '#disconnectButton');
  const bootButton = mustQuery<HTMLButtonElement>(root, '#bootButton');
  const clearLogButton = mustQuery<HTMLButtonElement>(root, '#clearLogButton');
  const statusBadge = mustQuery<HTMLElement>(root, '#statusBadge');
  const eventLog = mustQuery<HTMLOListElement>(root, '#eventLog');
  const resultCard = mustQuery<HTMLElement>(root, '#resultCard');

  renderHeaders(headerRows, state.headers);
  renderTransport(root, caSection, caPath, state.caCertificatePath);
  renderStatus(root, statusBadge, connectButton, disconnectButton, bootButton, state.connectionState);
  renderLog(eventLog, state.events);

  root.addEventListener('change', (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.name === 'protocol') {
      renderTransport(root, caSection, caPath, state.caCertificatePath);
    }

    if (target instanceof HTMLInputElement && target.dataset.headerField) {
      syncHeaderDraftFromInput(target, state.headers);
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.dataset.headerField) {
      syncHeaderDraftFromInput(target, state.headers);
    }
  });

  headerRows.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-header]');
    if (!button) {
      return;
    }

    const id = button.dataset.removeHeader;
    if (!id) {
      return;
    }

    state.headers = state.headers.filter((header) => header.id !== id);
    if (state.headers.length === 0) {
      state.headers.push(createHeaderDraft());
    }

    renderHeaders(headerRows, state.headers);
  });

  addHeaderButton.addEventListener('click', () => {
    state.headers.push(createHeaderDraft());
    renderHeaders(headerRows, state.headers);
    headerRows.querySelector<HTMLInputElement>('.header-row:last-child input[data-header-field="name"]')?.focus();
  });

  pickCaButton.addEventListener('click', async () => {
    const result = await window.oclient.pickCaCertificate();
    if (!result.canceled && result.filePath) {
      state.caCertificatePath = result.filePath;
      renderTransport(root, caSection, caPath, state.caCertificatePath);
    }
  });

  clearCaButton.addEventListener('click', () => {
    state.caCertificatePath = '';
    renderTransport(root, caSection, caPath, state.caCertificatePath);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    connectButton.disabled = true;

    try {
      resetResult(resultCard, state);
      const result = await window.oclient.connect({
        protocol: getSelectedProtocol(root),
        address: inputValue(root, '#addressInput'),
        subprotocol: inputValue(root, '#subprotocolInput'),
        caCertificatePath: state.caCertificatePath || undefined,
        headers: collectHeaders(state.headers)
      });

      if (!result.ok) {
        pushLocalLog(state, `Connection failed: ${result.error ?? 'Unknown error.'}`, 'error');
        renderLog(eventLog, state.events);
      }
    } catch (error) {
      pushLocalLog(state, getErrorMessage(error), 'error');
      renderLog(eventLog, state.events);
    } finally {
      renderStatus(root, statusBadge, connectButton, disconnectButton, bootButton, state.connectionState);
    }
  });

  disconnectButton.addEventListener('click', async () => {
    disconnectButton.disabled = true;
    resetResult(resultCard, state);
    try {
      await window.oclient.disconnect();
    } catch (error) {
      pushLocalLog(state, getErrorMessage(error), 'error');
      renderLog(eventLog, state.events);
    }
  });

  bootButton.addEventListener('click', async () => {
    bootButton.disabled = true;
    setNode(root, 'boot', 'is-active');

    try {
      const response = await window.oclient.sendBootNotification(collectBootPayload(root));
      state.bootResult = { type: 'boot-result', at: new Date().toISOString(), result: response };
      renderResult(resultCard, state.bootResult);
      setNode(root, 'boot', 'is-complete');
      setNode(root, 'result', 'is-active');
    } catch (error) {
      pushLocalLog(state, getErrorMessage(error), 'error');
      renderLog(eventLog, state.events);
    } finally {
      renderStatus(root, statusBadge, connectButton, disconnectButton, bootButton, state.connectionState);
      if (state.bootResult) {
        setNode(root, 'boot', 'is-complete');
        setNode(root, 'result', 'is-active');
      }
    }
  });

  clearLogButton.addEventListener('click', () => {
    state.events = [];
    renderLog(eventLog, state.events);
  });

  window.oclient.onSessionEvent((event) => {
    state.events = [...state.events, event].slice(-MAX_EVENTS);

    if (event.type === 'status') {
      state.connectionState = event.status;
      renderStatus(root, statusBadge, connectButton, disconnectButton, bootButton, state.connectionState);
    }

    if (event.type === 'boot-result') {
      state.bootResult = event;
      renderResult(resultCard, event);
      renderStatus(root, statusBadge, connectButton, disconnectButton, bootButton, state.connectionState);
      setNode(root, 'boot', 'is-complete');
      setNode(root, 'result', 'is-active');
    }

    renderLog(eventLog, state.events);
  });
}

function createHeaderDraft(): HeaderDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `header-${Date.now()}`,
    enabled: true,
    name: '',
    value: ''
  };
}

function renderHeaders(container: HTMLElement, headers: HeaderDraft[]): void {
  container.replaceChildren(
    ...headers.map((header) => {
      const row = document.createElement('div');
      row.className = 'header-row';
      row.dataset.headerId = header.id;

      row.append(
        createCheckbox(header),
        createHeaderInput(header, 'name', 'X-Station-Token'),
        createHeaderInput(header, 'value', 'secret'),
        createRemoveButton(header.id)
      );

      return row;
    })
  );
}

function createCheckbox(header: HeaderDraft): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'switch-cell';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = header.enabled;
  input.dataset.headerId = header.id;
  input.dataset.headerField = 'enabled';
  input.setAttribute('aria-label', 'Enable header');

  label.append(input, document.createElement('span'));
  return label;
}

function createHeaderInput(header: HeaderDraft, field: 'name' | 'value', placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = header[field];
  input.placeholder = placeholder;
  input.dataset.headerId = header.id;
  input.dataset.headerField = field;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', field === 'name' ? 'Header name' : 'Header value');
  return input;
}

function createRemoveButton(id: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row-delete';
  button.dataset.removeHeader = id;
  button.textContent = 'Remove';
  return button;
}

function syncHeaderDraftFromInput(input: HTMLInputElement, headers: HeaderDraft[]): void {
  const id = input.dataset.headerId;
  const field = input.dataset.headerField as keyof HeaderDraft | undefined;
  const header = headers.find((item) => item.id === id);

  if (!field || !header) {
    return;
  }

  if (field === 'enabled') {
    header.enabled = input.checked;
    return;
  }

  if (field === 'name' || field === 'value') {
    header[field] = input.value;
  }
}

function renderTransport(root: HTMLElement, caSection: HTMLElement, caPath: HTMLElement, selectedPath: string): void {
  const isSecure = getSelectedProtocol(root) === 'wss';
  caSection.hidden = !isSecure;
  caPath.textContent = selectedPath || 'No certificate selected';
}

function renderStatus(
  root: HTMLElement,
  statusBadge: HTMLElement,
  connectButton: HTMLButtonElement,
  disconnectButton: HTMLButtonElement,
  bootButton: HTMLButtonElement,
  status: ConnectionState
): void {
  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';
  const isDisconnecting = status === 'disconnecting';

  connectButton.disabled = isConnecting || isConnected || isDisconnecting;
  disconnectButton.disabled = !isConnected || isDisconnecting;
  bootButton.disabled = !isConnected;

  statusBadge.className = `status-badge is-${status}`;
  statusBadge.textContent = labelForStatus(status);

  for (const node of root.querySelectorAll<HTMLElement>('.state-line .node')) {
    node.classList.remove('is-active', 'is-complete', 'is-error');
  }

  setNode(root, 'transport', 'is-active');

  if (isConnected || isDisconnecting) {
    setNode(root, 'transport', 'is-complete');
    setNode(root, 'socket', 'is-active');
  }

  if (status === 'error') {
    setNode(root, 'socket', 'is-error');
  }
}

function renderLog(container: HTMLOListElement, events: SessionEvent[]): void {
  container.replaceChildren(
    ...events
      .slice()
      .reverse()
      .map((event) => {
        const item = document.createElement('li');
        item.className = `event event-${event.type}`;

        const meta = document.createElement('div');
        meta.className = 'event-meta';
        meta.textContent = `${formatTime(event.at)} · ${eventLabel(event)}`;

        const body = document.createElement('pre');
        body.textContent = eventBody(event);

        item.append(meta, body);
        return item;
      })
  );
}

function resetResult(
  container: HTMLElement,
  state: { bootResult: (SessionEvent & { type: 'boot-result' }) | undefined }
): void {
  state.bootResult = undefined;
  container.className = 'result-card empty';
  container.innerHTML = `
    <span class="section-kicker">BootNotification result</span>
    <h3>No response yet</h3>
    <p>Connect to a central system and send BootNotification to see the parsed status, time, and interval here.</p>
  `;
}

function renderResult(container: HTMLElement, event: SessionEvent & { type: 'boot-result' }): void {
  container.className = 'result-card';
  container.replaceChildren();

  const kicker = document.createElement('span');
  kicker.className = 'section-kicker';
  kicker.textContent = 'BootNotification result';

  const title = document.createElement('h3');

  const details = document.createElement('dl');
  details.className = 'result-grid';

  if (event.result.type === 'callResult') {
    const result = event.result as BootNotificationCallResult;
    container.classList.add(`status-${(result.status ?? 'unknown').toLowerCase()}`);
    title.textContent = result.status ?? 'CALLRESULT received';
    appendDefinition(details, 'Current time', result.currentTime ?? 'Not supplied');
    appendDefinition(details, 'Interval', result.interval === undefined ? 'Not supplied' : `${result.interval} seconds`);
    appendDefinition(details, 'Request ID', result.uniqueId);
  } else {
    const result = event.result as BootNotificationCallError;
    container.classList.add('status-rejected');
    title.textContent = result.errorCode;
    appendDefinition(details, 'Description', result.errorDescription || 'No description');
    appendDefinition(details, 'Details', formatResultDetails(result.errorDetails));
    appendDefinition(details, 'Request ID', result.uniqueId);
  }

  container.append(kicker, title, details);
}

function appendDefinition(list: HTMLDListElement, term: string, value: string): void {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = term;
  dd.textContent = value;
  list.append(dt, dd);
}

function formatResultDetails(value: unknown): string {
  if (value === undefined || value === null) {
    return 'No details';
  }

  if (typeof value === 'string') {
    return value || 'No details';
  }

  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) {
      return 'No details';
    }

    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function setNode(root: HTMLElement, step: string, className: string): void {
  root.querySelector<HTMLElement>(`.state-line .node[data-step="${step}"]`)?.classList.add(className);
}

function collectHeaders(headers: HeaderDraft[]): HeaderEntry[] {
  return headers.map((header) => ({ ...header }));
}

function collectBootPayload(root: HTMLElement): BootNotificationPayload {
  return {
    chargePointVendor: inputValue(root, '#vendorInput'),
    chargePointModel: inputValue(root, '#modelInput'),
    chargePointSerialNumber: inputValue(root, '#chargePointSerialInput'),
    chargeBoxSerialNumber: inputValue(root, '#chargeBoxSerialInput'),
    firmwareVersion: inputValue(root, '#firmwareInput'),
    iccid: inputValue(root, '#iccidInput'),
    imsi: inputValue(root, '#imsiInput'),
    meterSerialNumber: inputValue(root, '#meterSerialInput'),
    meterType: inputValue(root, '#meterTypeInput')
  };
}

function getSelectedProtocol(root: HTMLElement): TransportProtocol {
  const selected = root.querySelector<HTMLInputElement>('input[name="protocol"]:checked');
  return selected?.value === 'wss' ? 'wss' : 'ws';
}

function inputValue(root: HTMLElement, selector: string): string {
  return mustQuery<HTMLInputElement>(root, selector).value.trim();
}

function mustQuery<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Expected element ${selector}.`);
  }

  return element;
}

function pushLocalLog(
  state: { events: SessionEvent[] },
  message: string,
  level: Extract<SessionEvent, { type: 'log' }>['level']
): void {
  const event: SessionEvent = {
    type: 'log',
    at: new Date().toISOString(),
    level,
    message
  };

  state.events = [...state.events, event].slice(-MAX_EVENTS);
}

function eventLabel(event: SessionEvent): string {
  if (event.type === 'frame') {
    return event.direction === 'out' ? 'outbound frame' : 'inbound frame';
  }

  if (event.type === 'status') {
    return `status / ${event.status}`;
  }

  if (event.type === 'boot-result') {
    return 'parsed result';
  }

  return event.level;
}

function eventBody(event: SessionEvent): string {
  if (event.type === 'frame') {
    return prettyJson(event.raw);
  }

  if (event.type === 'status' || event.type === 'log') {
    return event.message;
  }

  return JSON.stringify(event.result, null, 2);
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function labelForStatus(status: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    idle: 'Idle',
    connecting: 'Connecting',
    connected: 'Connected',
    disconnecting: 'Closing',
    disconnected: 'Disconnected',
    error: 'Error'
  };

  return labels[status];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
