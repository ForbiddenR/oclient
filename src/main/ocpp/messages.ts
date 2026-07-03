import type {
  BootNotificationCallError,
  BootNotificationCallResult,
  BootNotificationPayload,
  BootNotificationResponse
} from '../../shared/types';

export const OCPP_CALL = 2;
export const OCPP_CALL_RESULT = 3;
export const OCPP_CALL_ERROR = 4;

export type OcppCallFrame<TPayload extends Record<string, unknown> = Record<string, unknown>> = [
  typeof OCPP_CALL,
  string,
  string,
  TPayload
];

export type OcppCallResultFrame = [typeof OCPP_CALL_RESULT, string, unknown];
export type OcppCallErrorFrame = [typeof OCPP_CALL_ERROR, string, string, string, unknown?];

export type ParsedOcppFrame =
  | {
      messageTypeId: typeof OCPP_CALL;
      uniqueId: string;
      action: string;
      payload: unknown;
    }
  | {
      messageTypeId: typeof OCPP_CALL_RESULT;
      uniqueId: string;
      payload: unknown;
    }
  | {
      messageTypeId: typeof OCPP_CALL_ERROR;
      uniqueId: string;
      errorCode: string;
      errorDescription: string;
      errorDetails: unknown;
    };

export class OcppMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcppMessageError';
  }
}

export function createBootNotificationCall(
  uniqueId: string,
  payload: BootNotificationPayload
): OcppCallFrame<Record<string, string>> {
  const cleanedPayload = cleanBootNotificationPayload(payload);

  if (!cleanedPayload.chargePointVendor) {
    throw new OcppMessageError('Charge point vendor is required.');
  }

  if (!cleanedPayload.chargePointModel) {
    throw new OcppMessageError('Charge point model is required.');
  }

  return [OCPP_CALL, uniqueId, 'BootNotification', cleanedPayload];
}

export function cleanBootNotificationPayload(
  payload: BootNotificationPayload
): Record<string, string> {
  const cleanedEntries = Object.entries(payload)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : ''] as const)
    .filter(([, value]) => value.length > 0);

  return Object.fromEntries(cleanedEntries);
}

export function parseOcppFrame(raw: string): ParsedOcppFrame {
  let frame: unknown;

  try {
    frame = JSON.parse(raw);
  } catch (error) {
    throw new OcppMessageError(`Frame is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(frame)) {
    throw new OcppMessageError('OCPP-J frame must be a JSON array.');
  }

  const [messageTypeId, uniqueId] = frame;

  if (messageTypeId !== OCPP_CALL && messageTypeId !== OCPP_CALL_RESULT && messageTypeId !== OCPP_CALL_ERROR) {
    throw new OcppMessageError(`Unsupported OCPP message type: ${String(messageTypeId)}.`);
  }

  if (typeof uniqueId !== 'string' || uniqueId.length === 0) {
    throw new OcppMessageError('OCPP frame unique ID must be a non-empty string.');
  }

  if (messageTypeId === OCPP_CALL) {
    if (frame.length !== 4) {
      throw new OcppMessageError('OCPP CALL frame must have four elements.');
    }

    const [, , action, payload] = frame;
    if (typeof action !== 'string' || action.length === 0) {
      throw new OcppMessageError('OCPP CALL action must be a non-empty string.');
    }

    return { messageTypeId, uniqueId, action, payload };
  }

  if (messageTypeId === OCPP_CALL_RESULT) {
    if (frame.length !== 3) {
      throw new OcppMessageError('OCPP CALLRESULT frame must have three elements.');
    }

    return { messageTypeId, uniqueId, payload: frame[2] };
  }

  if (frame.length < 4 || frame.length > 5) {
    throw new OcppMessageError('OCPP CALLERROR frame must have four or five elements.');
  }

  const [, , errorCode, errorDescription, errorDetails] = frame;
  if (typeof errorCode !== 'string' || errorCode.length === 0) {
    throw new OcppMessageError('OCPP CALLERROR errorCode must be a non-empty string.');
  }

  if (typeof errorDescription !== 'string') {
    throw new OcppMessageError('OCPP CALLERROR errorDescription must be a string.');
  }

  return {
    messageTypeId,
    uniqueId,
    errorCode,
    errorDescription,
    errorDetails: errorDetails ?? {}
  };
}

export function toBootNotificationResponse(frame: ParsedOcppFrame): BootNotificationResponse {
  if (frame.messageTypeId === OCPP_CALL_RESULT) {
    if (!isRecord(frame.payload)) {
      throw new OcppMessageError('BootNotification CALLRESULT payload must be an object.');
    }

    const payload = frame.payload;
    if (payload.status !== 'Accepted' && payload.status !== 'Pending' && payload.status !== 'Rejected') {
      throw new OcppMessageError('BootNotification CALLRESULT status must be Accepted, Pending, or Rejected.');
    }

    if (typeof payload.currentTime !== 'string' || payload.currentTime.length === 0) {
      throw new OcppMessageError('BootNotification CALLRESULT currentTime must be a non-empty string.');
    }

    if (typeof payload.interval !== 'number' || !Number.isInteger(payload.interval) || payload.interval < 0) {
      throw new OcppMessageError('BootNotification CALLRESULT interval must be a non-negative integer.');
    }

    const result: BootNotificationCallResult = {
      type: 'callResult',
      uniqueId: frame.uniqueId,
      status: payload.status,
      currentTime: payload.currentTime,
      interval: payload.interval,
      rawPayload: frame.payload
    };

    return result;
  }

  if (frame.messageTypeId === OCPP_CALL_ERROR) {
    const result: BootNotificationCallError = {
      type: 'callError',
      uniqueId: frame.uniqueId,
      errorCode: frame.errorCode,
      errorDescription: frame.errorDescription,
      errorDetails: frame.errorDetails
    };

    return result;
  }

  throw new OcppMessageError('Expected a BootNotification response frame, received an OCPP CALL frame.');
}

export function stringifyFrame(frame: unknown): string {
  return JSON.stringify(frame);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
