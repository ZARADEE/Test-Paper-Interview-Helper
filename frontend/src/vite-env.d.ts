/// <reference types="vite/client" />

declare global {
  interface Window {
    paperHelper?: {
      platform: string;
    };
  }
}

export {};

