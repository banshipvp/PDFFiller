/// <reference types="vite/client" />

type DesktopPdfPayload = {
  path: string;
  name: string;
  bytes: ArrayBuffer | Uint8Array | number[];
};

type DesktopUpdateState = {
  phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error" | "disabled" | "development";
  status: string;
  version: string;
  percent: number;
};

interface Window {
  pdfFillerDesktop?: {
    getInitialPdf: () => Promise<DesktopPdfPayload | null>;
    getAppVersion: () => Promise<string>;
    setDirty: (dirty: boolean) => Promise<boolean>;
    closeAfterSave: () => Promise<void>;
    readPdfFile: (filePath: string) => Promise<DesktopPdfPayload>;
    getStartupEnabled: () => Promise<boolean>;
    setStartupEnabled: (enabled: boolean) => Promise<boolean>;
    openDefaultAppSettings: () => Promise<void>;
    savePdfFile: (payload: { defaultName: string; bytes: number[] }) => Promise<{ canceled: boolean; filePath?: string }>;
    printPdfFile: (payload: { defaultName: string; bytes: number[] }) => Promise<{ ok: boolean; reason?: string }>;
    print: () => Promise<boolean>;
    getUpdateSettings: () => Promise<{ enabled: boolean; provider: "github" | "generic"; githubRepo: string; feedUrl: string; status: string; updateState: DesktopUpdateState }>;
    setUpdateSettings: (settings: Partial<{ enabled: boolean; provider: "github" | "generic"; githubRepo: string; feedUrl: string }>) => Promise<{ enabled: boolean; provider: "github" | "generic"; githubRepo: string; feedUrl: string }>;
    checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
    downloadUpdate: () => Promise<{ ok: boolean; reason?: string }>;
    onUpdaterStatus: (callback: (status: string) => void) => () => void;
    onUpdaterState: (callback: (state: DesktopUpdateState) => void) => () => void;
    onSaveBeforeClose: (callback: () => void) => () => void;
    onPdfOpenedFromSystem: (callback: (filePath: string) => void) => () => void;
  };
}
