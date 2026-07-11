export type TransportProtocol = 'ws' | 'wss';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error';

export interface HeaderEntry {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
}

export interface ConnectConfig {
  tls: boolean;
  domain: string;
  port?: number;
  path?: string;
  caCertificatePath?: string;
  headers: HeaderEntry[];
  subprotocol?: string;
  requestTimeoutMs?: number;
  pingIntervalSeconds?: number;
  allowInsecureTls?: boolean;
}

export interface ConnectResult {
  ok: boolean;
  url?: string;
  protocol?: TransportProtocol;
  subprotocol?: string;
  details?: WebSocketConnectionDetails;
  failure?: WebSocketFailure;
  error?: string;
}

export type WebSocketFailureCode =
  | 'configuration'
  | 'timeout'
  | 'http-rejected'
  | 'tls'
  | 'dns'
  | 'connection-refused'
  | 'network'
  | 'subprotocol'
  | 'closed'
  | 'unknown';

export interface WebSocketFailure {
  code: WebSocketFailureCode;
  title: string;
  reason: string;
  technicalDetails?: string;
  statusCode?: number;
}

export interface WebSocketConnectionDetails {
  url: string;
  transport: TransportProtocol;
  requestedSubprotocol: string;
  negotiatedSubprotocol: string;
  handshakeStatus: number;
  remoteEndpoint?: string;
  localEndpoint?: string;
  extensions?: string;
  tlsMode: 'not-applicable' | 'verified' | 'custom-ca' | 'insecure';
  tlsProtocol?: string;
  cipher?: string;
  customHeaderNames: string[];
  responseHeaders: Record<string, string>;
  pingIntervalSeconds: number;
}

export interface PickCertificateResult {
  canceled: boolean;
  filePath?: string;
}

export interface OcppCommandRequest {
  action: string;
  payload: Record<string, unknown>;
}

export interface OcppCommandCallResult {
  type: 'callResult';
  uniqueId: string;
  action: string;
  rawPayload: unknown;
}

export interface OcppCommandCallError {
  type: 'callError';
  uniqueId: string;
  action: string;
  errorCode: string;
  errorDescription: string;
  errorDetails: unknown;
}

export type OcppCommandResponse = OcppCommandCallResult | OcppCommandCallError;

export interface BootNotificationPayload {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber?: string;
  chargeBoxSerialNumber?: string;
  firmwareVersion?: string;
  iccid?: string;
  imsi?: string;
  meterSerialNumber?: string;
  meterType?: string;
}

export interface BootNotificationCallResult {
  type: 'callResult';
  uniqueId: string;
  status?: 'Accepted' | 'Pending' | 'Rejected' | string;
  currentTime?: string;
  interval?: number;
  rawPayload: unknown;
}

export interface BootNotificationCallError {
  type: 'callError';
  uniqueId: string;
  errorCode: string;
  errorDescription: string;
  errorDetails: unknown;
}

export type BootNotificationResponse = BootNotificationCallResult | BootNotificationCallError;

export interface OcppFrameSummary {
  messageTypeId: 2 | 3 | 4;
  kind: 'CALL' | 'CALLRESULT' | 'CALLERROR';
  uniqueId: string;
  action?: string;
  errorCode?: string;
  displayName: string;
}

export type WebSocketPingStatus = 'sent' | 'success' | 'timeout' | 'error';

export type SessionEvent =
  | {
      type: 'status';
      at: string;
      status: ConnectionState;
      message: string;
    }
  | {
      type: 'log';
      at: string;
      level: 'info' | 'warn' | 'error' | 'success';
      message: string;
    }
  | {
      type: 'frame';
      at: string;
      direction: 'in' | 'out';
      raw: string;
      summary?: OcppFrameSummary;
    }
  | {
      type: 'boot-result';
      at: string;
      result: BootNotificationResponse;
    }
  | {
      type: 'ping';
      at: string;
      status: WebSocketPingStatus;
      intervalSeconds: number;
      latencyMs?: number;
      message: string;
    }
  | {
      type: 'connection-failure';
      at: string;
      failure: WebSocketFailure;
    };

export interface OclientApi {
  pickCaCertificate(): Promise<PickCertificateResult>;
  writeClipboardText(text: string): void;
  setWindowTheme(theme: AppTheme): Promise<void>;
  connect(config: ConnectConfig): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  sendBootNotification(payload: BootNotificationPayload): Promise<BootNotificationResponse>;
  sendOcppCommand(request: OcppCommandRequest): Promise<OcppCommandResponse>;
  onSessionEvent(listener: (event: SessionEvent) => void): () => void;
}

export type AppTheme = 'light' | 'dark';

export const IPC_CHANNELS = {
  windowTheme: 'window:theme',
  pickCaCertificate: 'dialog:pick-ca-certificate',
  connect: 'ocpp:connect',
  disconnect: 'ocpp:disconnect',
  bootNotification: 'ocpp:boot-notification',
  command: 'ocpp:command',
  sessionEvent: 'ocpp:session-event'
} as const;
