import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 9000);
const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (socket, request) => {
  console.log(`connected ${request.url ?? '/'} from ${request.socket.remoteAddress ?? 'unknown'}`);
  console.log('headers', request.headers);

  socket.on('message', (message) => {
    const raw = message.toString();
    console.log('in ', raw);

    try {
      const frame = JSON.parse(raw) as [number, string, string, unknown];
      if (Array.isArray(frame) && frame[0] === 2 && frame[2] === 'BootNotification') {
        const response = [
          3,
          frame[1],
          {
            status: 'Accepted',
            currentTime: new Date().toISOString(),
            interval: 300
          }
        ];
        const outbound = JSON.stringify(response);
        socket.send(outbound);
        console.log('out', outbound);
        return;
      }

      const error = JSON.stringify([4, frame[1] ?? 'unknown', 'NotSupported', 'Only BootNotification is implemented.', {}]);
      socket.send(error);
      console.log('out', error);
    } catch (error) {
      const response = JSON.stringify([4, 'unknown', 'FormationViolation', String(error), {}]);
      socket.send(response);
      console.log('out', response);
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock OCPP CSMS listening on ws://127.0.0.1:${port}/CP001`);
});
