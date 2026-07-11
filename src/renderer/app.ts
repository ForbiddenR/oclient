import type {
  BootNotificationCallError,
  BootNotificationCallResult,
  BootNotificationPayload,
  ConnectResult,
  ConnectionState,
  HeaderEntry,
  OcppCommandResponse,
  SessionEvent
} from '../shared/types';

interface HeaderDraft {
  id: string;
  enabled: boolean;
  name: string;
  value: string;
}

type BootResultEvent = Extract<SessionEvent, { type: 'boot-result' }>;
type LogLevel = Extract<SessionEvent, { type: 'log' }>['level'];
type ConnectionFailureEvent = Extract<SessionEvent, { type: 'connection-failure' }>;

type AppRoute = 'dashboard' | 'messages' | 'boot' | 'settings';

const ROUTE_METADATA: Record<AppRoute, { title: string; eyebrow: string }> = {
  dashboard: { title: '仪表盘', eyebrow: '实时连接概览' },
  messages: { title: '消息日志', eyebrow: '会话帧与事件' },
  boot: { title: 'OCPP 命令', eyebrow: '充电点操作' },
  settings: { title: '连接设置', eyebrow: 'WebSocket 配置' }
};

const OCPP_COMMAND_PRESETS: Record<string, () => Record<string, unknown>> = {
  Heartbeat: () => ({}),
  StatusNotification: () => ({ connectorId: 1, errorCode: 'NoError', status: 'Available', timestamp: new Date().toISOString() }),
  Authorize: () => ({ idTag: 'TEST-TAG' }),
  StartTransaction: () => ({ connectorId: 1, idTag: 'TEST-TAG', meterStart: 0, timestamp: new Date().toISOString() }),
  StopTransaction: () => ({ transactionId: 1, meterStop: 0, timestamp: new Date().toISOString() }),
  MeterValues: () => ({
    connectorId: 1,
    meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: '0', measurand: 'Energy.Active.Import.Register', unit: 'Wh' }] }]
  }),
  DataTransfer: () => ({ vendorId: 'VendorId', messageId: 'MessageId', data: '' }),
  DiagnosticsStatusNotification: () => ({ status: 'Idle' }),
  FirmwareStatusNotification: () => ({ status: 'Idle' })

};

interface AppState {
  headers: HeaderDraft[];
  caCertificatePath: string;
  allowInsecureTls: boolean;
  connectionState: ConnectionState;
  events: SessionEvent[];
  bootResult?: BootResultEvent;
  connectResult?: ConnectResult;
  commandResult?: OcppCommandResponse;
  commandError?: string;
  connectionFailure?: ConnectionFailureEvent;
  connectedAt?: string;
  disconnectedAt?: string;
}

interface DashboardElements {
  routeTitle: HTMLElement;
  routeEyebrow: HTMLElement;
  commandActionInput: HTMLInputElement;
  commandPayloadInput: HTMLTextAreaElement;
  sendCommandButton: HTMLButtonElement;
  commandResultCard: HTMLElement;
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
  failureNotification: HTMLElement;
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
    commandResult: undefined,
    commandError: undefined,
    connectionFailure: undefined,
    connectedAt: undefined,
    disconnectedAt: undefined
  };
  let durationTimer: number | undefined;

  root.innerHTML = buildAppMarkup();

  const elements: DashboardElements = {
    routeTitle: mustQuery<HTMLElement>(root, '#routeTitle'),
    routeEyebrow: mustQuery<HTMLElement>(root, '#routeEyebrow'),
    commandActionInput: mustQuery<HTMLInputElement>(root, '#commandActionInput'),
    commandPayloadInput: mustQuery<HTMLTextAreaElement>(root, '#commandPayloadInput'),
    sendCommandButton: mustQuery<HTMLButtonElement>(root, '#sendCommandButton'),
    commandResultCard: mustQuery<HTMLElement>(root, '#commandResultCard'),
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
    failureNotification: mustQuery<HTMLElement>(root, '#connectionFailureNotification'),
    overviewGrid: mustQuery<HTMLElement>(root, '#overviewGrid'),
    metricGrid: mustQuery<HTMLElement>(root, '#metricGrid'),
    eventLog: mustQuery<HTMLElement>(root, '#eventLog'),
    noticesList: mustQuery<HTMLElement>(root, '#noticesList'),
    resultCard: mustQuery<HTMLElement>(root, '#resultCard')
  };

  const renderRoute = () => {
    const route = routeFromHash(window.location.hash);
    const metadata = ROUTE_METADATA[route];

    elements.routeTitle.textContent = metadata.title;
    elements.routeEyebrow.textContent = metadata.eyebrow;
    document.title = metadata.title + ' · OCPP 客户端';
    mustQuery<HTMLElement>(root, '.dashboard').dataset.currentRoute = route;

    root.querySelectorAll<HTMLElement>('[data-route-section]').forEach((section) => {
      section.hidden = section.dataset.routeSection !== route;
    });

    elements.form.hidden = route === 'messages';
    elements.connectButton.hidden = route !== 'dashboard';
    elements.disconnectButton.hidden = route !== 'dashboard';
    elements.bootButton.hidden = route !== 'boot';

    root.querySelectorAll<HTMLAnchorElement>('[data-route-link]').forEach((link) => {
      const isActive = link.dataset.routeLink === route;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const renderDashboard = () => {
    renderTransport(root, elements.caSection, elements.caPath, state.caCertificatePath, state.allowInsecureTls);
    renderStatus(elements, state.connectionState);
    renderConnectionFailure(elements.failureNotification, state.connectionFailure);
    renderCommandResult(elements.commandResultCard, state.commandResult, state.commandError);
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
  renderRoute();
  renderDashboard();

  window.addEventListener('hashchange', () => {
    renderRoute();
    window.scrollTo(0, 0);
  });

  root.addEventListener('change', (event) => {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.id === 'commandActionInput') {
      elements.commandPayloadInput.value = JSON.stringify(commandPreset(target.value), null, 2);
    }

    if (target instanceof HTMLInputElement && target.id === 'tlsInput') {
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

    if (target instanceof HTMLInputElement && ['domainInput', 'portInput', 'pathInput', 'subprotocolInput'].includes(target.id)) {
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

  elements.failureNotification.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-dismiss-connection-failure]')) {
      state.connectionFailure = undefined;
      renderDashboard();
    }
  });

  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.connectButton.disabled = true;
    state.connectResult = undefined;
    state.commandResult = undefined;
    state.commandError = undefined;
    state.connectionFailure = undefined;
    state.connectedAt = undefined;
    state.disconnectedAt = undefined;
    resetResult(elements.resultCard, state);
    stopDurationTimer();

    try {
      const result = await window.oclient.connect({
        tls: isTlsEnabled(root),
        domain: inputValue(root, '#domainInput'),
        port: optionalPortValue(root),
        path: inputValue(root, '#pathInput'),
        subprotocol: inputValue(root, '#subprotocolInput'),
        caCertificatePath: state.caCertificatePath || undefined,
        headers: collectHeaders(state.headers),
        allowInsecureTls: state.allowInsecureTls
      });

      if (result.ok) {
        state.connectResult = result;
      } else {
        state.connectionFailure = {
          type: 'connection-failure',
          at: new Date().toISOString(),
          failure: result.failure ?? {
            code: 'unknown',
            title: 'WebSocket connection failed',
            reason: result.error ?? 'An unknown WebSocket error occurred.'
          }
        };
        pushLocalLog(state, `连接失败： ${result.error ?? '未知错误。'}`, 'error');
      }
    } catch (error) {
      const reason = getErrorMessage(error);
      state.connectionFailure = {
        type: 'connection-failure',
        at: new Date().toISOString(),
        failure: { code: 'unknown', title: 'WebSocket connection failed', reason }
      };
      pushLocalLog(state, reason, 'error');
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

  elements.sendCommandButton.addEventListener('click', async () => {
    state.commandResult = undefined;
    state.commandError = undefined;
    renderCommandResult(elements.commandResultCard);
    elements.sendCommandButton.disabled = true;
    elements.sendCommandButton.dataset.pending = 'true';

    try {
      const response = await window.oclient.sendOcppCommand({
        action: elements.commandActionInput.value,
        payload: parseCommandPayload(elements.commandPayloadInput.value)
      });
      state.commandResult = response;
    } catch (error) {
      state.commandError = getErrorMessage(error);
      pushLocalLog(state, state.commandError, 'error');
    } finally {
      delete elements.sendCommandButton.dataset.pending;
      renderDashboard();
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
        state.connectionFailure = undefined;
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

    if (event.type === 'connection-failure') {
      state.connectionFailure = event;
    }

    renderDashboard();
  });
}

function buildAppMarkup(): string {
  return `
    <section class="app-shell" aria-label="OCPP 客户端仪表盘">
      <aside class="rail" aria-label="应用导航">
        <div class="rail-brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>
          </span>
          <div>
            <h1>OCPP 客户端</h1>
            <p>OCPP 1.6J 测试台</p>
          </div>
        </div>

        <nav class="rail-nav" aria-label="仪表盘分区">
          <a class="active" href="#/dashboard" data-route-link="dashboard" title="仪表盘" aria-label="仪表盘"><span class="rail-icon" aria-hidden="true">⌂</span><span>仪表盘</span></a>
          <a href="#/messages" data-route-link="messages" title="消息日志" aria-label="消息日志"><span class="rail-icon" aria-hidden="true">⇄</span><span>消息日志</span></a>
          <a href="#/boot" data-route-link="boot" title="OCPP 命令" aria-label="OCPP 命令"><span class="rail-icon" aria-hidden="true">↯</span><span>OCPP 命令</span></a>
          <a href="#/settings" data-route-link="settings" title="连接设置" aria-label="连接设置"><span class="rail-icon" aria-hidden="true">⚙</span><span>连接设置</span></a>
        </nav>

        <div class="rail-summary" aria-label="当前会话摘要">
          <div class="rail-status-line"><span class="status-dot" aria-hidden="true"></span><span id="railStatus">Idle</span></div>
          <dl>
            <div><dt>连接时长</dt><dd id="railDuration">—</dd></div>
            <div><dt>OCPP 版本</dt><dd id="railVersion">1.6J</dd></div>
          </dl>
        </div>
      </aside>

      <main class="dashboard">
        <header class="dashboard-topbar">
          <div>
            <p id="routeEyebrow" class="eyebrow">实时连接概览</p>
            <h2 id="routeTitle">仪表盘</h2>
          </div>
          <div class="session-actions" aria-label="会话操作">
            <button id="connectButton" class="primary" type="submit" form="controlForm" formnovalidate>连接</button>
            <button id="disconnectButton" class="secondary" type="button" disabled>断开连接</button>
            <button id="bootButton" class="accent" type="button" disabled>发送 BootNotification</button>
          </div>
        </header>

        <section id="connectionFailureNotification" class="connection-alert" role="alert" aria-live="assertive" hidden></section>

        <section id="dashboard" class="card connection-card" data-route-section="dashboard" aria-label="连接状态">
          <header class="card-head">
            <div>
              <p class="eyebrow">连接状态</p>
              <h3>中央系统会话</h3>
            </div>
            <div id="statusBadge" class="status-badge is-idle">Idle</div>
          </header>
          <div id="overviewGrid" class="overview-grid"></div>
        </section>

        <section id="metricGrid" class="metrics-grid" data-route-section="dashboard" aria-label="会话指标"></section>

        <div class="content-grid">
          <section id="messages" class="card log-card" data-route-section="messages">
            <header class="card-head">
              <div>
                <p class="eyebrow">消息</p>
                <h3>消息日志</h3>
              </div>
              <button id="clearLogButton" class="ghost" type="button">清空</button>
            </header>
            <div class="log-table" role="table" aria-label="OCPP 会话消息">
              <div class="log-row log-head" role="row">
                <span role="columnheader">时间</span>
                <span role="columnheader">方向</span>
                <span role="columnheader">类型</span>
                <span role="columnheader">请求 ID</span>
                <span role="columnheader">摘要</span>
              </div>
              <div id="eventLog" class="log-rows" aria-live="polite"></div>
            </div>
          </section>

          <form id="controlForm" class="side-stack">
            <section class="card command-card" data-route-section="boot">
              <header class="card-head">
                <div>
                  <p class="eyebrow">通用 CALL</p>
                  <h3>OCPP 1.6 命令控制台</h3>
                </div>
              </header>
              <div class="card-body">
                <label class="field">
                  <span>Action</span>
                  <input id="commandActionInput" type="text" list="commandActionOptions" value="Heartbeat" autocomplete="off" spellcheck="false" />
                  <small>选择预设或输入任意 OCPP / 厂商自定义 Action。</small>
                </label>
                <datalist id="commandActionOptions">
                  <option value="Heartbeat"></option>
                  <option value="StatusNotification"></option>
                  <option value="Authorize"></option>
                  <option value="StartTransaction"></option>
                  <option value="StopTransaction"></option>
                  <option value="MeterValues"></option>
                  <option value="DataTransfer"></option>
                  <option value="DiagnosticsStatusNotification"></option>
                  <option value="FirmwareStatusNotification"></option>
                </datalist>
                <label class="field">
                  <span>JSON Payload</span>
                  <textarea id="commandPayloadInput" rows="12" spellcheck="false">{}</textarea>
                </label>
                <div class="button-row">
                  <button id="sendCommandButton" class="primary" type="button" disabled>发送 OCPP 命令</button>
                </div>
              </div>
            </section>

            <section id="commandResultCard" class="card result-card command-result-card empty" data-route-section="boot">
              <header class="card-head">
                <div>
                  <p class="eyebrow">通用响应</p>
                  <h3>命令结果</h3>
                </div>
              </header>
              <div class="card-body">
                <p class="empty-note">发送 OCPP 命令后查看 CALLRESULT 或 CALLERROR。</p>
              </div>
            </section>

            <section id="boot" class="card boot-card" data-route-section="boot">
              <header class="card-head">
                <div>
                  <p class="eyebrow">编辑器</p>
                  <h3>BootNotification</h3>
                </div>
              </header>
              <div class="card-body">
                <div class="field-grid">
                  <label class="field">
                    <span>厂商</span>
                    <input id="vendorInput" name="chargePointVendor" type="text" value="Workbench EV" required />
                  </label>
                  <label class="field">
                    <span>型号</span>
                    <input id="modelInput" name="chargePointModel" type="text" value="Bench-16J" required />
                  </label>
                </div>

                <details class="advanced-fields">
                  <summary>可选 OCPP 字段</summary>
                  <div class="field-grid">
                    <label class="field"><span>充电点序列号</span><input id="chargePointSerialInput" type="text" /></label>
                    <label class="field"><span>充电盒序列号</span><input id="chargeBoxSerialInput" type="text" /></label>
                    <label class="field"><span>固件版本</span><input id="firmwareInput" type="text" /></label>
                    <label class="field"><span>ICCID</span><input id="iccidInput" type="text" /></label>
                    <label class="field"><span>IMSI</span><input id="imsiInput" type="text" /></label>
                    <label class="field"><span>电表序列号</span><input id="meterSerialInput" type="text" /></label>
                    <label class="field"><span>电表类型</span><input id="meterTypeInput" type="text" /></label>
                  </div>
                </details>
              </div>
            </section>

            <section id="resultCard" class="card result-card empty" data-route-section="boot">
              <header class="card-head">
                <div>
                  <p class="eyebrow">解析响应</p>
                  <h3>BootNotification 结果</h3>
                </div>
              </header>
              <div class="card-body">
                <p class="empty-note">连接到中央系统并发送 BootNotification 后查看解析响应。</p>
              </div>
            </section>

            <section class="card notices-card" data-route-section="dashboard">
              <header class="card-head">
                <div>
                  <p class="eyebrow">活动</p>
                  <h3>最近通知</h3>
                </div>
              </header>
              <div id="noticesList" class="notice-list"></div>
            </section>

            <section id="settings" class="card settings-card" data-route-section="settings">
              <header class="card-head">
                <div>
                  <p class="eyebrow">设置</p>
                  <h3>连接设置</h3>
                </div>
              </header>
              <div class="card-body">
                <label class="tls-toggle">
                  <input id="tlsInput" name="tls" type="checkbox" />
                  <span class="tls-toggle-copy">
                    <strong>启用 TLS</strong>
                    <small>加密与中央系统之间的 WebSocket 连接，并启用证书验证选项。</small>
                  </span>
                  <span class="tls-toggle-control" aria-hidden="true"></span>
                </label>

                <div class="endpoint-fields" role="group" aria-label="中央系统端点">
                  <label class="field">
                    <span>域名或 IP</span>
                    <input id="domainInput" name="domain" type="text" value="127.0.0.1" placeholder="central.example.com" autocomplete="off" spellcheck="false" />
                  </label>
                  <label class="field">
                    <span>端口</span>
                    <input id="portInput" name="port" type="number" value="9000" min="1" max="65535" inputmode="numeric" placeholder="9000" autocomplete="off" />
                  </label>
                  <label class="field">
                    <span>路径</span>
                    <input id="pathInput" name="path" type="text" value="/CP001" placeholder="/CP001" autocomplete="off" spellcheck="false" />
                  </label>
                </div>
                <p class="endpoint-hint">协议由 TLS 开关自动决定；端口留空时使用默认端口。</p>

                <label class="field compact">
                  <span>子协议</span>
                  <input id="subprotocolInput" name="subprotocol" type="text" value="ocpp1.6" autocomplete="off" spellcheck="false" />
                </label>

                <div id="caSection" class="certificate-card" hidden>
                  <div>
                    <span class="field-label">CA 证书</span>
                    <p id="caPath" class="path-readout">未选择证书</p>
                  </div>
                  <div class="button-row tight">
                    <button id="pickCaButton" class="secondary" type="button">选择 CA</button>
                    <button id="clearCaButton" class="ghost" type="button">清空</button>
                  </div>
                  <label class="insecure-toggle">
                    <input id="insecureTlsInput" type="checkbox" />
                    <span>允许不安全 TLS</span>
                    <small>跳过服务器证书验证。仅用于测试自签名 CSMS 证书。</small>
                  </label>
                </div>
              </div>
            </section>

            <section class="card headers-card" data-route-section="settings">
              <header class="card-head">
                <div>
                  <p class="eyebrow">握手</p>
                  <h3>自定义请求头</h3>
                </div>
                <button id="addHeaderButton" class="inline-action" type="button">+ 添加请求头</button>
              </header>
              <div class="card-body">
                <div class="header-table" role="group" aria-label="自定义请求头">
                  <div class="header-row header-head" aria-hidden="true">
                    <span>启用</span>
                    <span>名称</span>
                    <span>值</span>
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

function routeFromHash(hash: string): AppRoute {
  const route = hash.replace(/^#\/?/, '');
  return route in ROUTE_METADATA ? (route as AppRoute) : 'dashboard';
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
  input.setAttribute('aria-label', '启用请求头');

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
  input.setAttribute('aria-label', field === 'name' ? '请求头名称' : '请求头值');
  return input;
}

function createRemoveButton(id: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row-delete';
  button.dataset.removeHeader = id;
  button.textContent = '删除';
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
  const isSecure = isTlsEnabled(root);
  caSection.hidden = !isSecure;
  caPath.textContent = selectedPath || '未选择证书';

  const insecureTlsInput = root.querySelector<HTMLInputElement>('#insecureTlsInput');
  if (insecureTlsInput) {
    insecureTlsInput.checked = allowInsecureTls;
  }
}

function renderConnectionFailure(container: HTMLElement, event?: ConnectionFailureEvent): void {
  container.hidden = !event;
  if (!event) {
    container.replaceChildren();
    return;
  }

  const icon = document.createElement('span');
  icon.className = 'connection-alert-icon';
  icon.textContent = '!';
  icon.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'connection-alert-content';
  const title = document.createElement('strong');
  title.textContent = event.failure.title;
  const reason = document.createElement('p');
  reason.textContent = event.failure.reason;
  content.append(title, reason);

  const metadata = [
    `错误类型: ${event.failure.code}`,
    event.failure.statusCode === undefined ? undefined : `HTTP 状态: ${event.failure.statusCode}`
  ].filter((value): value is string => Boolean(value));

  if (event.failure.technicalDetails || metadata.length > 0) {
    const details = document.createElement('details');
    details.className = 'connection-alert-details';
    const summary = document.createElement('summary');
    summary.textContent = '查看技术详情';
    const pre = document.createElement('pre');
    pre.textContent = [...metadata, event.failure.technicalDetails].filter(Boolean).join('\n');
    details.append(summary, pre);
    content.append(details);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'connection-alert-dismiss';
  dismiss.dataset.dismissConnectionFailure = 'true';
  dismiss.textContent = '关闭';
  dismiss.setAttribute('aria-label', '关闭 WebSocket 失败通知');

  const time = document.createElement('time');
  time.dateTime = event.at;
  time.textContent = formatTime(event.at);

  container.replaceChildren(icon, content, time, dismiss);
}

function renderStatus(elements: DashboardElements, status: ConnectionState): void {
  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';
  const isDisconnecting = status === 'disconnecting';

  elements.connectButton.disabled = isConnecting || isConnected || isDisconnecting;
  elements.disconnectButton.disabled = !isConnected || isDisconnecting;
  elements.bootButton.disabled = !isConnected;
  elements.sendCommandButton.disabled = !isConnected || elements.sendCommandButton.dataset.pending === 'true';

  elements.statusBadge.className = `status-badge is-${status}`;
  elements.statusBadge.textContent = labelForStatus(status);
  elements.railStatus.textContent = labelForStatus(status);
  elements.railStatus.parentElement?.querySelector('.status-dot')?.setAttribute('data-status', status);
}

function renderConnectionOverview(container: HTMLElement, root: HTMLElement, state: AppState): void {
  const summary = deriveConnectionSummary(root, state);
  container.replaceChildren(
    createDefinitionTile('WebSocket URL', summary.url),
    createDefinitionTile('传输方式', summary.transport),
    createDefinitionTile('充电点 ID', summary.chargePointId),
    createDefinitionTile('子协议', summary.subprotocol),
    createDefinitionTile('握手状态', summary.handshakeStatus),
    createDefinitionTile('远程端点', summary.remoteEndpoint),
    createDefinitionTile('本地端点', summary.localEndpoint),
    createDefinitionTile('TLS', summary.tls),
    createDefinitionTile('扩展', summary.extensions),
    createDefinitionTile('自定义请求头', summary.customHeaders),
    createDefinitionTile('响应头', summary.responseHeaders),
    createDefinitionTile('连接时间', summary.connectedAt),
    createDefinitionTile('连接时长', summary.duration),
    createDefinitionTile('心跳间隔', summary.interval)
  );
}

function createDefinitionTile(label: string, value: string): HTMLDivElement {
  const tile = document.createElement('div');
  tile.className = 'overview-tile';

  if (label === '响应头') {
    tile.classList.add('overview-tile-detail');
  }

  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dd.title = value;

  tile.append(dt, dd);
  return tile;
}

function renderSessionMetrics(container: HTMLElement, state: AppState): void {
  const metrics = deriveSessionMetrics(state);
  container.replaceChildren(
    createMetricCard('总帧数', String(metrics.totalFrames), 'OCPP-J 帧', 'neutral'),
    createMetricCard('发送', String(metrics.outboundFrames), `${metrics.outboundPercent}% 帧占比`, 'outbound'),
    createMetricCard('接收', String(metrics.inboundFrames), `${metrics.inboundPercent}% 帧占比`, 'inbound'),
    createMetricCard('Boot 状态', metrics.bootStatus, metrics.bootDetail, 'boot'),
    createMetricCard('错误', String(metrics.errors), metrics.errors === 1 ? '需要处理' : '日志事件', metrics.errors > 0 ? 'error' : 'neutral')
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
    empty.textContent = '暂无会话消息。';
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

function commandPreset(action: string): Record<string, unknown> {
  return OCPP_COMMAND_PRESETS[action.trim()]?.() ?? {};
}

function parseCommandPayload(raw: string): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error('Payload 必须是有效的 JSON：' + getErrorMessage(error));
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('OCPP CALL Payload 必须是 JSON 对象。');
  }

  return payload as Record<string, unknown>;
}

function renderCommandResult(container: HTMLElement, response?: OcppCommandResponse, error?: string): void {
  if (error) {
    container.className = 'card result-card command-result-card status-rejected';
    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('p');
    title.className = 'result-title';
    const icon = document.createElement('span');
    icon.className = 'result-icon';
    title.append(icon, document.createTextNode('命令未发送'));
    const message = document.createElement('p');
    message.className = 'empty-note';
    message.textContent = error;
    body.append(title, message);
    container.replaceChildren(body);
    return;
  }

  if (!response) {
    container.className = 'card result-card command-result-card empty';
    container.innerHTML = '<header class="card-head"><div><p class="eyebrow">通用响应</p><h3>命令结果</h3></div></header><div class="card-body"><p class="empty-note">发送 OCPP 命令后查看 CALLRESULT 或 CALLERROR。</p></div>';
    return;
  }

  const head = document.createElement('header');
  head.className = 'card-head';
  const headWrap = document.createElement('div');
  const headEyebrow = document.createElement('p');
  headEyebrow.className = 'eyebrow';
  headEyebrow.textContent = '通用响应';
  const headTitle = document.createElement('h3');
  headTitle.textContent = response.action + ' 结果';
  headWrap.append(headEyebrow, headTitle);
  head.append(headWrap);

  const body = document.createElement('div');
  body.className = 'card-body';
  const title = document.createElement('p');
  title.className = 'result-title';
  const icon = document.createElement('span');
  icon.className = 'result-icon';
  title.append(icon, document.createTextNode(response.type === 'callResult' ? 'CALLRESULT' : response.errorCode));

  const details = document.createElement('dl');
  details.className = 'result-grid';
  appendDefinition(details, 'Action', response.action);
  appendDefinition(details, 'Request ID', response.uniqueId);
  if (response.type === 'callResult') {
    appendDefinition(details, 'Payload', formatResultDetails(response.rawPayload));
  } else {
    appendDefinition(details, '错误码', response.errorCode);
    appendDefinition(details, '描述', response.errorDescription || EMPTY_VALUE);
    appendDefinition(details, '详情', formatResultDetails(response.errorDetails));
  }

  body.append(title, details);
  container.className = 'card result-card command-result-card status-' + (response.type === 'callResult' ? 'accepted' : 'rejected');
  container.replaceChildren(head, body);
}

function resetResult(container: HTMLElement, state: { bootResult?: BootResultEvent }): void {
  state.bootResult = undefined;
  container.className = 'card result-card empty';
  container.innerHTML = `
    <header class="card-head">
      <div>
        <p class="eyebrow">解析响应</p>
        <h3>BootNotification 结果</h3>
      </div>
    </header>
    <div class="card-body">
      <p class="empty-note">连接到中央系统并发送 BootNotification 后查看解析响应。</p>
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
  eyebrow.textContent = '解析响应';
  const headTitle = document.createElement('h3');
  headTitle.textContent = 'BootNotification 结果';
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
    appendDefinition(details, '当前时间', result.currentTime ? formatTimestamp(result.currentTime) : EMPTY_VALUE);
    appendDefinition(details, '间隔', result.interval === undefined ? EMPTY_VALUE : formatInterval(result.interval));
    appendDefinition(details, 'Request ID', result.uniqueId);
    appendDefinition(details, '原始载荷', formatResultDetails(result.rawPayload));
  } else {
    const result = event.result as BootNotificationCallError;
    statusClass = 'rejected';
    title.append(document.createTextNode(result.errorCode));
    appendDefinition(details, '描述', result.errorDescription || EMPTY_VALUE);
    appendDefinition(details, '详情', formatResultDetails(result.errorDetails));
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
    empty.textContent = '暂无最近通知。';
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
  transport: string;
  subprotocol: string;
  handshakeStatus: string;
  remoteEndpoint: string;
  localEndpoint: string;
  tls: string;
  extensions: string;
  customHeaders: string;
  responseHeaders: string;
  connectedAt: string;
  duration: string;
  interval: string;
} {
  const configuredDomain = inputValue(root, '#domainInput');
  const tlsEnabled = isTlsEnabled(root);
  const configuredPort = optionalPortValue(root);
  const configuredPath = inputValue(root, '#pathInput');
  const configuredUrl = configuredDomain
    ? previewConnectionUrl(tlsEnabled, configuredDomain, configuredPort, configuredPath)
    : EMPTY_VALUE;
  const url = state.connectResult?.url ?? configuredUrl;
  const configuredSubprotocol = inputValue(root, '#subprotocolInput') || 'ocpp1.6';
  const details = state.connectResult?.details;
  const responseHeaders = details
    ? Object.entries(details.responseHeaders)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')
    : '';
  const interval = state.bootResult?.result.type === 'callResult' ? state.bootResult.result.interval : undefined;

  return {
    url,
    chargePointId: extractChargePointId(url),
    transport: details?.transport === 'wss' || (!details && tlsEnabled) ? 'WebSocket + TLS' : 'WebSocket',
    subprotocol: details
      ? `${details.requestedSubprotocol} → ${details.negotiatedSubprotocol}`
      : configuredSubprotocol,
    handshakeStatus: details ? `HTTP ${details.handshakeStatus} Switching Protocols` : EMPTY_VALUE,
    remoteEndpoint: details?.remoteEndpoint ?? EMPTY_VALUE,
    localEndpoint: details?.localEndpoint ?? EMPTY_VALUE,
    tls: details ? formatTlsDetails(details.tlsMode, details.tlsProtocol, details.cipher) : previewTlsMode(tlsEnabled, state),
    extensions: details?.extensions ?? '无',
    customHeaders: details?.customHeaderNames.length ? details.customHeaderNames.join(', ') : '无',
    responseHeaders: responseHeaders || EMPTY_VALUE,
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
  const connectionFailureTimes = new Set(
    state.events.filter((event) => event.type === 'connection-failure').map((event) => event.at)
  );
  const errors = state.events.filter(
    (event) =>
      event.type === 'connection-failure' ||
      (event.type === 'log' && event.level === 'error' && !connectionFailureTimes.has(event.at)) ||
      (event.type === 'status' && event.status === 'error' && !connectionFailureTimes.has(event.at)) ||
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
          direction: event.direction === 'out' ? '发送' : '接收',
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
          direction: '状态',
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
          direction: '解析',
          directionTone: event.result.type === 'callError' ? 'error' : 'success',
          type: 'BootNotification 结果',
          requestId: event.result.uniqueId,
          summary,
          full,
          kind: 'boot-result'
        };
      }

      if (event.type === 'connection-failure') {
        const full = [event.failure.reason, event.failure.technicalDetails].filter(Boolean).join('\n');
        return {
          time: formatTime(event.at),
          direction: '失败',
          directionTone: 'error',
          type: event.failure.title,
          requestId: EMPTY_VALUE,
          summary: event.failure.reason,
          full,
          kind: 'connection-failure'
        };
      }

      return {
        time: formatTime(event.at),
        direction: event.level,
        directionTone: event.level,
        type: event.level === 'success' ? '成功' : event.level === 'warn' ? '警告' : event.level === 'error' ? '错误' : '信息',
        requestId: EMPTY_VALUE,
        summary: event.message,
        full: event.message,
        kind: 'log'
      };
    });
}

function deriveRecentNotices(events: SessionEvent[], bootResult?: BootResultEvent): Array<{ at: string; tone: string; message: string }> {
  const connectionFailureTimes = new Set(
    events.filter((event) => event.type === 'connection-failure').map((event) => event.at)
  );
  const notices = events.flatMap((event) => {
    if (event.type === 'connection-failure') {
      return [{ at: event.at, tone: 'error', message: `${event.failure.title}: ${event.failure.reason}` }];
    }

    if (connectionFailureTimes.has(event.at) && ((event.type === 'status' && event.status === 'error') || (event.type === 'log' && event.level === 'error'))) {
      return [];
    }

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
    return `BootNotification ${event.result.status ?? '已收到响应'}。`;
  }

  return `BootNotification 失败：${event.result.errorCode}。`;
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

function isTlsEnabled(root: HTMLElement): boolean {
  return mustQuery<HTMLInputElement>(root, '#tlsInput').checked;
}

function optionalPortValue(root: HTMLElement): number | undefined {
  const value = inputValue(root, '#portInput');
  return value ? Number(value) : undefined;
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

function previewConnectionUrl(tls: boolean, domain: string, port?: number, path = ''): string {
  const normalizedDomain = domain.includes(':') && !domain.startsWith('[') ? '[' + domain + ']' : domain;
  const portSuffix = port === undefined || !Number.isFinite(port) ? '' : ':' + port;
  const trimmedPath = path.trim();
  const normalizedPath = !trimmedPath ? '/' : trimmedPath.startsWith('/') ? trimmedPath : '/' + trimmedPath;

  return (tls ? 'wss' : 'ws') + '://' + normalizedDomain + portSuffix + normalizedPath;
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

function previewTlsMode(tls: boolean, state: Pick<AppState, 'allowInsecureTls' | 'caCertificatePath'>): string {
  if (!tls) {
    return '不适用';
  }

  if (state.allowInsecureTls) {
    return '证书验证已禁用';
  }

  return state.caCertificatePath ? '自定义 CA 验证' : '系统 CA 验证';
}

function formatTlsDetails(
  mode: 'not-applicable' | 'verified' | 'custom-ca' | 'insecure',
  protocol?: string,
  cipher?: string
): string {
  if (mode === 'not-applicable') {
    return '不适用';
  }

  const labels = {
    verified: '已验证（系统 CA）',
    'custom-ca': '已验证（自定义 CA）',
    insecure: '未验证（不安全）'
  } as const;
  const details = [labels[mode], protocol, cipher].filter(Boolean);
  return details.join(' · ');
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

  return event.result.type === 'callResult' ? event.result.status ?? '已收到' : '失败';
}

function getBootDetail(event?: BootResultEvent): string {
  if (!event) {
    return '暂无响应';
  }

  if (event.result.type === 'callResult') {
    return event.result.interval === undefined ? '已收到响应' : `间隔 ${formatInterval(event.result.interval)}`;
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
    idle: '空闲',
    connecting: '连接中',
    connected: '已连接',
    disconnecting: '断开中',
    disconnected: '已断开',
    error: '错误'
  };

  return labels[status];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
