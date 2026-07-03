import { contextBridge, ipcRenderer } from 'electron';
import type { BootNotificationPayload, ConnectConfig, OclientApi, SessionEvent } from '../shared/types';
import { IPC_CHANNELS } from '../shared/types';

const api: OclientApi = {
  pickCaCertificate: () => ipcRenderer.invoke(IPC_CHANNELS.pickCaCertificate),
  connect: (config: ConnectConfig) => ipcRenderer.invoke(IPC_CHANNELS.connect, config),
  disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.disconnect),
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
