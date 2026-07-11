import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { OcppClient } from '../../src/main/ocpp/client';

const certDir = resolve(process.cwd(), 'tests/fixtures/certs');
const servers: Array<{ close: () => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.close();
          resolveClose();
        })
    )
  );
});

describe('OcppClient integration', () => {
  it('connects over ws, sends headers, and receives BootNotification CALLRESULT', async () => {
    let requestHeaders: IncomingMessage['headers'] | undefined;
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await once(server, 'listening');

    server.on('connection', (socket, request) => {
      requestHeaders = request.headers;
      socket.on('message', (message) => {
        const frame = JSON.parse(message.toString()) as [2, string, string, Record<string, unknown>];
        const payload =
          frame[2] === 'Heartbeat'
            ? { currentTime: '2026-07-03T10:00:00Z' }
            : { status: 'Accepted', currentTime: '2026-07-03T10:00:00Z', interval: 300 };
        socket.send(JSON.stringify([3, frame[1], payload]));
      });
    });

    const address = server.address() as AddressInfo;
    const events: string[] = [];
    const client = new OcppClient((event) => {
      if (event.type === 'frame') {
        events.push(event.raw);
      }
    });

    const result = await client.connect({
      tls: false,
      domain: '127.0.0.1',
      port: address.port,
      path: '/CP001',
      headers: [{ id: 'token', enabled: true, name: 'X-Station-Token', value: 'secret' }]
    });

    expect(result.ok).toBe(true);
    expect(result.details).toMatchObject({
      transport: 'ws',
      requestedSubprotocol: 'ocpp1.6',
      negotiatedSubprotocol: 'ocpp1.6',
      handshakeStatus: 101,
      tlsMode: 'not-applicable',
      customHeaderNames: ['X-Station-Token']
    });
    expect(result.details?.remoteEndpoint).toContain(`:${address.port}`);
    expect(result.details?.responseHeaders.upgrade).toBe('websocket');

    const response = await client.sendBootNotification({
      chargePointVendor: 'Acme',
      chargePointModel: 'Model 7'
    });

    expect(response).toMatchObject({
      type: 'callResult',
      status: 'Accepted',
      interval: 300
    });
    const heartbeat = await client.sendOcppCommand({ action: 'Heartbeat', payload: {} });
    expect(heartbeat).toMatchObject({
      type: 'callResult',
      action: 'Heartbeat',
      rawPayload: { currentTime: '2026-07-03T10:00:00Z' }
    });

    expect(requestHeaders?.['x-station-token']).toBe('secret');
    expect(events.some((raw) => raw.includes('BootNotification'))).toBe(true);
    expect(events.some((raw) => raw.includes('Heartbeat'))).toBe(true);

    await client.disconnect();
  });

  it('reports HTTP status and body when the WebSocket upgrade is rejected', async () => {
    const responseBody = JSON.stringify({ error: 'invalid token' });
    const server = createHttpServer();
    servers.push(server);

    server.on('upgrade', (_request, socket) => {
      socket.end(
        [
          'HTTP/1.1 401 Unauthorized',
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(responseBody)}`,
          'Connection: close',
          '',
          responseBody
        ].join('\r\n')
      );
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const events: string[] = [];
    const failureDetails: string[] = [];
    const client = new OcppClient((event) => {
      if (event.type === 'log') {
        events.push(event.message);
      }
      if (event.type === 'connection-failure' && event.failure.technicalDetails) {
        failureDetails.push(event.failure.technicalDetails);
      }
    });

    const result = await client.connect({
      tls: false,
      domain: '127.0.0.1',
      port: address.port,
      path: '/CP001',
      headers: []
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 401 Unauthorized');
    expect(result.failure).toMatchObject({ code: 'http-rejected', statusCode: 401 });
    expect(result.failure?.technicalDetails).toContain(responseBody);
    expect(events.some((message) => message.includes('WebSocket upgrade rejected'))).toBe(true);
    expect(failureDetails.some((message) => message.includes(responseBody))).toBe(true);

    await client.disconnect();
  });

  it('connects over wss when the selected CA is supplied', async () => {
    const httpsServer = createHttpsServer({
      cert: readFileSync(resolve(certDir, 'server.crt')),
      key: readFileSync(resolve(certDir, 'server.key'))
    });
    const server = new WebSocketServer({ server: httpsServer });
    servers.push(server, httpsServer);

    server.on('connection', (socket) => {
      socket.on('message', (message) => {
        const frame = JSON.parse(message.toString()) as [2, string, string, Record<string, unknown>];
        socket.send(JSON.stringify([3, frame[1], { status: 'Accepted', currentTime: '2026-07-03T10:00:00Z', interval: 120 }]));
      });
    });

    httpsServer.listen(0, '127.0.0.1');
    await once(httpsServer, 'listening');
    const address = httpsServer.address() as AddressInfo;

    const failingClient = new OcppClient();
    const failingResult = await failingClient.connect({
      tls: true,
      domain: '127.0.0.1',
      port: address.port,
      path: '/CP001',
      headers: []
    });
    expect(failingResult.ok).toBe(false);
    await failingClient.disconnect();

    const trustedClient = new OcppClient();
    const trustedResult = await trustedClient.connect({
      tls: true,
      domain: '127.0.0.1',
      port: address.port,
      path: '/CP001',
      caCertificatePath: resolve(certDir, 'ca.crt'),
      headers: []
    });
    expect(trustedResult.details).toMatchObject({
      transport: 'wss',
      tlsMode: 'custom-ca',
      handshakeStatus: 101
    });
    expect(trustedResult.details?.tlsProtocol).toMatch(/^TLS/);
    expect(trustedResult.details?.cipher).toBeTruthy();

    expect(trustedResult.ok).toBe(true);

    const response = await trustedClient.sendBootNotification({
      chargePointVendor: 'Acme',
      chargePointModel: 'Model 7'
    });

    expect(response).toMatchObject({
      type: 'callResult',
      status: 'Accepted',
      interval: 120
    });

    await trustedClient.disconnect();
  });

  it('connects over wss with an untrusted certificate when insecure TLS is allowed', async () => {
    const httpsServer = createHttpsServer({
      cert: readFileSync(resolve(certDir, 'server.crt')),
      key: readFileSync(resolve(certDir, 'server.key'))
    });
    const server = new WebSocketServer({ server: httpsServer });
    servers.push(server, httpsServer);

    server.on('connection', (socket) => {
      socket.on('message', (message) => {
        const frame = JSON.parse(message.toString()) as [2, string, string, Record<string, unknown>];
        socket.send(JSON.stringify([3, frame[1], { status: 'Accepted', currentTime: '2026-07-03T10:00:00Z', interval: 90 }]));
      });
    });

    httpsServer.listen(0, '127.0.0.1');
    await once(httpsServer, 'listening');
    const address = httpsServer.address() as AddressInfo;

    const client = new OcppClient();
    const result = await client.connect({
      tls: true,
      domain: '127.0.0.1',
      port: address.port,
      path: '/CP001',
      headers: [],
      allowInsecureTls: true
    });
    expect(result.details).toMatchObject({
      transport: 'wss',
      tlsMode: 'insecure',
      handshakeStatus: 101
    });

    expect(result.ok).toBe(true);

    const response = await client.sendBootNotification({
      chargePointVendor: 'Acme',
      chargePointModel: 'Model 7'
    });

    expect(response).toMatchObject({
      type: 'callResult',
      status: 'Accepted',
      interval: 90
    });

    await client.disconnect();
  });
});
