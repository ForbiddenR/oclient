import type { OclientApi } from '../shared/types';

declare global {
  interface Window {
    oclient: OclientApi;
  }
}

export {};
