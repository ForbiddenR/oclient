import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { RawData } from 'ws';
import WebSocket from 'ws';
import type {
  BootNotificationPayload,
  BootNotificationResponse,
  ConnectConfig,
  ConnectResult,
  ConnectionState,
  HeaderEntry,
  SessionEvent,
  TransportProtocol
} from '../../shared/types';
import {
  createBootNotificationCall,
  OCPP_CALL_ERROR,
  OCPP_CALL_RESULT,
  OcppMessageError,
  parseOcppFrame,
  stringifyFrame,
  toBootNotificationResponse
} from './messages';

const DEFAULT_SUBPROTOCOL = 'ocpp1.6';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

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

  constructor(private readonly emitSessionEvent: (event: SessionEvent) => void = () => undefined) {}

  async connect(config: ConnectConfig): Promise<ConnectResult> {
    let url: string;
    let protocol: TransportProtocol;
    let headers: Record<string, string>;
    let ca: Buffer | undefined;
    let subprotocol: string;

    try {
      subprotocol = normalizeSubprotocol(config.subprotocol);
      this.requestTimeoutMs = normalizeRequestTimeout(config.requestTimeoutMs);
      url = normalizeConnectionUrl(config.protocol, config.address);
      protocol = getProtocolFromUrl(url);
      headers = normalizeCustomHeaders(config.headers ?? []);

      if (protocol === 'wss' && config.caCertificatePath) {
        ca = await readFile(config.caCertificatePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', message);
      this.log('error', message);
      return { ok: false, error: message };
    }

    await this.disconnect(false);

    this.setStatus('connecting', `Opening ${url}`);
    this.log('info', `Connecting with ${subprotocol} over ${protocol.toUpperCase()}.`);

    const socket = new WebSocket(url, subprotocol, {
      ca,
      headers,
      rejectUnauthorized: true
    });

    this.socket = socket;

    return new Promise<ConnectResult>((resolve) => {
      let settled = false;
      let failedBeforeOpen = false;
      const settle = (result: ConnectResult) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(connectTimer);
        resolve(result);
      };

      const connectTimer = setTimeout(() => {
        failedBeforeOpen = true;
        this.log('error', `Connection timed out after ${DEFAULT_CONNECT_TIMEOUT_MS / 1000} seconds.`);
        this.setStatus('error', 'Connection timed out.');
        socket.terminate();
        settle({ ok: false, error: 'Connection timed out.' });
      }, DEFAULT_CONNECT_TIMEOUT_MS);

      socket.on('open', () => {
        if (socket.protocol !== subprotocol) {
          failedBeforeOpen = true;
          const message = `Server did not negotiate required subprotocol ${subprotocol}.`;
          this.setStatus('error', message);
          this.log('error', message);
          socket.close(1002, message);
          settle({ ok: false, error: message });
          return;
        }

        this.setStatus('connected', `Connected to ${url}`);
        this.log('success', `Socket open with subprotocol ${socket.protocol}.`);
        settle({ ok: true, url, protocol, subprotocol: socket.protocol });
      });

      socket.on('message', (data) => this.handleMessage(data));

      socket.on('close', (code, reason) => {
        const reasonText = reason.length > 0 ? ` ${reason.toString('utf8')}` : '';
        this.rejectAllPending(new OcppClientError(`Socket closed: ${code}${reasonText}`));
        this.socket = undefined;
        if (!failedBeforeOpen) {
          this.setStatus('disconnected', `Socket closed (${code}).`);
        }
        this.log('info', `Socket closed with code ${code}${reasonText}.`);

        if (!settled) {
          settle({ ok: false, error: `Socket closed before opening (${code}).` });
        }
      });

      socket.on('error', (error) => {
        this.log('error', error.message);

        if (!settled) {
          failedBeforeOpen = true;
          this.setStatus('error', error.message);
          settle({ ok: false, error: error.message });
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

      this.emitSessionEvent({ type: 'frame', at: now(), direction: 'out', raw });
      this.log('info', `BootNotification sent with request ID ${uniqueId}.`);
    });

    return responsePromise;
  }

  private handleMessage(data: RawData): void {
    const raw = rawDataToString(data);
    this.emitSessionEvent({ type: 'frame', at: now(), direction: 'in', raw });

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

    const pending = this.pendingRequests.get(frame.uniqueId);
    if (!pending) {
      this.log('warn', `Received response for unknown request ID ${frame.uniqueId}.`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(frame.uniqueId);

    let response: BootNotificationResponse;
    try {
      response = toBootNotificationResponse(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('error', `BootNotification response was invalid. ${message}`);
      pending.reject(new OcppClientError(message));
      return;
    }

    this.emitSessionEvent({ type: 'boot-result', at: now(), result: response });

    if (response.type === 'callResult') {
      this.log('success', `BootNotification result: ${response.status}.`);
    } else {
      this.log('error', `BootNotification failed: ${response.errorCode} ${response.errorDescription}`);
    }

    pending.resolve(response);
  }

  private rejectAllPending(error: Error): void {
    for (const [uniqueId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(uniqueId);
    }
  }

  private setStatus(status: ConnectionState, message: string): void {
    this.emitSessionEvent({ type: 'status', at: now(), status, message });
  }

  private log(level: LogLevel, message: string): void {
    this.emitSessionEvent({ type: 'log', at: now(), level, message });
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
