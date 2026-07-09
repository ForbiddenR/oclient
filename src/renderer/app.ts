import type {
  BootNotificationCallError,
  BootNotificationCallResult,
  BootNotificationPayload,
  ConnectResult,
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

type BootResultEvent = Extract<SessionEvent, { type: 'boot-result' }>;
type LogLevel = Extract<SessionEvent, { type: 'log' }>['level'];

interface AppState {
  headers: HeaderDraft[];
  caCertificatePath: string;
  allowInsecureTls: boolean;
  connectionState: ConnectionState;
  events: SessionEvent[];
  bootResult?: BootResultEvent;
  connectResult?: ConnectResult;
  connectedAt?: string;
  disconnectedAt?: string;
}

interface DashboardElements {
  form: HTMLFormElement;
  caSection: HTMLElement;
  caPath: HTMLElement;
  pickCaButton: HTMLButtonElement;
  clearCaButton: HTMLButtonElement;
  insecureTlsInput: HTMLInputElement;
  addHeaderButton: HTMLButtonElement;
  headerRows: HTMLElement;
  connectButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
  bootButton: HTMLButtonElement;
  clearLogButton: HTMLButtonElement;
  statusBadge: HTMLElement;
  railStatus: HTMLElement;
  railDuration: HTMLElement;
  railVersion: HTMLElement;
  overviewGrid: HTMLElement;
  metricGrid: HTMLElement;
  eventLog: HTMLElement;
  noticesList: HTMLElement;
  resultCard: HTMLElement;
}

const MAX_EVENTS = 200;
const EMPTY_VALUE = '—';

export function createApp(root: HTMLElement): void {
  const state: AppState = {
    headers: [createHeaderDraft()],
    caCertificatePath: '',
    allowInsecureTls: false,
    connectionState: 'idle',
    events: [],
    bootResult: undefined,
    connectResult: undefined,
    connectedAt: undefined,
    disconnectedAt: undefined
  };
  let durationTimer: number | undefined;

  root.innerHTML = buildAppMarkup();

  const elements: DashboardElements = {
    form: mustQuery<HTMLFormElement>(root, '#controlForm'),
    caSection: mustQuery<HTMLElement>(root, '#caSection'),
    caPath: mustQuery<HTMLElement>(root, '#caPath'),
    pickCaButton: mustQuery<HTMLButtonElement>(root, '#pickCaButton'),
    clearCaButton: mustQuery<HTMLButtonElement>(root, '#clearCaButton'),
    insecureTlsInput: mustQuery<HTMLInputElement>(root, '#insecureTlsInput'),
    addHeaderButton: mustQuery<HTMLButtonElement>(root, '#addHeaderButton'),
    headerRows: mustQuery<HTMLElement>(root, '#headerRows'),
    connectButton: mustQuery<HTMLButtonElement>(root, '#connectButton'),
    disconnectButton: mustQuery<HTMLButtonElement>(root, '#disconnectButton'),
    bootButton: mustQuery<HTMLButtonElement>(root, '#bootButton'),
    clearLogButton: mustQuery<HTMLButtonElement>(root, '#clearLogButton'),
    statusBadge: mustQuery<HTMLElement>(root, '#statusBadge'),
    railStatus: mustQuery<HTMLElement>(root, '#railStatus'),
    railDuration: mustQuery<HTMLElement>(root, '#railDuration'),
    railVersion: mustQuery<HTMLElement>(root, '#railVersion'),
    overviewGrid: mustQuery<HTMLElement>(root, '#overviewGrid'),
    metricGrid: mustQuery<HTMLElement>(root, '#metricGrid'),
    eventLog: mustQuery<HTMLElement>(root, '#eventLog'),
    noticesList: mustQuery<HTMLElement>(root, '#noticesList'),
    resultCard: mustQuery<HTMLElement>(root, '#resultCard')
  };

  const renderDashboard = () => {
    renderTransport(root, elements.caSection, elements.caPath, state.caCertificatePath, state.allowInsecureTls);
    renderStatus(elements, state.connectionState);
    renderConnectionOverview(elements.overviewGrid, root, state);
    renderSessionMetrics(elements.metricGrid, state);
    renderLog(elements.eventLog, state.events);
    renderNotices(elements.noticesList, state.events, state.bootResult);
    if (state.bootResult) {
      renderResult(elements.resultCard, state.bootResult);
    } else {
      resetResult(elements.resultCard, state);
    }
  };

  const startDurationTimer = () => {
    if (durationTimer !== undefined) {
      return;
    }

    durationTimer = window.setInterval(() => {
      renderStatus(elements, state.connectionState);
      renderConnectionOverview(elements.overviewGrid, root, state);
      renderSessionMetrics(elements.metricGrid, state);
    }, 1_000);
  };

  const stopDurationTimer = () => {
    if (durationTimer === undefined) {
      return;
    }

    window.clearInterval(durationTimer);
    durationTimer = undefined;
  };

  renderHeaders(elements.headerRows, state.headers);
  renderDashboard();

  root.addEventListener('change', (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.name === 'protocol') {
      state.allowInsecureTls = false;
      renderDashboard();
    }

    if (target instanceof HTMLInputElement && target.id === 'insecureTlsInput') {
      state.allowInsecureTls = target.checked;
      renderDashboard();
    }

    if (target instanceof HTMLInputElement && target.dataset.headerField) {
      syncHeaderDraftFromInput(target, state.headers);
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.dataset.headerField) {
      syncHeaderDraftFromInput(target, state.headers);
      return;
    }

    if (target instanceof HTMLInputElement && ['addressInput', 'subprotocolInput'].includes(target.id)) {
      renderConnectionOverview(elements.overviewGrid, root, state);
      renderStatus(elements, state.connectionState);
    }
  });

  elements.headerRows.addEventListener('click', (event) => {
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

    renderHeaders(elements.headerRows, state.headers);
  });

  elements.addHeaderButton.addEventListener('click', () => {
    state.headers.push(createHeaderDraft());
    renderHeaders(elements.headerRows, state.headers);
    elements.headerRows.querySelector<HTMLInputElement>('.header-row:last-child input[data-header-field="name"]')?.focus();
  });

  elements.pickCaButton.addEventListener('click', async () => {
    const result = await window.oclient.pickCaCertificate();
    if (!result.canceled && result.filePath) {
      state.caCertificatePath = result.filePath;
      renderDashboard();
    }
  });

  elements.clearCaButton.addEventListener('click', () => {
    state.caCertificatePath = '';
    renderDashboard();
  });

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.connectButton.disabled = true;
    state.connectResult = undefined;
    state.connectedAt = undefined;
    state.disconnectedAt = undefined;
    resetResult(elements.resultCard, state);
    stopDurationTimer();

    try {
      const result = await window.oclient.connect({
        protocol: getSelectedProtocol(root),
        address: inputValue(root, '#addressInput'),
        subprotocol: inputValue(root, '#subprotocolInput'),
        caCertificatePath: state.caCertificatePath || undefined,
        headers: collectHeaders(state.headers),
        allowInsecureTls: state.allowInsecureTls
      });

      if (result.ok) {
        state.connectResult = result;
      } else {
        pushLocalLog(state, `Connection failed: ${result.error ?? 'Unknown error.'}`, 'error');
      }
    } catch (error) {
      pushLocalLog(state, getErrorMessage(error), 'error');
    } finally {
      renderDashboard();
    }
  });

  elements.disconnectButton.addEventListener('click', async () => {
    elements.disconnectButton.disabled = true;
    resetResult(elements.resultCard, state);
    try {
      await window.oclient.disconnect();
    } catch (error) {
      pushLocalLog(state, getErrorMessage(error), 'error');
      renderDashboard();
    }
  });

  elements.bootButton.addEventListener('click', async () => {
    elements.bootButton.disabled = true;

    try {
      const response = await window.oclient.sendBootNotification(collectBootPayload(root));
      state.bootResult = { type: 'boot-result', at: new Date().toISOString(), result: response };
      renderDashboard();
    } catch (error) {
      pushLocalLog(state, getErrorMessage(error), 'error');
      renderDashboard();
    } finally {
      renderStatus(elements, state.connectionState);
    }
  });

  elements.clearLogButton.addEventListener('click', () => {
    state.events = [];
    renderDashboard();
  });

  window.oclient.onSessionEvent((event) => {
    state.events = [...state.events, event].slice(-MAX_EVENTS);

    if (event.type === 'status') {
      state.connectionState = event.status;

      if (event.status === 'connected') {
        state.connectedAt = state.connectedAt ?? event.at;
        state.disconnectedAt = undefined;
        startDurationTimer();
      }

      if (event.status === 'disconnected' || event.status === 'error') {
        state.disconnectedAt = event.at;
        stopDurationTimer();
      }
    }

    if (event.type === 'boot-result') {
      state.bootResult = event;
    }

    renderDashboard();
  });
}

function buildAppMarkup(): string {
  return `
    <section class="app-shell" aria-label="OCPP Client dashboard">
      <aside class="rail" aria-label="Application navigation">
        <div class="rail-brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>
          </span>
          <div>
            <h1>OCPP Client</h1>
            <p>OCPP 1.6J test bench</p>
          </div>
        </div>

        <nav class="rail-nav" aria-label="Dashboard sections">
          <a class="active" href="#dashboard">Dashboard</a>
          <a href="#messages">Message log</a>
          <a href="#boot">BootNotification</a>
          <a href="#settings">Connection settings</a>
        </nav>

        <div class="rail-summary" aria-label="Current session summary">
          <div class="rail-status-line"><span class="status-dot" aria-hidden="true"></span><span id="railStatus">Idle</span></div>
          <dl>
            <div><dt>Duration</dt><dd id="railDuration">—</dd></div>
            <div><dt>OCPP version</dt><dd id="railVersion">1.6J</dd></div>
          </dl>
        </div>
      </aside>

      <main class="dashboard">
        <header class="dashboard-topbar">
          <div>
            <p class="eyebrow">OCPP 1.6J over WebSocket</p>
            <h2>Dashboard</h2>
          </div>
          <div class="session-actions" aria-label="Session actions">
            <button id="connectButton" class="primary" type="submit" form="controlForm">Connect</button>
            <button id="disconnectButton" class="secondary" type="button" disabled>Disconnect</button>
            <button id="bootButton" class="accent" type="button" disabled>Send BootNotification</button>
          </div>
        </header>

        <section id="dashboard" class="card connection-card" aria-label="Connection status">
          <header class="card-head">
            <div>
              <p class="eyebrow">Connection status</p>
              <h3>Central system session</h3>
            </div>
            <div id="statusBadge" class="status-badge is-idle">Idle</div>
          </header>
          <div id="overviewGrid" class="overview-grid"></div>
        </section>

        <section id="metricGrid" class="metrics-grid" aria-label="Session metrics"></section>

        <div class="content-grid">
          <section id="messages" class="card log-card">
            <header class="card-head">
              <div>
                <p class="eyebrow">Messages</p>
                <h3>Session log</h3>
              </div>
              <button id="clearLogButton" class="ghost" type="button">Clear</button>
            </header>
            <div class="log-table" role="table" aria-label="OCPP session messages">
              <div class="log-row log-head" role="row">
                <span role="columnheader">Time</span>
                <span role="columnheader">Direction</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Request ID</span>
                <span role="columnheader">Summary</span>
              </div>
              <div id="eventLog" class="log-rows" aria-live="polite"></div>
            </div>
          </section>

          <form id="controlForm" class="side-stack">
            <section id="boot" class="card boot-card">
              <header class="card-head">
                <div>
                  <p class="eyebrow">Composer</p>
                  <h3>BootNotification</h3>
                </div>
              </header>
              <div class="card-body">
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
              </div>
            </section>

            <section id="resultCard" class="card result-card empty">
              <header class="card-head">
                <div>
                  <p class="eyebrow">Parsed response</p>
                  <h3>BootNotification result</h3>
                </div>
              </header>
              <div class="card-body">
                <p class="empty-note">Connect to a central system and send BootNotification to see the parsed response.</p>
              </div>
            </section>

            <section class="card notices-card">
              <header class="card-head">
                <div>
                  <p class="eyebrow">Activity</p>
                  <h3>Recent notices</h3>
                </div>
              </header>
              <div id="noticesList" class="notice-list"></div>
            </section>

            <section id="settings" class="card settings-card">
              <header class="card-head">
                <div>
                  <p class="eyebrow">Setup</p>
                  <h3>Connection settings</h3>
                </div>
              </header>
              <div class="card-body">
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
                  <label class="insecure-toggle">
                    <input id="insecureTlsInput" type="checkbox" />
                    <span>Allow insecure TLS</span>
                    <small>Skip server certificate validation. Use only for testing self-signed CSMS certificates.</small>
                  </label>
                </div>
              </div>
            </section>

            <section class="card headers-card">
              <header class="card-head">
                <div>
                  <p class="eyebrow">Handshake</p>
                  <h3>Custom headers</h3>
                </div>
                <button id="addHeaderButton" class="inline-action" type="button">+ Add header</button>
              </header>
              <div class="card-body">
                <div class="header-table" role="group" aria-label="Custom headers">
                  <div class="header-row header-head" aria-hidden="true">
                    <span>On</span>
                    <span>Name</span>
                    <span>Value</span>
                    <span></span>
                  </div>
                  <div id="headerRows"></div>
                </div>
              </div>
            </section>
          </form>
        </div>
      </main>
    </section>
  `;
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

function renderTransport(
  root: HTMLElement,
  caSection: HTMLElement,
  caPath: HTMLElement,
  selectedPath: string,
  allowInsecureTls: boolean
): void {
  const isSecure = getSelectedProtocol(root) === 'wss';
  caSection.hidden = !isSecure;
  caPath.textContent = selectedPath || 'No certificate selected';

  const insecureTlsInput = root.querySelector<HTMLInputElement>('#insecureTlsInput');
  if (insecureTlsInput) {
    insecureTlsInput.checked = allowInsecureTls;
  }
}

function renderStatus(elements: DashboardElements, status: ConnectionState): void {
  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';
  const isDisconnecting = status === 'disconnecting';

  elements.connectButton.disabled = isConnecting || isConnected || isDisconnecting;
  elements.disconnectButton.disabled = !isConnected || isDisconnecting;
  elements.bootButton.disabled = !isConnected;

  elements.statusBadge.className = `status-badge is-${status}`;
  elements.statusBadge.textContent = labelForStatus(status);
  elements.railStatus.textContent = labelForStatus(status);
  elements.railStatus.parentElement?.querySelector('.status-dot')?.setAttribute('data-status', status);
}

function renderConnectionOverview(container: HTMLElement, root: HTMLElement, state: AppState): void {
  const summary = deriveConnectionSummary(root, state);
  container.replaceChildren(
    createDefinitionTile('WebSocket URL', summary.url),
    createDefinitionTile('Charge point ID', summary.chargePointId),
    createDefinitionTile('OCPP version', summary.ocppVersion),
    createDefinitionTile('Connected at', summary.connectedAt),
    createDefinitionTile('Duration', summary.duration),
    createDefinitionTile('Heartbeat interval', summary.interval)
  );
}

function createDefinitionTile(label: string, value: string): HTMLDivElement {
  const tile = document.createElement('div');
  tile.className = 'overview-tile';

  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;

  tile.append(dt, dd);
  return tile;
}

function renderSessionMetrics(container: HTMLElement, state: AppState): void {
  const metrics = deriveSessionMetrics(state);
  container.replaceChildren(
    createMetricCard('Total frames', String(metrics.totalFrames), 'OCPP-J frames', 'neutral'),
    createMetricCard('Outbound', String(metrics.outboundFrames), `${metrics.outboundPercent}% of frames`, 'outbound'),
    createMetricCard('Inbound', String(metrics.inboundFrames), `${metrics.inboundPercent}% of frames`, 'inbound'),
    createMetricCard('Boot status', metrics.bootStatus, metrics.bootDetail, 'boot'),
    createMetricCard('Errors', String(metrics.errors), metrics.errors === 1 ? 'Needs attention' : 'Log events', metrics.errors > 0 ? 'error' : 'neutral')
  );
}

function createMetricCard(title: string, value: string, note: string, variant: string): HTMLDivElement {
  const card = document.createElement('div');
  card.className = `metric-card metric-${variant}`;

  const icon = document.createElement('span');
  icon.className = 'metric-icon';
  icon.textContent = metricIconForVariant(variant);
  icon.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'metric-label';
  label.textContent = title;
  const metricValue = document.createElement('strong');
  metricValue.textContent = value;
  const metricNote = document.createElement('small');
  metricNote.textContent = note;
  body.append(label, metricValue, metricNote);

  card.append(icon, body);
  return card;
}

function renderLog(container: HTMLElement, events: SessionEvent[]): void {
  if (events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = 'No session messages yet.';
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(
    ...deriveEventRows(events).map((row) => {
      const item = document.createElement('div');
      item.className = `log-row event-${row.kind}`;
      item.setAttribute('role', 'row');

      const time = document.createElement('span');
      time.textContent = row.time;

      const direction = document.createElement('span');
      direction.className = `direction-badge direction-${row.directionTone}`;
      direction.textContent = row.direction;

      const type = document.createElement('span');
      type.textContent = row.type;

      const request = document.createElement('code');
      request.textContent = row.requestId;

      const summary = document.createElement('span');
      summary.className = 'log-summary';
      summary.textContent = row.summary;
      summary.title = row.full;

      item.append(time, direction, type, request, summary);
      return item;
    })
  );
}

function resetResult(container: HTMLElement, state: { bootResult?: BootResultEvent }): void {
  state.bootResult = undefined;
  container.className = 'card result-card empty';
  container.innerHTML = `
    <header class="card-head">
      <div>
        <p class="eyebrow">Parsed response</p>
        <h3>BootNotification result</h3>
      </div>
    </header>
    <div class="card-body">
      <p class="empty-note">Connect to a central system and send BootNotification to see the parsed response.</p>
    </div>
  `;
}

function renderResult(container: HTMLElement, event: BootResultEvent): void {
  container.replaceChildren();

  const head = document.createElement('header');
  head.className = 'card-head';
  const headWrap = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Parsed response';
  const headTitle = document.createElement('h3');
  headTitle.textContent = 'BootNotification result';
  headWrap.append(eyebrow, headTitle);
  head.append(headWrap);

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('p');
  title.className = 'result-title';
  const icon = document.createElement('span');
  icon.className = 'result-icon';
  title.append(icon);

  const details = document.createElement('dl');
  details.className = 'result-grid';

  let statusClass = 'unknown';
  if (event.result.type === 'callResult') {
    const result = event.result as BootNotificationCallResult;
    statusClass = (result.status ?? 'unknown').toLowerCase();
    title.append(document.createTextNode(result.status ?? 'CALLRESULT received'));
    appendDefinition(details, 'Current time', result.currentTime ? formatTimestamp(result.currentTime) : EMPTY_VALUE);
    appendDefinition(details, 'Interval', result.interval === undefined ? EMPTY_VALUE : formatInterval(result.interval));
    appendDefinition(details, 'Request ID', result.uniqueId);
    appendDefinition(details, 'Raw payload', formatResultDetails(result.rawPayload));
  } else {
    const result = event.result as BootNotificationCallError;
    statusClass = 'rejected';
    title.append(document.createTextNode(result.errorCode));
    appendDefinition(details, 'Description', result.errorDescription || EMPTY_VALUE);
    appendDefinition(details, 'Details', formatResultDetails(result.errorDetails));
    appendDefinition(details, 'Request ID', result.uniqueId);
  }

  body.append(title, details);
  container.className = `card result-card status-${statusClass}`;
  container.append(head, body);
}

function renderNotices(container: HTMLElement, events: SessionEvent[], bootResult?: BootResultEvent): void {
  const notices = deriveRecentNotices(events, bootResult);

  if (notices.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-note notice-empty';
    empty.textContent = 'No recent notices.';
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(
    ...notices.map((notice) => {
      const item = document.createElement('div');
      item.className = `notice notice-${notice.tone}`;

      const dot = document.createElement('span');
      dot.className = 'notice-dot';
      dot.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.textContent = notice.message;

      const time = document.createElement('time');
      time.textContent = formatTime(notice.at);
      time.dateTime = notice.at;

      item.append(dot, text, time);
      return item;
    })
  );
}

function appendDefinition(list: HTMLDListElement, term: string, value: string): void {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = term;
  dd.textContent = value;
  list.append(dt, dd);
}

function deriveConnectionSummary(root: HTMLElement, state: AppState): {
  url: string;
  chargePointId: string;
  ocppVersion: string;
  connectedAt: string;
  duration: string;
  interval: string;
} {
  const configuredAddress = inputValue(root, '#addressInput');
  const configuredProtocol = getSelectedProtocol(root);
  const configuredUrl = configuredAddress ? previewConnectionUrl(configuredProtocol, configuredAddress) : EMPTY_VALUE;
  const url = state.connectResult?.url ?? configuredUrl;
  const subprotocol = state.connectResult?.subprotocol ?? inputValue(root, '#subprotocolInput');
  const interval = state.bootResult?.result.type === 'callResult' ? state.bootResult.result.interval : undefined;

  return {
    url,
    chargePointId: extractChargePointId(url),
    ocppVersion: formatOcppVersion(subprotocol),
    connectedAt: state.connectedAt ? formatTimestamp(state.connectedAt) : EMPTY_VALUE,
    duration: state.connectedAt && state.connectionState === 'connected' ? formatDuration(state.connectedAt) : EMPTY_VALUE,
    interval: interval === undefined ? EMPTY_VALUE : formatInterval(interval)
  };
}

function deriveSessionMetrics(state: AppState): {
  totalFrames: number;
  outboundFrames: number;
  inboundFrames: number;
  outboundPercent: string;
  inboundPercent: string;
  bootStatus: string;
  bootDetail: string;
  errors: number;
} {
  const frameEvents = state.events.filter((event) => event.type === 'frame');
  const outboundFrames = frameEvents.filter((event) => event.direction === 'out').length;
  const inboundFrames = frameEvents.filter((event) => event.direction === 'in').length;
  const totalFrames = frameEvents.length;
  const errors = state.events.filter(
    (event) =>
      (event.type === 'log' && event.level === 'error') ||
      (event.type === 'status' && event.status === 'error') ||
      (event.type === 'boot-result' && event.result.type === 'callError')
  ).length;

  return {
    totalFrames,
    outboundFrames,
    inboundFrames,
    outboundPercent: formatPercent(outboundFrames, totalFrames),
    inboundPercent: formatPercent(inboundFrames, totalFrames),
    bootStatus: getBootStatus(state.bootResult),
    bootDetail: getBootDetail(state.bootResult),
    errors
  };
}

function deriveEventRows(events: SessionEvent[]): Array<{
  time: string;
  direction: string;
  directionTone: string;
  type: string;
  requestId: string;
  summary: string;
  full: string;
  kind: string;
}> {
  return events
    .slice()
    .reverse()
    .map((event) => {
      if (event.type === 'frame') {
        const body = prettyJson(event.raw);
        return {
          time: formatTime(event.at),
          direction: event.direction === 'out' ? 'Outbound' : 'Inbound',
          directionTone: event.direction === 'out' ? 'out' : 'in',
          type: event.summary?.displayName ?? 'OCPP frame',
          requestId: event.summary?.uniqueId ?? EMPTY_VALUE,
          summary: summarizeText(body),
          full: body,
          kind: 'frame'
        };
      }

      if (event.type === 'status') {
        return {
          time: formatTime(event.at),
          direction: 'Status',
          directionTone: event.status === 'error' ? 'error' : 'status',
          type: labelForStatus(event.status),
          requestId: EMPTY_VALUE,
          summary: event.message,
          full: event.message,
          kind: 'status'
        };
      }

      if (event.type === 'boot-result') {
        const summary = event.result.type === 'callResult' ? event.result.status ?? 'CALLRESULT received' : event.result.errorCode;
        const full = JSON.stringify(event.result, null, 2);
        return {
          time: formatTime(event.at),
          direction: 'Parsed',
          directionTone: event.result.type === 'callError' ? 'error' : 'success',
          type: 'BootNotification result',
          requestId: event.result.uniqueId,
          summary,
          full,
          kind: 'boot-result'
        };
      }

      return {
        time: formatTime(event.at),
        direction: event.level,
        directionTone: event.level,
        type: event.level === 'success' ? 'Success' : event.level === 'warn' ? 'Warning' : event.level === 'error' ? 'Error' : 'Info',
        requestId: EMPTY_VALUE,
        summary: event.message,
        full: event.message,
        kind: 'log'
      };
    });
}

function deriveRecentNotices(events: SessionEvent[], bootResult?: BootResultEvent): Array<{ at: string; tone: string; message: string }> {
  const notices = events.flatMap((event) => {
    if (event.type === 'status' && (event.status === 'connected' || event.status === 'disconnected' || event.status === 'error')) {
      return [{ at: event.at, tone: event.status === 'error' ? 'error' : 'success', message: event.message }];
    }

    if (event.type === 'log' && (event.level === 'warn' || event.level === 'error' || event.level === 'success')) {
      return [{ at: event.at, tone: event.level, message: event.message }];
    }

    if (event.type === 'boot-result') {
      return [{ at: event.at, tone: event.result.type === 'callError' ? 'error' : 'success', message: bootResultMessage(event) }];
    }

    return [];
  });

  if (bootResult && !events.includes(bootResult)) {
    notices.push({ at: bootResult.at, tone: bootResult.result.type === 'callError' ? 'error' : 'success', message: bootResultMessage(bootResult) });
  }

  return notices.slice(-4).reverse();
}

function bootResultMessage(event: BootResultEvent): string {
  if (event.result.type === 'callResult') {
    return `BootNotification ${event.result.status ?? 'response received'}.`;
  }

  return `BootNotification failed: ${event.result.errorCode}.`;
}

function formatResultDetails(value: unknown): string {
  if (value === undefined || value === null) {
    return EMPTY_VALUE;
  }

  if (typeof value === 'string') {
    return value || EMPTY_VALUE;
  }

  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) {
      return EMPTY_VALUE;
    }

    return JSON.stringify(value, null, 2);
  }

  return String(value);
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

function pushLocalLog(state: { events: SessionEvent[] }, message: string, level: LogLevel): void {
  const event: SessionEvent = {
    type: 'log',
    at: new Date().toISOString(),
    level,
    message
  };

  state.events = [...state.events, event].slice(-MAX_EVENTS);
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function previewConnectionUrl(protocol: TransportProtocol, address: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(address)) {
    return address;
  }

  return `${protocol}://${address}`;
}

function extractChargePointId(url: string): string {
  if (!url || url === EMPTY_VALUE) {
    return EMPTY_VALUE;
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.at(-1) ?? EMPTY_VALUE;
  } catch {
    const segments = url.split('/').filter(Boolean);
    return segments.at(-1) ?? EMPTY_VALUE;
  }
}

function formatOcppVersion(subprotocol?: string): string {
  const normalized = subprotocol?.trim().toLowerCase();
  if (!normalized || normalized === 'ocpp1.6') {
    return '1.6J';
  }

  return subprotocol?.trim() ?? '1.6J';
}

function formatDuration(from: string, to = new Date().toISOString()): string {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return EMPTY_VALUE;
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || EMPTY_VALUE;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function formatInterval(seconds: number): string {
  return `${seconds} s`;
}

function formatPercent(value: number, total: number): string {
  if (total === 0) {
    return '0.0';
  }

  return ((value / total) * 100).toFixed(1);
}

function summarizeText(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}…` : singleLine || EMPTY_VALUE;
}

function getBootStatus(event?: BootResultEvent): string {
  if (!event) {
    return EMPTY_VALUE;
  }

  return event.result.type === 'callResult' ? event.result.status ?? 'Received' : 'Failed';
}

function getBootDetail(event?: BootResultEvent): string {
  if (!event) {
    return 'No response yet';
  }

  if (event.result.type === 'callResult') {
    return event.result.interval === undefined ? 'Response received' : `Interval ${formatInterval(event.result.interval)}`;
  }

  return event.result.errorCode;
}

function metricIconForVariant(variant: string): string {
  const icons: Record<string, string> = {
    outbound: '↑',
    inbound: '↓',
    boot: '↯',
    error: '!',
    neutral: '•'
  };

  return icons[variant] ?? '•';
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
