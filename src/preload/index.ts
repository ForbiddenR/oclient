import { clipboard, contextBridge, ipcRenderer } from 'electron';
import type { BootNotificationPayload, ConnectConfig, OclientApi, OcppCommandRequest, SessionEvent } from '../shared/types';
import { IPC_CHANNELS } from '../shared/types';

const api: OclientApi = {
  pickCaCertificate: () => ipcRenderer.invoke(IPC_CHANNELS.pickCaCertificate),
  writeClipboardText: (text: string) => clipboard.writeText(text),
  connect: (config: ConnectConfig) => ipcRenderer.invoke(IPC_CHANNELS.connect, config),
  disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.disconnect),
  sendOcppCommand: (request: OcppCommandRequest) => ipcRenderer.invoke(IPC_CHANNELS.command, request),
  sendBootNotification: (payload: BootNotificationPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.bootNotification, payload),
  onSessionEvent: (listener: (event: SessionEvent) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: SessionEvent) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.sessionEvent, subscription);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sessionEvent, subscription);
    };
  }
};

contextBridge.exposeInMainWorld('oclient', api);
