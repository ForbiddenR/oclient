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
  protocol: TransportProtocol;
  address: string;
  caCertificatePath?: string;
  headers: HeaderEntry[];
  subprotocol?: string;
  requestTimeoutMs?: number;
}

export interface ConnectResult {
  ok: boolean;
  url?: string;
  protocol?: TransportProtocol;
  subprotocol?: string;
  error?: string;
}

export interface PickCertificateResult {
  canceled: boolean;
  filePath?: string;
}

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
    }
  | {
      type: 'boot-result';
      at: string;
      result: BootNotificationResponse;
    };

export interface OclientApi {
  pickCaCertificate(): Promise<PickCertificateResult>;
  connect(config: ConnectConfig): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  sendBootNotification(payload: BootNotificationPayload): Promise<BootNotificationResponse>;
  onSessionEvent(listener: (event: SessionEvent) => void): () => void;
}

export const IPC_CHANNELS = {
  pickCaCertificate: 'dialog:pick-ca-certificate',
  connect: 'ocpp:connect',
  disconnect: 'ocpp:disconnect',
  bootNotification: 'ocpp:boot-notification',
  sessionEvent: 'ocpp:session-event'
} as const;
