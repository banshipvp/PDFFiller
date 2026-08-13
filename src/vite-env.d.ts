/// <reference types="vite/client" />

type DesktopPdfPayload = {
  path: string;
  name: string;
  bytes: ArrayBuffer | Uint8Array | number[];
};

interface Window {
  pdfFillerDesktop?: {
    getInitialPdf: () => Promise<DesktopPdfPayload | null>;
    getAppVersion: () => Promise<string>;
    readPdfFile: (filePath: string) => Promise<DesktopPdfPayload>;
    getStartupEnabled: () => Promise<boolean>;
    setStartupEnabled: (enabled: boolean) => Promise<boolean>;
    openDefaultAppSettings: () => Promise<void>;
    savePdfFile: (payload: { defaultName: string; bytes: number[] }) => Promise<{ canceled: boolean; filePath?: string }>;
    print: () => Promise<boolean>;
    getUpdateSettings: () => Promise<{ enabled: boolean; provider: "github" | "generic"; githubRepo: string; feedUrl: string; status: string }>;
    setUpdateSettings: (settings: Partial<{ enabled: boolean; provider: "github" | "generic"; githubRepo: string; feedUrl: string }>) => Promise<{ enabled: boolean; provider: "github" | "generic"; githubRepo: string; feedUrl: string }>;
    checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
    onUpdaterStatus: (callback: (status: string) => void) => () => void;
    onPdfOpenedFromSystem: (callback: (filePath: string) => void) => () => void;
  };
}
