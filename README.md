# oclient

`oclient` is an Electron desktop OCPP-J client for testing the first handshake step of an OCPP 1.6 JSON charging station session. The initial release focuses on configuring a WebSocket connection and sending `BootNotification`.

## Features

- Choose `ws` or `wss` transport.
- Select a CA certificate file for `wss` connections.
- Add custom WebSocket upgrade headers.
- Connect with the `ocpp1.6` subprotocol.
- Send an OCPP 1.6J `BootNotification` request.
- Inspect outbound and inbound raw OCPP frames plus the parsed response.

## Development

```bash
npm install
npm run dev
```

The app starts Vite for the renderer, compiles the Electron main/preload code, and launches Electron once both are ready.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

To run a local mock central system for manual smoke tests:

```bash
npm run mock:csms
```

Then connect to `ws://127.0.0.1:9000/CP001` from the desktop app and send a BootNotification.

## Packaging

```bash
npm run dist
```

Packaged artifacts are written to `release/`. GitHub Actions validates every push and pull request, and packages Linux, Windows, and macOS artifacts for tags or manual workflow runs.
