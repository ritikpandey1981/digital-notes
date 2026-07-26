export {};

declare global {
  interface Window {
    folio: {
      platform: NodeJS.Platform;
      runtime: {
        chromium: string;
        electron: string;
        node: string;
      };
    };
  }
}
