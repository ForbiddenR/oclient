import { describe, expect, it } from 'vitest';
import {
  describeWebSocketError,
  normalizeConnectionUrl,
  normalizeCustomHeaders,
  OcppClientError
} from '../../src/main/ocpp/client';

describe('connection config normalization', () => {
  it('builds the WebSocket URL from TLS, domain, port, and path', () => {
    expect(normalizeConnectionUrl(false, '127.0.0.1', 9000, 'CP001')).toBe('ws://127.0.0.1:9000/CP001');
    expect(normalizeConnectionUrl(true, 'central.example.com', 8443, '/ocpp/CP001')).toBe(
      'wss://central.example.com:8443/ocpp/CP001'
    );
  });

  it('supports default ports, root paths, and IPv6 domains', () => {
    expect(normalizeConnectionUrl(true, 'central.example.com')).toBe('wss://central.example.com/');
    expect(normalizeConnectionUrl(false, '::1', 9000, '/CP001')).toBe('ws://[::1]:9000/CP001');
  });

  it('rejects endpoint parts that overlap or are invalid', () => {
    expect(() => normalizeConnectionUrl(false, 'ws://central.example.com', 9000, '/CP001')).toThrow(OcppClientError);
    expect(() => normalizeConnectionUrl(false, 'central.example.com:9000', 9000, '/CP001')).toThrow(OcppClientError);
    expect(() => normalizeConnectionUrl(false, 'central.example.com', 70000, '/CP001')).toThrow(OcppClientError);
    expect(() => normalizeConnectionUrl(false, 'central.example.com', 9000, '/CP001#debug')).toThrow(OcppClientError);
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

describe('WebSocket error descriptions', () => {
  it('classifies a refused connection', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    expect(describeWebSocketError(error)).toMatchObject({
      code: 'connection-refused',
      title: 'Connection refused'
    });
  });

  it('classifies DNS and TLS validation failures', () => {
    const dnsError = Object.assign(new Error('getaddrinfo ENOTFOUND central.invalid'), { code: 'ENOTFOUND' });
    const tlsError = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });

    expect(describeWebSocketError(dnsError)).toMatchObject({ code: 'dns', title: 'DNS lookup failed' });
    expect(describeWebSocketError(tlsError)).toMatchObject({ code: 'tls', title: 'TLS certificate validation failed' });
  });
});
