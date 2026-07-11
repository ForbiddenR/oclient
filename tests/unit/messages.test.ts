import { describe, expect, it } from 'vitest';
import {
  createBootNotificationCall,
  createOcppCall,
  OCPP_CALL,
  OCPP_CALL_ERROR,
  OCPP_CALL_RESULT,
  OcppMessageError,
  parseOcppFrame,
  summarizeOcppFrame,
  toBootNotificationResponse,
  toOcppCommandResponse
} from '../../src/main/ocpp/messages';

const uniqueId = 'boot-001';

describe('generic OCPP messages', () => {
  it('creates a CALL for any valid OCPP action', () => {
    expect(createOcppCall(uniqueId, 'Heartbeat', {})).toEqual([OCPP_CALL, uniqueId, 'Heartbeat', {}]);
    expect(createOcppCall(uniqueId, 'StatusNotification', { connectorId: 1, status: 'Available' })).toEqual([
      OCPP_CALL,
      uniqueId,
      'StatusNotification',
      { connectorId: 1, status: 'Available' }
    ]);
  });

  it('rejects invalid action names and non-object payloads', () => {
    expect(() => createOcppCall(uniqueId, 'Bad Action', {})).toThrow(OcppMessageError);
    expect(() => createOcppCall(uniqueId, 'Heartbeat', [] as unknown as Record<string, unknown>)).toThrow(OcppMessageError);
  });

  it('parses generic CALLRESULT and CALLERROR responses', () => {
    const result = parseOcppFrame(JSON.stringify([OCPP_CALL_RESULT, uniqueId, { currentTime: '2026-07-11T00:00:00Z' }]));
    const error = parseOcppFrame(JSON.stringify([OCPP_CALL_ERROR, uniqueId, 'NotSupported', 'Unsupported action', {}]));

    expect(toOcppCommandResponse('Heartbeat', result)).toMatchObject({
      type: 'callResult',
      action: 'Heartbeat',
      rawPayload: { currentTime: '2026-07-11T00:00:00Z' }
    });
    expect(toOcppCommandResponse('Heartbeat', error)).toMatchObject({
      type: 'callError',
      action: 'Heartbeat',
      errorCode: 'NotSupported'
    });
  });
});

describe('OCPP BootNotification messages', () => {
  it('creates a trimmed BootNotification CALL frame', () => {
    const frame = createBootNotificationCall(uniqueId, {
      chargePointVendor: '  Acme Charge ',
      chargePointModel: ' Model 7 ',
      firmwareVersion: ' 1.2.3 ',
      iccid: ' '
    });

    expect(frame).toEqual([
      OCPP_CALL,
      uniqueId,
      'BootNotification',
      {
        chargePointVendor: 'Acme Charge',
        chargePointModel: 'Model 7',
        firmwareVersion: '1.2.3'
      }
    ]);
  });

  it('requires vendor and model', () => {
    expect(() =>
      createBootNotificationCall(uniqueId, {
        chargePointVendor: '',
        chargePointModel: 'Model 7'
      })
    ).toThrow(OcppMessageError);

    expect(() =>
      createBootNotificationCall(uniqueId, {
        chargePointVendor: 'Acme',
        chargePointModel: ''
      })
    ).toThrow(OcppMessageError);
  });

  it('parses BootNotification CALLRESULT frames', () => {
    const parsed = parseOcppFrame(
      JSON.stringify([OCPP_CALL_RESULT, uniqueId, { status: 'Accepted', currentTime: '2026-07-03T10:00:00Z', interval: 300 }])
    );

    expect(toBootNotificationResponse(parsed)).toEqual({
      type: 'callResult',
      uniqueId,
      status: 'Accepted',
      currentTime: '2026-07-03T10:00:00Z',
      interval: 300,
      rawPayload: { status: 'Accepted', currentTime: '2026-07-03T10:00:00Z', interval: 300 }
    });
  });

  it('parses BootNotification CALLERROR frames', () => {
    const parsed = parseOcppFrame(
      JSON.stringify([OCPP_CALL_ERROR, uniqueId, 'SecurityError', 'Certificate rejected', { reason: 'expired' }])
    );

    expect(toBootNotificationResponse(parsed)).toEqual({
      type: 'callError',
      uniqueId,
      errorCode: 'SecurityError',
      errorDescription: 'Certificate rejected',
      errorDetails: { reason: 'expired' }
    });
  });

  it('rejects malformed BootNotification CALLRESULT payloads', () => {
    expect(() => toBootNotificationResponse(parseOcppFrame(JSON.stringify([OCPP_CALL_RESULT, uniqueId, {}])))).toThrow(
      OcppMessageError
    );
    expect(() =>
      toBootNotificationResponse(
        parseOcppFrame(JSON.stringify([OCPP_CALL_RESULT, uniqueId, { status: 'Accepted', currentTime: '', interval: 300 }]))
      )
    ).toThrow(OcppMessageError);
    expect(() =>
      toBootNotificationResponse(
        parseOcppFrame(
          JSON.stringify([OCPP_CALL_RESULT, uniqueId, { status: 'Accepted', currentTime: '2026-07-03T10:00:00Z', interval: '300' }])
        )
      )
    ).toThrow(OcppMessageError);
  });

  it('rejects malformed OCPP frames', () => {
    expect(() => parseOcppFrame('{')).toThrow(OcppMessageError);
    expect(() => parseOcppFrame(JSON.stringify({ messageTypeId: 3 }))).toThrow(OcppMessageError);
    expect(() => parseOcppFrame(JSON.stringify([9, uniqueId, {}]))).toThrow(OcppMessageError);
    expect(() => parseOcppFrame(JSON.stringify([OCPP_CALL_RESULT, '', {}]))).toThrow(OcppMessageError);
  });

  it('summarizes OCPP CALL frames for renderer display', () => {
    expect(summarizeOcppFrame(JSON.stringify([OCPP_CALL, uniqueId, 'BootNotification', {}]))).toEqual({
      messageTypeId: OCPP_CALL,
      kind: 'CALL',
      uniqueId,
      action: 'BootNotification',
      displayName: 'BootNotification'
    });
  });

  it('summarizes OCPP CALLRESULT frames for renderer display', () => {
    expect(summarizeOcppFrame(JSON.stringify([OCPP_CALL_RESULT, uniqueId, { status: 'Accepted' }]))).toEqual({
      messageTypeId: OCPP_CALL_RESULT,
      kind: 'CALLRESULT',
      uniqueId,
      displayName: 'CALLRESULT'
    });
  });

  it('summarizes OCPP CALLERROR frames for renderer display', () => {
    expect(summarizeOcppFrame(JSON.stringify([OCPP_CALL_ERROR, uniqueId, 'SecurityError', 'Certificate rejected']))).toEqual({
      messageTypeId: OCPP_CALL_ERROR,
      kind: 'CALLERROR',
      uniqueId,
      errorCode: 'SecurityError',
      displayName: 'SecurityError'
    });
  });

  it('ignores malformed frames when summarizing for renderer display', () => {
    expect(summarizeOcppFrame('{')).toBeUndefined();
  });
});
