import { describe, expect, it } from 'vitest';
import { normalizeConnectionUrl, normalizeCustomHeaders, OcppClientError } from '../../src/main/ocpp/client';

describe('connection config normalization', () => {
  it('applies the selected protocol when the address omits a scheme', () => {
    expect(normalizeConnectionUrl('ws', '127.0.0.1:9000/CP001')).toBe('ws://127.0.0.1:9000/CP001');
    expect(normalizeConnectionUrl('wss', 'central.example.com/CP001')).toBe('wss://central.example.com/CP001');
  });

  it('preserves a full endpoint URL scheme even if the selected protocol differs', () => {
    expect(normalizeConnectionUrl('wss', 'ws://central.example.com/CP001')).toBe('ws://central.example.com/CP001');
    expect(normalizeConnectionUrl('ws', 'wss://central.example.com/CP001')).toBe('wss://central.example.com/CP001');
  });

  it('rejects non-websocket endpoints', () => {
    expect(() => normalizeConnectionUrl('ws', 'https://central.example.com')).toThrow(OcppClientError);
  });
});

describe('custom header normalization', () => {
  it('keeps enabled custom headers and skips blank rows', () => {
    expect(
      normalizeCustomHeaders([
        { id: '1', enabled: true, name: ' X-Station-Token ', value: ' secret ' },
        { id: '2', enabled: false, name: 'X-Off', value: 'ignored' },
        { id: '3', enabled: true, name: '', value: '' }
      ])
    ).toEqual({ 'X-Station-Token': 'secret' });
  });

  it('rejects reserved WebSocket handshake headers', () => {
    expect(() =>
      normalizeCustomHeaders([{ id: '1', enabled: true, name: 'Sec-WebSocket-Protocol', value: 'ocpp1.6' }])
    ).toThrow(OcppClientError);

    expect(() => normalizeCustomHeaders([{ id: '1', enabled: true, name: 'Host', value: 'example.com' }])).toThrow(
      OcppClientError
    );
  });

  it('rejects duplicate or invalid header names', () => {
    expect(() =>
      normalizeCustomHeaders([
        { id: '1', enabled: true, name: 'X-Test', value: 'a' },
        { id: '2', enabled: true, name: 'x-test', value: 'b' }
      ])
    ).toThrow(OcppClientError);

    expect(() => normalizeCustomHeaders([{ id: '1', enabled: true, name: 'Bad Header', value: 'x' }])).toThrow(
      OcppClientError
    );
  });
});
