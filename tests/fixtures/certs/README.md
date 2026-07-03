# Test certificates

These certificates are committed only for local automated tests. `server.crt` is signed by `ca.crt` and includes SAN entries for `localhost` and `127.0.0.1` so the integration test can verify that a selected CA enables a `wss` OCPP connection.

Do not use these keys or certificates outside tests.
