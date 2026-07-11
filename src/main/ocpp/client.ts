import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { RawData } from 'ws';
import WebSocket from 'ws';
import type {
  BootNotificationPayload,
  BootNotificationResponse,
  ConnectConfig,
  ConnectResult,
  ConnectionState,
  HeaderEntry,
  OcppCommandRequest,
  OcppCommandResponse,
  SessionEvent,
  TransportProtocol,
  WebSocketConnectionDetails,
  WebSocketFailure
} from '../../shared/types';
import {
  createBootNotificationCall,
  createOcppCall,
  OCPP_CALL_ERROR,
  OCPP_CALL_RESULT,
  OcppMessageError,
  parseOcppFrame,
  stringifyFrame,
  summarizeOcppFrame,
  toBootNotificationResponse,
  toOcppCommandResponse
} from './messages';

const DEFAULT_SUBPROTOCOL = 'ocpp1.6';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const MAX_UPGRADE_RESPONSE_BODY_LENGTH = 8_192;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 1_048_576;

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const RESERVED_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'sec-websocket-accept',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'transfer-encoding',
  'upgrade'
]);

type LogLevel = Extract<SessionEvent, { type: 'log' }>['level'];

interface PendingCommand {
  action: string;
  timer: NodeJS.Timeout;
  resolve: (response: OcppCommandResponse) => void;
  reject: (error: Error) => void;
}

interface PendingRequest {
  action: 'BootNotification';
  timer: NodeJS.Timeout;
  resolve: (response: BootNotificationResponse) => void;
  reject: (error: Error) => void;
}

export class OcppClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcppClientError';
  }
}

export class OcppClient {
  private socket?: WebSocket;
  private requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingCommands = new Map<string, PendingCommand>();

  constructor(private readonly emitSessionEvent: (event: SessionEvent) => void = () => undefined) {}

  async connect(config: ConnectConfig): Promise<ConnectResult> {
    let url: string;
    let protocol: TransportProtocol;
    let headers: Record<string, string>;
    let ca: Buffer | undefined;
    let subprotocol: string;
    let rejectUnauthorized: boolean;
    let tlsMode: WebSocketConnectionDetails['tlsMode'];

    try {
      subprotocol = normalizeSubprotocol(config.subprotocol);
      this.requestTimeoutMs = normalizeRequestTimeout(config.requestTimeoutMs);
      url = normalizeConnectionUrl(config.protocol, config.address);
      protocol = getProtocolFromUrl(url);
      headers = normalizeCustomHeaders(config.headers ?? []);
      rejectUnauthorized = normalizeRejectUnauthorized(protocol, config.allowInsecureTls);
      tlsMode = getTlsMode(protocol, Boolean(config.caCertificatePath), rejectUnauthorized);

      if (protocol === 'wss' && config.caCertificatePath) {
        ca = await readFile(config.caCertificatePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = createFailure('configuration', 'Connection configuration error', message);
      this.reportConnectionFailure(failure);
      return { ok: false, error: failure.reason, failure };
    }

    await this.disconnect(false);

    this.setStatus('connecting', `Opening ${url}`);
    this.log('info', `Connecting with ${subprotocol} over ${protocol.toUpperCase()}.`);

    if (!rejectUnauthorized) {
      this.log('warn', 'TLS certificate validation is disabled. The server identity will not be verified.');
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url, subprotocol, {
        ca,
        headers,
        rejectUnauthorized,
        maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
        perMessageDeflate: false
      });
    } catch (error) {
      const failure = describeWebSocketError(error instanceof Error ? error : new Error(String(error)));
      this.reportConnectionFailure(failure);
      return { ok: false, error: failure.reason, failure };
    }

    this.socket = socket;

    return new Promise<ConnectResult>((resolve) => {
      let settled = false;
      let failedBeforeOpen = false;
      let failureReported = false;
      let upgradeResponse: IncomingMessage | undefined;
      const settle = (result: ConnectResult) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(connectTimer);
        resolve(result);
      };

      const reportFailure = (failure: WebSocketFailure) => {
        if (failureReported) {
          return;
        }

        failureReported = true;
        this.reportConnectionFailure(failure);
      };

      const connectTimer = setTimeout(() => {
        failedBeforeOpen = true;
        const failure = createFailure(
          'timeout',
          'WebSocket connection timed out',
          `The server did not complete the WebSocket handshake within ${DEFAULT_CONNECT_TIMEOUT_MS / 1000} seconds.`
        );
        reportFailure(failure);
        socket.terminate();
        settle({ ok: false, error: failure.reason, failure });
      }, DEFAULT_CONNECT_TIMEOUT_MS);

      socket.on('upgrade', (response) => {
        upgradeResponse = response;
      });

      socket.on('open', () => {
        if (socket.protocol !== subprotocol) {
          failedBeforeOpen = true;
          const failure = createFailure(
            'subprotocol',
            'OCPP subprotocol negotiation failed',
            `The server did not negotiate the required subprotocol ${subprotocol}.`,
            `Negotiated value: ${socket.protocol || '(none)'}`
          );
          reportFailure(failure);
          socket.close(1002, failure.reason);
          settle({ ok: false, error: failure.reason, failure });
          return;
        }

        const details = createConnectionDetails({
          url,
          protocol,
          subprotocol,
          socket,
          response: upgradeResponse,
          tlsMode,
          customHeaderNames: Object.keys(headers)
        });
        this.setStatus('connected', `Connected to ${url}`);
        this.log('success', `Socket open with subprotocol ${socket.protocol}.`);
        settle({ ok: true, url, protocol, subprotocol: socket.protocol, details });
      });

      socket.on('message', (data) => this.handleMessage(data));

      socket.on('unexpected-response', (request, response) => {
        failedBeforeOpen = true;

        void readUpgradeResponseBody(response).then((body) => {
          const failure = describeUnexpectedResponse(response, body);
          reportFailure(failure);
          settle({ ok: false, error: failure.reason, failure });
          response.destroy();
          request.destroy();
        });
      });

      socket.on('close', (code, reason) => {
        const reasonText = reason.length > 0 ? ` ${reason.toString('utf8')}` : '';
        if (this.socket === socket) {
          this.rejectAllPending(new OcppClientError(`Socket closed: ${code}${reasonText}`));
          this.socket = undefined;
        }

        if (!failedBeforeOpen && !failureReported && code === 1000) {
          this.setStatus('disconnected', `Socket closed (${code}).`);
        } else if (!failedBeforeOpen && !failureReported) {
          reportFailure(describeCloseFailure(code, reason.toString('utf8')));
        }
        this.log('info', `Socket closed with code ${code}${reasonText}.`);

        if (!settled) {
          const failure = describeCloseFailure(code, reason.toString('utf8'), true);
          reportFailure(failure);
          settle({ ok: false, error: failure.reason, failure });
        }
      });

      socket.on('error', (error) => {
        const failure = describeWebSocketError(error);
        reportFailure(failure);

        if (!settled) {
          failedBeforeOpen = true;
          settle({ ok: false, error: failure.reason, failure });
        }
      });
    });
  }

  async disconnect(emitWhenIdle = true): Promise<void> {
    const socket = this.socket;

    if (!socket) {
      if (emitWhenIdle) {
        this.setStatus('disconnected', 'No active socket.');
      }
      return;
    }

    this.setStatus('disconnecting', 'Closing socket.');
    this.rejectAllPending(new OcppClientError('Socket disconnected before the response arrived.'));

    await new Promise<void>((resolve) => {
      const finish = () => resolve();

      if (socket.readyState === WebSocket.CLOSED) {
        finish();
        return;
      }

      const closeTimer = setTimeout(() => {
        socket.terminate();
        finish();
      }, 1_000);

      socket.once('close', () => {
        clearTimeout(closeTimer);
        finish();
      });

      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'Client disconnect');
      } else {
        finish();
      }
    });

    if (this.socket === socket) {
      this.socket = undefined;
    }

    this.setStatus('disconnected', 'Disconnected.');
  }

  async sendBootNotification(payload: BootNotificationPayload): Promise<BootNotificationResponse> {
    const socket = this.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new OcppClientError('Connect before sending BootNotification.');
    }

    const uniqueId = randomUUID();
    const frame = createBootNotificationCall(uniqueId, payload);
    const raw = stringifyFrame(frame);
    const timeoutMs = this.requestTimeoutMs;

    const responsePromise = new Promise<BootNotificationResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(uniqueId);
        reject(new OcppClientError(`BootNotification timed out after ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);

      this.pendingRequests.set(uniqueId, {
        action: 'BootNotification',
        timer,
        resolve,
        reject
      });
    });

    socket.send(raw, (error) => {
      if (error) {
        const pending = this.pendingRequests.get(uniqueId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(uniqueId);
          pending.reject(error);
        }
        return;
      }

      this.emitSessionEvent({ type: 'frame', at: now(), direction: 'out', raw, summary: summarizeOcppFrame(raw) });
      this.log('info', `BootNotification sent with request ID ${uniqueId}.`);
    });

    return responsePromise;
  }

  async sendOcppCommand(request: OcppCommandRequest): Promise<OcppCommandResponse> {
    const socket = this.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new OcppClientError('Connect before sending an OCPP command.');
    }

    const uniqueId = randomUUID();
    const action = request.action.trim();
    const frame = createOcppCall(uniqueId, action, request.payload);
    const raw = stringifyFrame(frame);
    const timeoutMs = this.requestTimeoutMs;

    const responsePromise = new Promise<OcppCommandResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(uniqueId);
        reject(new OcppClientError(action + ' timed out after ' + timeoutMs / 1000 + ' seconds.'));
      }, timeoutMs);

      this.pendingCommands.set(uniqueId, { action, timer, resolve, reject });
    });

    socket.send(raw, (error) => {
      if (error) {
        const pending = this.pendingCommands.get(uniqueId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(uniqueId);
          pending.reject(error);
        }
        return;
      }

      this.emitSessionEvent({ type: 'frame', at: now(), direction: 'out', raw, summary: summarizeOcppFrame(raw) });
      this.log('info', action + ' sent with request ID ' + uniqueId + '.');
    });

    return responsePromise;
  }

  private handleMessage(data: RawData): void {
    const raw = rawDataToString(data);
    this.emitSessionEvent({ type: 'frame', at: now(), direction: 'in', raw, summary: summarizeOcppFrame(raw) });

    let frame;
    try {
      frame = parseOcppFrame(raw);
    } catch (error) {
      const message = error instanceof OcppMessageError ? error.message : String(error);
      this.log('warn', `Ignoring malformed OCPP frame. ${message}`);
      return;
    }

    if (frame.messageTypeId !== OCPP_CALL_RESULT && frame.messageTypeId !== OCPP_CALL_ERROR) {
      this.log('warn', `Received unsupported inbound CALL action ${frame.action}.`);
      return;
    }

    const pendingCommand = this.pendingCommands.get(frame.uniqueId);
    if (pendingCommand) {
      clearTimeout(pendingCommand.timer);
      this.pendingCommands.delete(frame.uniqueId);

      let response: OcppCommandResponse;
      try {
        response = toOcppCommandResponse(pendingCommand.action, frame);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log('error', pendingCommand.action + ' response was invalid. ' + message);
        pendingCommand.reject(new OcppClientError(message));
        return;
      }

      if (response.type === 'callResult') {
        this.log('success', pendingCommand.action + ' CALLRESULT received.');
      } else {
        this.log('error', pendingCommand.action + ' failed: ' + response.errorCode + ' ' + response.errorDescription);
      }

      pendingCommand.resolve(response);
      return;
    }

    const pending = this.pendingRequests.get(frame.uniqueId);
    if (!pending) {
      this.log('warn', 'Received response for unknown request ID ' + frame.uniqueId + '.');
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(frame.uniqueId);

    let response: BootNotificationResponse;
    try {
      response = toBootNotificationResponse(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('error', 'BootNotification response was invalid. ' + message);
      pending.reject(new OcppClientError(message));
      return;
    }

    this.emitSessionEvent({ type: 'boot-result', at: now(), result: response });

    if (response.type === 'callResult') {
      this.log('success', 'BootNotification result: ' + response.status + '.');
    } else {
      this.log('error', 'BootNotification failed: ' + response.errorCode + ' ' + response.errorDescription);
    }

    pending.resolve(response);
  }

  private rejectAllPending(error: Error): void {
    for (const [uniqueId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(uniqueId);
    }

    for (const [uniqueId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingCommands.delete(uniqueId);
    }
  }

  private setStatus(status: ConnectionState, message: string): void {
    this.emitSessionEvent({ type: 'status', at: now(), status, message });
  }

  private log(level: LogLevel, message: string): void {
    this.emitSessionEvent({ type: 'log', at: now(), level, message });
  }

  private reportConnectionFailure(failure: WebSocketFailure): void {
    const at = now();
    this.emitSessionEvent({ type: 'status', at, status: 'error', message: failure.reason });
    this.emitSessionEvent({ type: 'connection-failure', at, failure });
    this.emitSessionEvent({ type: 'log', at, level: 'error', message: `${failure.title}: ${failure.reason}` });
  }
}

export function normalizeConnectionUrl(protocol: TransportProtocol, address: string): string {
  const trimmed = address.trim();

  if (!trimmed) {
    throw new OcppClientError('Central system address is required.');
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `${protocol}://${trimmed}`;
  const url = new URL(candidate);

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new OcppClientError('Endpoint must use ws:// or wss://.');
  }

  if (!url.hostname) {
    throw new OcppClientError('Endpoint must include a host.');
  }

  return url.toString();
}

function getProtocolFromUrl(url: string): TransportProtocol {
  return new URL(url).protocol === 'wss:' ? 'wss' : 'ws';
}

export function normalizeCustomHeaders(entries: HeaderEntry[]): Record<string, string> {
  const headers: Record<string, string> = {};
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }

    const name = entry.name.trim();
    const value = entry.value.trim();

    if (!name && !value) {
      continue;
    }

    if (!name) {
      throw new OcppClientError('Custom header names cannot be blank.');
    }

    if (!HEADER_TOKEN.test(name)) {
      throw new OcppClientError(`Custom header "${name}" is not a valid HTTP header name.`);
    }

    const lowerName = name.toLowerCase();
    if (RESERVED_HEADERS.has(lowerName)) {
      throw new OcppClientError(`Custom header "${name}" is reserved by the WebSocket handshake.`);
    }

    if (seen.has(lowerName)) {
      throw new OcppClientError(`Custom header "${name}" is duplicated.`);
    }

    seen.add(lowerName);
    headers[name] = value;
  }

  return headers;
}

function normalizeSubprotocol(subprotocol?: string): string {
  const value = subprotocol?.trim() || DEFAULT_SUBPROTOCOL;

  if (!HEADER_TOKEN.test(value)) {
    throw new OcppClientError('WebSocket subprotocol must be a valid token.');
  }

  return value;
}

function normalizeRequestTimeout(timeoutMs?: number): number {
  if (timeoutMs === undefined) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new OcppClientError('Request timeout must be between 1 and 300 seconds.');
  }

  return Math.round(timeoutMs);
}

function normalizeRejectUnauthorized(protocol: TransportProtocol, allowInsecureTls?: boolean): boolean {
  if (!allowInsecureTls) {
    return true;
  }

  if (protocol !== 'wss') {
    throw new OcppClientError('Insecure TLS is only relevant for wss connections.');
  }

  return false;
}

function getTlsMode(
  protocol: TransportProtocol,
  hasCustomCa: boolean,
  rejectUnauthorized: boolean
): WebSocketConnectionDetails['tlsMode'] {
  if (protocol === 'ws') {
    return 'not-applicable';
  }

  if (!rejectUnauthorized) {
    return 'insecure';
  }

  return hasCustomCa ? 'custom-ca' : 'verified';
}

function createConnectionDetails(input: {
  url: string;
  protocol: TransportProtocol;
  subprotocol: string;
  socket: WebSocket;
  response?: IncomingMessage;
  tlsMode: WebSocketConnectionDetails['tlsMode'];
  customHeaderNames: string[];
}): WebSocketConnectionDetails {
  const networkSocket = input.response?.socket;
  const tlsSocket = networkSocket instanceof TLSSocket ? networkSocket : undefined;

  return {
    url: input.url,
    transport: input.protocol,
    requestedSubprotocol: input.subprotocol,
    negotiatedSubprotocol: input.socket.protocol,
    handshakeStatus: input.response?.statusCode ?? 101,
    remoteEndpoint: formatEndpoint(networkSocket?.remoteAddress, networkSocket?.remotePort),
    localEndpoint: formatEndpoint(networkSocket?.localAddress, networkSocket?.localPort),
    extensions: input.socket.extensions || undefined,
    tlsMode: input.tlsMode,
    tlsProtocol: tlsSocket?.getProtocol() ?? undefined,
    cipher: tlsSocket?.getCipher().name,
    customHeaderNames: input.customHeaderNames,
    responseHeaders: normalizeResponseHeaders(input.response)
  };
}

function normalizeResponseHeaders(response?: IncomingMessage): Record<string, string> {
  if (!response) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(response.headers).flatMap(([name, value]) => {
      if (value === undefined) {
        return [];
      }

      return [[name, Array.isArray(value) ? value.join(', ') : value]];
    })
  );
}

function formatEndpoint(address?: string, port?: number): string | undefined {
  if (!address) {
    return undefined;
  }

  const formattedAddress = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
  return port === undefined ? formattedAddress : `${formattedAddress}:${port}`;
}

export function describeWebSocketError(error: Error): WebSocketFailure {
  const code = (error as NodeJS.ErrnoException).code;
  const technicalDetails = code ? `${code}: ${error.message}` : error.message;

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return createFailure('dns', 'DNS lookup failed', 'The WebSocket host name could not be resolved.', technicalDetails);
  }

  if (code === 'ECONNREFUSED') {
    return createFailure('connection-refused', 'Connection refused', 'The server refused the WebSocket connection. Check the host and port.', technicalDetails);
  }

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return createFailure('timeout', 'Network connection timed out', 'The WebSocket server did not respond in time.', technicalDetails);
  }

  if (isTlsError(code, error.message)) {
    return createFailure('tls', 'TLS certificate validation failed', 'The secure WebSocket certificate could not be verified.', technicalDetails);
  }

  if (code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return createFailure('network', 'WebSocket network error', 'The network connection to the WebSocket server was interrupted or is unreachable.', technicalDetails);
  }

  return createFailure('unknown', 'WebSocket connection failed', error.message || 'An unknown WebSocket error occurred.', technicalDetails);
}

function isTlsError(code: string | undefined, message: string): boolean {
  return Boolean(
    code?.startsWith('CERT_') ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      /certificate|self[- ]signed|tls|ssl/i.test(message)
  );
}

function createFailure(
  code: WebSocketFailure['code'],
  title: string,
  reason: string,
  technicalDetails?: string,
  statusCode?: number
): WebSocketFailure {
  return { code, title, reason, technicalDetails, statusCode };
}

function readUpgradeResponseBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    let truncated = false;

    response.setEncoding('utf8');

    response.on('data', (chunk: string) => {
      if (body.length >= MAX_UPGRADE_RESPONSE_BODY_LENGTH) {
        truncated = true;
        return;
      }

      const remaining = MAX_UPGRADE_RESPONSE_BODY_LENGTH - body.length;
      if (chunk.length > remaining) {
        body += chunk.slice(0, remaining);
        truncated = true;
      } else {
        body += chunk;
      }
    });

    response.on('end', () => {
      const trimmed = body.trim();
      resolve(truncated && trimmed ? `${trimmed}\n… response body truncated.` : trimmed);
    });

    response.on('error', () => resolve(''));
  });
}

function describeUnexpectedResponse(response: IncomingMessage, body: string): WebSocketFailure {
  const statusCode = response.statusCode ?? 'unknown';
  const statusMessage = response.statusMessage ? ` ${response.statusMessage}` : '';
  const bodyMessage = body ? ` Response body: ${body}` : '';
  const technicalDetails = `HTTP ${statusCode}${statusMessage}.${bodyMessage}`;

  return createFailure(
    'http-rejected',
    'WebSocket upgrade rejected',
    `The server rejected the WebSocket handshake with HTTP ${statusCode}${statusMessage}.`,
    technicalDetails,
    response.statusCode
  );
}

function describeCloseFailure(code: number, reason: string, beforeOpen = false): WebSocketFailure {
  const closeDescriptions: Record<number, string> = {
    1002: 'The server closed the connection because of a WebSocket protocol error.',
    1003: 'The server rejected the WebSocket message type.',
    1006: 'The WebSocket connection ended abnormally without a close frame.',
    1007: 'The server received invalid WebSocket payload data.',
    1008: 'The server closed the connection because a policy was violated.',
    1009: 'The server closed the connection because a message was too large.',
    1011: 'The server encountered an internal error.',
    1012: 'The WebSocket service is restarting.',
    1013: 'The WebSocket service is temporarily unavailable.'
  };
  const closeReason = reason.trim();
  const defaultReason = beforeOpen
    ? `The socket closed before the WebSocket handshake completed (code ${code}).`
    : `The WebSocket connection closed unexpectedly (code ${code}).`;
  const summary = closeReason || closeDescriptions[code] || defaultReason;

  return createFailure('closed', beforeOpen ? 'WebSocket handshake closed' : 'WebSocket disconnected unexpectedly', summary, `Close code: ${code}${closeReason ? `; reason: ${closeReason}` : ''}`);
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  return Buffer.from(data).toString('utf8');
}

function now(): string {
  return new Date().toISOString();
}
