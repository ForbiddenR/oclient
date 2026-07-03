# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm test -- tests/unit/messages.test.ts
npm run build
npm run dist
npm run mock:csms
npm audit --omit=dev
```

Notes:
- `npm run dev` starts Vite for the renderer, watches the Electron main/preload TypeScript build, and launches Electron once both are ready.
- `npm test -- <path>` runs a single Vitest file, for example `npm test -- tests/integration/ocpp-client.test.ts`.
- `npm run build` cleans `dist`, builds main/preload code with `tsc`, and builds the renderer with Vite.
- `npm run dist` packages the Electron app with electron-builder into `release/`.
- There is currently no lint script.

## Architecture overview

This is an Electron + TypeScript desktop OCPP-J client focused on configuring a WebSocket connection and sending an OCPP 1.6J `BootNotification`.

The Electron main process owns all networking and filesystem-sensitive behavior. Keep WebSocket, TLS/CA certificate handling, custom upgrade headers, request correlation, and OCPP parsing in `src/main`, not in the renderer. The renderer should remain UI-only.

Key areas:
- `src/main/index.ts` creates the `BrowserWindow`, wires the preload script, applies Electron security defaults, and loads either the Vite dev server or built renderer files.
- `src/main/ipc.ts` registers the narrow IPC surface for picking a CA certificate, connecting, disconnecting, sending BootNotification, and forwarding session events.
- `src/main/ocpp/client.ts` manages the `ws` socket lifecycle, `ws`/`wss` URL normalization, CA file loading, custom header validation, subprotocol negotiation, request timeouts, and pending BootNotification response correlation.
- `src/main/ocpp/messages.ts` contains OCPP-J frame helpers: BootNotification CALL creation, defensive frame parsing, CALLRESULT validation, and CALLERROR conversion.
- `src/preload/index.ts` exposes `window.oclient` through `contextBridge`; do not expose raw `ipcRenderer`.
- `src/shared/types.ts` defines the shared IPC/domain types used by main, preload, renderer, and tests.
- `src/renderer/app.ts` implements the single-screen UI for transport selection, endpoint/subprotocol fields, CA selection, custom headers, BootNotification fields, session log, and parsed result display.
- `src/renderer/index.html` contains the renderer CSP. If renderer asset loading changes, check this policy during production builds.

## OCPP and transport behavior

The initial protocol scope is OCPP 1.6 JSON over WebSocket using the default subprotocol `ocpp1.6`.

BootNotification frames use:
- CALL: `[2, uniqueId, "BootNotification", payload]`
- CALLRESULT: `[3, uniqueId, { status, currentTime, interval }]`
- CALLERROR: `[4, uniqueId, errorCode, description, details]`

`chargePointVendor` and `chargePointModel` are required. CALLRESULT payloads must contain a valid status (`Accepted`, `Pending`, or `Rejected`), non-empty `currentTime`, and a non-negative integer `interval`.

For connection configuration:
- If the address omits a scheme, the selected `ws`/`wss` protocol is applied.
- If the address includes `ws://` or `wss://`, that scheme is preserved.
- Non-WebSocket URL schemes are rejected.
- CA certificates are read only in the main process and only for `wss` connections.
- Custom headers skip disabled/blank rows, reject invalid header names, reject duplicates case-insensitively, and reject reserved WebSocket handshake headers such as `Host`, `Connection`, `Upgrade`, and `Sec-WebSocket-*`.

## Testing and verification

Tests are split into:
- `tests/unit/messages.test.ts` for OCPP frame construction/parsing and BootNotification response validation.
- `tests/unit/headers.test.ts` for URL normalization and custom header validation.
- `tests/integration/ocpp-client.test.ts` for local `ws`/`wss` server round trips, custom headers, and CA trust behavior.

The `tests/fixtures/certs` directory contains committed test-only certificates for the local `wss` integration test. Do not use those keys outside tests.

Before handing off code changes, run:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## CI and packaging

`.github/workflows/build.yml` validates pushes and pull requests on Node.js 22 with:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Packaging runs on tags matching `v*` and on manual workflow dispatch for Ubuntu, Windows, and macOS using electron-builder. `CSC_IDENTITY_AUTO_DISCOVERY=false` is set so unsigned macOS packaging does not try to discover signing identities automatically.
