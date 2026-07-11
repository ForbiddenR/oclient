import { BrowserWindow, dialog, ipcMain } from 'electron';
import type {
  BootNotificationPayload,
  ConnectConfig,
  OcppCommandRequest,
  PickCertificateResult,
  SessionEvent
} from '../shared/types';
import { IPC_CHANNELS } from '../shared/types';
import { OcppClient } from './ocpp/client';

export function registerIpc(mainWindow: BrowserWindow): OcppClient {
  const emitSessionEvent = (event: SessionEvent) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.sessionEvent, event);
    }
  };

  const client = new OcppClient(emitSessionEvent);

  ipcMain.handle(IPC_CHANNELS.pickCaCertificate, async (event): Promise<PickCertificateResult> => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const result = await dialog.showOpenDialog(parent, {
      title: 'Choose CA certificate',
      properties: ['openFile'],
      filters: [
        { name: 'Certificate files', extensions: ['pem', 'crt', 'cer'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle(IPC_CHANNELS.connect, async (_event, config: ConnectConfig) => client.connect(config));
  ipcMain.handle(IPC_CHANNELS.disconnect, async () => client.disconnect());
  ipcMain.handle(IPC_CHANNELS.command, async (_event, request: OcppCommandRequest) =>
    client.sendOcppCommand(request)
  );
  ipcMain.handle(IPC_CHANNELS.bootNotification, async (_event, payload: BootNotificationPayload) =>
    client.sendBootNotification(payload)
  );

  mainWindow.on('closed', () => {
    ipcMain.removeHandler(IPC_CHANNELS.pickCaCertificate);
    ipcMain.removeHandler(IPC_CHANNELS.connect);
    ipcMain.removeHandler(IPC_CHANNELS.disconnect);
    ipcMain.removeHandler(IPC_CHANNELS.command);
    ipcMain.removeHandler(IPC_CHANNELS.bootNotification);
    void client.disconnect(false);
  });

  return client;
}
