import {
  ArrowRight,
  BookOpen,
  Check,
  CheckSquare,
  Circle,
  Columns3,
  Download,
  Eraser,
  FileImage,
  FilePlus2,
  FileText,
  Highlighter,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Printer,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Redo2,
  Save,
  Scissors,
  Settings,
  Square,
  Stamp,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PDFCheckBox, PDFDocument, PDFTextField, degrees, rgb, StandardFonts } from "pdf-lib";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, OPS, Util, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

type Tool =
  | "select"
  | "text"
  | "editText"
  | "field"
  | "signature"
  | "initials"
  | "draw"
  | "eraser"
  | "whiteout"
  | "highlight"
  | "checkbox"
  | "checkmark"
  | "radio"
  | "date"
  | "image"
  | "comment"
  | "note"
  | "line"
  | "arrow"
  | "circle"
  | "rectangle"
  | "table"
  | "watermark"
  | "pageNumber";

type PageSize = { width: number; height: number };
type Point = { x: number; y: number };
type BaseAnnotation = { id: string; page: number; x: number; y: number; w: number; h: number };

type TextAnnotation = BaseAnnotation & {
  type: "text" | "date" | "comment" | "note" | "watermark" | "pageNumber" | "detectedText";
  text: string;
  color: string;
  fontSize: number;
  bold: boolean;
  background?: string;
  opacity?: number;
  rotation?: number;
  repeat?: boolean;
};

type ImageAnnotation = BaseAnnotation & {
  type: "signature" | "initials" | "image";
  dataUrl: string;
  label: string;
};

type DrawingAnnotation = Omit<BaseAnnotation, "x" | "y" | "w" | "h"> & {
  type: "draw";
  points: Point[];
  color: string;
  width: number;
};

type RectAnnotation = BaseAnnotation & {
  type: "whiteout" | "highlight" | "circle" | "rectangle";
  color: string;
  opacity: number;
  stroke?: boolean;
  filled?: boolean;
  outlined?: boolean;
  fillColor?: string;
  strokeColor?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
};

type ChoiceAnnotation = BaseAnnotation & {
  type: "checkbox" | "radio" | "checkmark";
  checked: boolean;
  mark?: "check" | "x";
};

type ArrowAnnotation = BaseAnnotation & {
  type: "arrow" | "line";
  color: string;
  width: number;
};

type TableAnnotation = BaseAnnotation & {
  type: "table";
  rows: number;
  cols: number;
  color: string;
  cells?: string[];
};

type FieldAnnotation = BaseAnnotation & {
  type: "field";
  name: string;
  value: string;
  fontSize: number;
};

type Annotation =
  | TextAnnotation
  | ImageAnnotation
  | DrawingAnnotation
  | RectAnnotation
  | ChoiceAnnotation
  | ArrowAnnotation
  | TableAnnotation
  | FieldAnnotation;

type SignatureAsset = {
  id: string;
  kind: "signature" | "initials";
  label: string;
  dataUrl: string;
};

type SignatureFont = {
  id: string;
  label: string;
  family: string;
};

type DraftBox = {
  id: string;
  page: number;
  type: "whiteout" | "highlight" | "circle" | "rectangle" | "line" | "arrow";
  x: number;
  y: number;
  w: number;
  h: number;
};

type TextZone = BaseAnnotation & {
  text: string;
  fontSize: number;
};

type FormZone = BaseAnnotation & {
  name: string;
  fieldType: string;
  value?: string;
};

type LineZone = BaseAnnotation & {
  source: "line";
};

type PdfTabState = {
  id: string;
  fileName: string;
  currentPath: string | null;
  pdfBytes: ArrayBuffer;
  pdfDoc: any;
  pageSizes: PageSize[];
  textZones: TextZone[];
  formZones: FormZone[];
  lineZones: LineZone[];
  annotations: Annotation[];
  selectedId: string | null;
  editingId: string | null;
  zoom: number;
  activePage: number;
  isDirty: boolean;
  status: string;
  history: Annotation[][];
  redo: Annotation[][];
};

type PageRange = {
  start: number;
  end: number;
};

const palette = {
  ink: "#111827",
  blue: "#2563eb",
  red: "#dc2626",
  green: "#059669",
  amber: "#d97706",
  violet: "#7c3aed",
};

const signatureFonts: SignatureFont[] = [
  { id: "cursive", label: "Connected", family: "Segoe Script, Lucida Handwriting, cursive" },
  { id: "signature", label: "Signature", family: "Segoe Print, Segoe Script, cursive" },
  { id: "script", label: "Soft Script", family: "Brush Script MT, Segoe Script, cursive" },
  { id: "formal", label: "Simple Cursive", family: "Lucida Handwriting, Segoe Print, cursive" },
  { id: "clean", label: "Clean", family: "Segoe UI, Arial, sans-serif" },
  { id: "serif", label: "Serif", family: "Georgia, Times New Roman, serif" },
  { id: "marker", label: "Marker", family: "Comic Sans MS, Segoe Print, cursive" },
  { id: "compact", label: "Compact", family: "Trebuchet MS, Arial, sans-serif" },
];

const primaryTools: Array<{ id: Tool; label: string; Icon: typeof MousePointer2 }> = [
  { id: "select", label: "Select", Icon: MousePointer2 },
  { id: "text", label: "Add text", Icon: Type },
  { id: "editText", label: "Edit text", Icon: Wand2 },
  { id: "field", label: "Text field", Icon: FileText },
  { id: "signature", label: "Signature", Icon: PenLine },
  { id: "initials", label: "Initials", Icon: Stamp },
  { id: "draw", label: "Draw", Icon: PenLine },
  { id: "eraser", label: "Eraser", Icon: Eraser },
  { id: "whiteout", label: "Whiteout", Icon: Eraser },
  { id: "highlight", label: "Highlight", Icon: Highlighter },
  { id: "checkbox", label: "Checkbox", Icon: CheckSquare },
  { id: "checkmark", label: "Checkmark", Icon: Check },
  { id: "radio", label: "Radio", Icon: Radio },
  { id: "date", label: "Date", Icon: FileText },
  { id: "image", label: "Image", Icon: ImageIcon },
  { id: "comment", label: "Comment", Icon: MessageSquare },
  { id: "note", label: "Note", Icon: StickyNote },
  { id: "line", label: "Line", Icon: Minus },
  { id: "arrow", label: "Arrow", Icon: ArrowRight },
  { id: "circle", label: "Circle", Icon: Circle },
  { id: "rectangle", label: "Rectangle", Icon: Square },
  { id: "table", label: "Table", Icon: Table2 },
  { id: "watermark", label: "Watermark", Icon: Stamp },
  { id: "pageNumber", label: "Page number", Icon: BookOpen },
];

const featureGroups = [
  {
    title: "Edit",
    items: ["Edit PDF", "Replace text", "Add text fields", "Add text", "Add images", "Erase", "Watermark", "Check spelling", "Add page numbers", "Add checkmarks", "Insert tables", "Add radio buttons", "Add dates"],
  },
  {
    title: "Annotate",
    items: ["Markup PDF", "Highlight", "Add comments", "Add arrows", "Add notes", "Add circles", "Type on PDF"],
  },
  {
    title: "Forms",
    items: ["Form builder", "Fill out and sign", "Create fillable forms", "Remove fields", "Populate forms", "Add checkboxes"],
  },
  {
    title: "Manage",
    items: ["Organize pages", "Insert pages", "Merge documents", "Split", "Rearrange and rotate", "Remove pages", "Compress", "Protect PDF"],
  },
  {
    title: "Convert",
    items: ["PDF to JPEG", "JPEG to PDF", "Word/PPT/Excel conversion needs a conversion engine"],
  },
];

const topMenus = [
  { title: "Home", items: ["Open PDF", "Save", "Print"] },
  { title: "Tools", items: ["Merge PDFs", "Split PDF", "Extract PDF pages", "Delete PDF pages", "Add page numbers", "Compress PDF", "Organize Pages"] },
  { title: "Convert", items: ["PDF to JPEG", "JPEG to PDF", "Word to PDF", "PDF to Word"] },
  { title: "Edit", items: ["Edit PDF", "Add Text", "Add Images", "Erase", "Watermark", "Number PDF pages"] },
  { title: "Sign & Protect", items: ["Sign Document", "Initials", "Protect PDF", "Redact PDF"] },
  { title: "Generative AI", items: ["Summarize PDF", "Translate PDF", "Ask PDF"] },
];

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const int = parseInt(clean, 16);
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

function hexToRgba(hex: string, opacity: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`;
}

function basePdfName(name: string) {
  return name.replace(/\.pdf$/i, "") || "document";
}

function pageNumbersFromRangeInput(input: string, total: number) {
  const pages = new Set<number>();
  const parts = input.split(",").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Use page numbers like 1,3-5.`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < 1 || start > total || end > total || start > end) {
      throw new Error(`Pages must be between 1 and ${total}.`);
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return pages;
}

function rangesFromInput(input: string, total: number): PageRange[] {
  const ranges = input.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Use ranges like 1-3,4-6.`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < 1 || start > total || end > total || start > end) {
      throw new Error(`Ranges must stay between 1 and ${total}.`);
    }
    return { start, end };
  });
  if (!ranges.length) throw new Error("Add at least one page range.");
  return ranges;
}

function fixedRanges(total: number, size: number): PageRange[] {
  const chunkSize = clamp(Math.floor(size) || 1, 1, total);
  const ranges: PageRange[] = [];
  for (let start = 1; start <= total; start += chunkSize) {
    ranges.push({ start, end: Math.min(total, start + chunkSize - 1) });
  }
  return ranges;
}

function pageRangeIndices(range: PageRange) {
  return Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start - 1 + index);
}

function isTextAnnotation(annotation: Annotation): annotation is TextAnnotation {
  return ["text", "date", "comment", "note", "watermark", "pageNumber", "detectedText"].includes(annotation.type);
}

function isImageAnnotation(annotation: Annotation): annotation is ImageAnnotation {
  return ["signature", "initials", "image"].includes(annotation.type);
}

function isRectAnnotation(annotation: Annotation): annotation is RectAnnotation {
  return ["whiteout", "highlight", "circle", "rectangle"].includes(annotation.type);
}

function eraseDrawingsAt(annotations: Annotation[], page: number, point: Point, radius = 0.024) {
  let changed = false;
  return annotations.flatMap<Annotation>((annotation) => {
    if (annotation.type !== "draw" || annotation.page !== page) return [annotation];
    const segments: Point[][] = [];
    let segment: Point[] = [];
    for (const candidate of annotation.points) {
      const distance = Math.hypot(candidate.x - point.x, (candidate.y - point.y) * 1.25);
      if (distance <= radius) {
        changed = true;
        if (segment.length > 1) segments.push(segment);
        segment = [];
      } else {
        segment.push(candidate);
      }
    }
    if (segment.length > 1) segments.push(segment);
    if (!changed) return [annotation];
    return segments.map((points, index) => ({
      ...annotation,
      id: index === 0 ? annotation.id : uid("draw"),
      points,
    }));
  });
}

function isChoiceAnnotation(annotation: Annotation): annotation is ChoiceAnnotation {
  return ["checkbox", "radio", "checkmark"].includes(annotation.type);
}

function pagePoint(event: React.PointerEvent, pageEl: HTMLDivElement) {
  const rect = pageEl.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function rectFromPdf(viewport: any, rect: number[], pageSize: PageSize) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return {
    x: clamp(left / pageSize.width, 0, 1),
    y: clamp(top / pageSize.height, 0, 1),
    w: clamp(width / pageSize.width, 0.01, 1),
    h: clamp(height / pageSize.height, 0.01, 1),
  };
}

function extractLineZones(operatorList: any, viewport: any, pageSize: PageSize, page: number): LineZone[] {
  const zones: LineZone[] = [];
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    if (operatorList.fnArray[index] !== OPS.constructPath) continue;
    const [ops, args] = operatorList.argsArray[index] ?? [];
    if (!Array.isArray(ops) || !Array.isArray(args)) continue;
    let cursor = 0;
    let current: Point | null = null;

    for (const op of ops) {
      if (op === OPS.moveTo) {
        current = { x: args[cursor], y: args[cursor + 1] };
        cursor += 2;
        continue;
      }
      if (op === OPS.lineTo) {
        const next = { x: args[cursor], y: args[cursor + 1] };
        cursor += 2;
        if (current) {
          const [x1, y1] = viewport.convertToViewportPoint(current.x, current.y);
          const [x2, y2] = viewport.convertToViewportPoint(next.x, next.y);
          const width = Math.abs(x2 - x1);
          const height = Math.abs(y2 - y1);
          if (width > pageSize.width * 0.08 && height < 3) {
            const left = Math.min(x1, x2);
            const top = Math.min(y1, y2) - 24;
            zones.push({
              id: uid("linezone"),
              page,
              source: "line",
              x: clamp(left / pageSize.width, 0, 1),
              y: clamp(top / pageSize.height, 0, 1),
              w: clamp(width / pageSize.width, 0.04, 1),
              h: clamp(28 / pageSize.height, 0.02, 0.12),
            });
          }
        }
        current = next;
        continue;
      }
      if (op === OPS.rectangle) {
        cursor += 4;
      }
    }
  }
  return zones.filter((zone, index, all) => {
    return !all.some(
      (other, otherIndex) =>
        otherIndex < index &&
        other.page === zone.page &&
        Math.abs(other.x - zone.x) < 0.01 &&
        Math.abs(other.y - zone.y) < 0.01 &&
        Math.abs(other.w - zone.w) < 0.02,
    );
  });
}

function loadAssets() {
  try {
    const raw = localStorage.getItem("pdf-filler-assets");
    return raw ? (JSON.parse(raw) as SignatureAsset[]) : [];
  } catch {
    return [];
  }
}

function saveAssets(assets: SignatureAsset[]) {
  localStorage.setItem("pdf-filler-assets", JSON.stringify(assets));
}

function payloadToArrayBuffer(bytes: DesktopPdfPayload["bytes"] | Uint8Array) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    const output = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(output).set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return output;
  }
  return Uint8Array.from(bytes).buffer;
}

function parsePrefillEntries(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split(/[:=]/);
      return { key: key.trim(), value: rest.join(":").trim() };
    })
    .filter((entry) => entry.key);
}

function App() {
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [tabs, setTabs] = useState<PdfTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("untitled.pdf");
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [textZones, setTextZones] = useState<TextZone[]>([]);
  const [formZones, setFormZones] = useState<FormZone[]>([]);
  const [lineZones, setLineZones] = useState<LineZone[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [activePage, setActivePage] = useState(1);
  const [assets, setAssets] = useState<SignatureAsset[]>(() => loadAssets());
  const [activeSignature, setActiveSignature] = useState("");
  const [activeInitials, setActiveInitials] = useState("");
  const [signatureModal, setSignatureModal] = useState<"signature" | "initials" | null>(null);
  const [drawColor, setDrawColor] = useState(palette.ink);
  const [drawWidth, setDrawWidth] = useState(3);
  const [eraserSize, setEraserSize] = useState(28);
  const [eraserOpacity, setEraserOpacity] = useState(0.18);
  const [shapeFillColor, setShapeFillColor] = useState("#ffffff");
  const [shapeStrokeColor, setShapeStrokeColor] = useState(palette.ink);
  const [shapeFillOpacity, setShapeFillOpacity] = useState(0.35);
  const [shapeStrokeOpacity, setShapeStrokeOpacity] = useState(1);
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState(2);
  const [textColor, setTextColor] = useState(palette.ink);
  const [prefillText, setPrefillText] = useState("");
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [updatesEnabled, setUpdatesEnabled] = useState(true);
  const [updateProvider, setUpdateProvider] = useState<"github" | "generic">("github");
  const [githubRepo, setGithubRepo] = useState("");
  const [updateFeedUrl, setUpdateFeedUrl] = useState("");
  const [updateStatus, setUpdateStatus] = useState("Updater ready");
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    phase: window.pdfFillerDesktop ? "checking" : "development",
    status: window.pdfFillerDesktop ? "Checking for updates..." : "Development mode",
    version: "",
    percent: 0,
  });
  const [showUpdateGate, setShowUpdateGate] = useState(Boolean(window.pdfFillerDesktop));
  const [startupReady, setStartupReady] = useState(!window.pdfFillerDesktop);
  const [appVersion, setAppVersion] = useState("development");
  const [status, setStatus] = useState("Ready");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [removePagesOpen, setRemovePagesOpen] = useState(false);
  const [extractPagesOpen, setExtractPagesOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [placementPreview, setPlacementPreview] = useState<{ page: number; x: number; y: number; tool: Tool } | null>(null);
  const [imagePlacementPreview, setImagePlacementPreview] = useState<{ page: number; x: number; y: number; w: number; h: number; dataUrl: string; label: string } | null>(null);
  const [eraserPreview, setEraserPreview] = useState<{ page: number; x: number; y: number } | null>(null);
  const [toolMenu, setToolMenu] = useState<{ tool: Tool; x: number; y: number } | null>(null);
  const isDesktop = Boolean(window.pdfFillerDesktop);
  const historyRef = useRef<Annotation[][]>([]);
  const redoRef = useRef<Annotation[][]>([]);
  const lastAnnotationsRef = useRef<Annotation[]>([]);
  const suppressHistoryRef = useRef(false);
  const loadedRef = useRef(false);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});
  const imageUploadRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    original: Annotation;
    pageWidth: number;
    pageHeight: number;
  } | null>(null);
  const activeDrawRef = useRef<string | null>(null);
  const activeEraseRef = useRef(false);
  const pendingInitialPdfRef = useRef<DesktopPdfPayload | null>(null);

  const selected = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedId) ?? null,
    [annotations, selectedId],
  );

  const currentTabSnapshot = useCallback((id = activeTabId): PdfTabState | null => {
    if (!id || !pdfBytes || !pdfDoc) return null;
    return {
      id,
      fileName,
      currentPath,
      pdfBytes,
      pdfDoc,
      pageSizes,
      textZones,
      formZones,
      lineZones,
      annotations,
      selectedId,
      editingId,
      zoom,
      activePage,
      isDirty,
      status,
      history: historyRef.current,
      redo: redoRef.current,
    };
  }, [activePage, activeTabId, annotations, currentPath, editingId, fileName, formZones, isDirty, lineZones, pageSizes, pdfBytes, pdfDoc, selectedId, status, textZones, zoom]);

  const restoreTab = (tab: PdfTabState) => {
    suppressHistoryRef.current = true;
    loadedRef.current = true;
    historyRef.current = tab.history;
    redoRef.current = tab.redo;
    lastAnnotationsRef.current = tab.annotations;
    setActiveTabId(tab.id);
    setPdfBytes(tab.pdfBytes);
    setPdfDoc(tab.pdfDoc);
    setFileName(tab.fileName);
    setCurrentPath(tab.currentPath);
    setPageSizes(tab.pageSizes);
    setTextZones(tab.textZones);
    setFormZones(tab.formZones);
    setLineZones(tab.lineZones);
    setAnnotations(tab.annotations);
    setSelectedId(tab.selectedId);
    setEditingId(tab.editingId);
    setZoom(tab.zoom);
    setActivePage(tab.activePage);
    setIsDirty(tab.isDirty);
    setStatus(tab.status);
    void window.pdfFillerDesktop?.setDirty(tabs.some((candidate) => candidate.id === tab.id ? tab.isDirty : candidate.isDirty));
  };

  const activateTab = (id: string) => {
    if (id === activeTabId) return;
    const snapshot = currentTabSnapshot();
    const nextTabs = snapshot ? tabs.map((tab) => (tab.id === snapshot.id ? snapshot : tab)) : tabs;
    const target = nextTabs.find((tab) => tab.id === id);
    if (!target) return;
    setTabs(nextTabs);
    restoreTab(target);
  };

  const closeTab = (id: string) => {
    const snapshot = currentTabSnapshot();
    const nextTabs = (snapshot ? tabs.map((tab) => (tab.id === snapshot.id ? snapshot : tab)) : tabs).filter((tab) => tab.id !== id);
    setTabs(nextTabs);
    if (id !== activeTabId) {
      void window.pdfFillerDesktop?.setDirty(nextTabs.some((tab) => tab.isDirty));
      return;
    }
    const next = nextTabs[0] ?? null;
    if (next) {
      restoreTab(next);
      return;
    }
    setActiveTabId(null);
    setPdfBytes(null);
    setPdfDoc(null);
    setFileName("untitled.pdf");
    setCurrentPath(null);
    setPageSizes([]);
    setTextZones([]);
    setFormZones([]);
    setLineZones([]);
    setAnnotations([]);
    setSelectedId(null);
    setEditingId(null);
    setIsDirty(false);
    setStatus("Ready");
    void window.pdfFillerDesktop?.setDirty(false);
  };

  const loadPdfBytes = async (bytes: ArrayBuffer, name: string, sourcePath: string | null = null, options: { replaceActive?: boolean } = {}) => {
    const previousSnapshot = currentTabSnapshot();
    setStatus("Opening PDF...");
    const task = getDocument({ data: bytes.slice(0) });
    const doc = await task.promise;
    const sizes: PageSize[] = [];
    const extractedText: TextZone[] = [];
    const extractedForms: FormZone[] = [];
    const extractedLines: LineZone[] = [];
    const importedAnnotations: Annotation[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const pageSize = { width: viewport.width, height: viewport.height };
      sizes.push(pageSize);
      const operatorList = await page.getOperatorList();
      extractedLines.push(...extractLineZones(operatorList, viewport, pageSize, pageNumber));

      const textContent = await page.getTextContent();
      for (const item of textContent.items as any[]) {
        if (!item.str?.trim()) continue;
        const transform = Util.transform(viewport.transform, item.transform);
        const fontSize = Math.max(8, Math.abs(transform[3]));
        const width = Math.max(item.width || fontSize * item.str.length * 0.45, fontSize * 0.5);
        const height = Math.max(fontSize * 1.15, item.height || fontSize);
        extractedText.push({
          id: uid("zone"),
          page: pageNumber,
          x: clamp(transform[4] / pageSize.width, 0, 1),
          y: clamp((transform[5] - height) / pageSize.height, 0, 1),
          w: clamp(width / pageSize.width, 0.01, 1),
          h: clamp(height / pageSize.height, 0.01, 1),
          text: item.str,
          fontSize,
        });
      }

      const pdfAnnotations = await page.getAnnotations();
      for (const candidate of pdfAnnotations as any[]) {
        if (!candidate.rect) continue;
        const box = rectFromPdf(viewport, candidate.rect, pageSize);
        if (candidate.subtype === "Widget") {
          extractedForms.push({
            id: uid("formzone"),
            page: pageNumber,
            ...box,
            name: candidate.fieldName || `Field ${extractedForms.length + 1}`,
            fieldType: candidate.fieldType || "Tx",
            value: typeof candidate.fieldValue === "string" ? candidate.fieldValue : "",
          });
          continue;
        }
        if (candidate.subtype === "FreeText" && candidate.contents) {
          importedAnnotations.push({
            id: uid("edgeText"),
            page: pageNumber,
            type: "text",
            ...box,
            text: candidate.contents,
            color: palette.blue,
            fontSize: 14,
            bold: false,
          });
        }
        if (candidate.subtype === "Highlight") {
          importedAnnotations.push({
            id: uid("edgeHighlight"),
            page: pageNumber,
            type: "highlight",
            ...box,
            color: "#fde047",
            opacity: 0.45,
          });
        }
      }
    }

    const statusText = `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}, ${extractedForms.length} form fields, ${extractedLines.length} fill lines`;
    const tabId = options.replaceActive && activeTabId ? activeTabId : uid("tab");
    const nextTab: PdfTabState = {
      id: tabId,
      fileName: name,
      currentPath: sourcePath,
      pdfBytes: bytes,
      pdfDoc: doc,
      pageSizes: sizes,
      textZones: extractedText,
      formZones: extractedForms,
      lineZones: extractedLines,
      annotations: importedAnnotations,
      selectedId: null,
      editingId: null,
      zoom: 1,
      activePage: 1,
      isDirty: false,
      status: statusText,
      history: [],
      redo: [],
    };

    setTabs((current) => {
      const updated = previousSnapshot ? current.map((tab) => (tab.id === previousSnapshot.id ? previousSnapshot : tab)) : current;
      const withoutExisting = updated.filter((tab) => tab.id !== tabId);
      return options.replaceActive ? [...withoutExisting, nextTab] : [...withoutExisting, nextTab];
    });
    setActiveTabId(tabId);
    setPdfBytes(bytes);
    setPdfDoc(doc);
    setFileName(name);
    setCurrentPath(sourcePath);
    setPageSizes(sizes);
    setTextZones(extractedText);
    setFormZones(extractedForms);
    setLineZones(extractedLines);
    suppressHistoryRef.current = true;
    historyRef.current = [];
    redoRef.current = [];
    lastAnnotationsRef.current = importedAnnotations;
    loadedRef.current = true;
    setAnnotations(importedAnnotations);
    setSelectedId(null);
    setEditingId(null);
    setIsDirty(false);
    void window.pdfFillerDesktop?.setDirty(false);
    setActivePage(1);
    setZoom(1);
    setStatus(statusText);
  };

  const loadPdf = async (file: File) => {
    await loadPdfBytes(await file.arrayBuffer(), file.name);
  };

  const loadDesktopPdfPath = async (filePath: string) => {
    const payload = await window.pdfFillerDesktop?.readPdfFile(filePath);
    if (!payload) return;
    await loadPdfBytes(payloadToArrayBuffer(payload.bytes), payload.name, payload.path);
  };

  useEffect(() => {
    saveAssets(assets);
    const firstSig = assets.find((asset) => asset.kind === "signature")?.id ?? "";
    const firstInitials = assets.find((asset) => asset.kind === "initials")?.id ?? "";
    setActiveSignature((current) => current || firstSig);
    setActiveInitials((current) => current || firstInitials);
  }, [assets]);

  useEffect(() => {
    if (!window.pdfFillerDesktop) return;
    void window.pdfFillerDesktop.getAppVersion().then(setAppVersion);
    void window.pdfFillerDesktop.getStartupEnabled().then(setStartupEnabled);
    void window.pdfFillerDesktop.getUpdateSettings().then((settings) => {
      setUpdatesEnabled(settings.enabled);
      setUpdateProvider(settings.provider);
      setGithubRepo(settings.githubRepo);
      setUpdateFeedUrl(settings.feedUrl);
      setUpdateStatus(settings.status);
      if (settings.updateState && settings.updateState.phase !== "idle") setUpdateState(settings.updateState);
    });
    void window.pdfFillerDesktop.getInitialPdf().then((payload) => {
      if (!payload) return;
      pendingInitialPdfRef.current = payload;
    });
    const removeOpenListener = window.pdfFillerDesktop.onPdfOpenedFromSystem((filePath) => {
      void loadDesktopPdfPath(filePath);
    });
    const removeUpdateListener = window.pdfFillerDesktop.onUpdaterStatus(setUpdateStatus);
    const removeUpdateStateListener = window.pdfFillerDesktop.onUpdaterState((state) => {
      setUpdateState(state);
      setShowUpdateGate(true);
    });
    const removeSaveBeforeCloseListener = window.pdfFillerDesktop.onSaveBeforeClose(() => {
      void savePdf().then(() => window.pdfFillerDesktop?.closeAfterSave());
    });
    return () => {
      removeOpenListener();
      removeUpdateListener();
      removeUpdateStateListener();
      removeSaveBeforeCloseListener();
    };
  }, []);

  useEffect(() => {
    if (!showUpdateGate) return;
    if (!["not-available", "disabled", "development"].includes(updateState.phase)) return;
    const timeout = window.setTimeout(() => {
      setShowUpdateGate(false);
      setStartupReady(true);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [showUpdateGate, updateState.phase]);

  useEffect(() => {
    if (!startupReady || !pendingInitialPdfRef.current) return;
    const payload = pendingInitialPdfRef.current;
    pendingInitialPdfRef.current = null;
    void loadPdfBytes(payloadToArrayBuffer(payload.bytes), payload.name, payload.path);
  }, [startupReady]);

  useEffect(() => {
    if (!loadedRef.current) {
      lastAnnotationsRef.current = annotations;
      return;
    }
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      lastAnnotationsRef.current = annotations;
      return;
    }
    historyRef.current = [...historyRef.current.slice(-39), lastAnnotationsRef.current];
    redoRef.current = [];
    lastAnnotationsRef.current = annotations;
    setIsDirty(true);
    setTabs((current) =>
      current.map((tab) => (tab.id === activeTabId ? { ...tab, annotations, isDirty: true, history: historyRef.current, redo: redoRef.current } : tab)),
    );
    void window.pdfFillerDesktop?.setDirty(true);
  }, [annotations]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current = [...redoRef.current, annotations];
    suppressHistoryRef.current = true;
    setAnnotations(previous);
    setSelectedId(null);
    setEditingId(null);
  }, [annotations]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, annotations];
    suppressHistoryRef.current = true;
    setAnnotations(next);
    setSelectedId(null);
    setEditingId(null);
  }, [annotations]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if ((event.ctrlKey && event.key.toLowerCase() === "y") || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z")) {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !typing) {
        event.preventDefault();
        removeAnnotation(selectedId);
      }
      if (event.key === "Escape") {
        setEditingId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId, undo, redo]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".documentScroller")) return;
      event.preventDefault();
      setZoom((value) => clamp(value + (event.deltaY < 0 ? 0.1 : -0.1), 0.45, 2.5));
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  const addAnnotation = (annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation]);
    setSelectedId(annotation.id);
    if (isTextAnnotation(annotation) || annotation.type === "field") setEditingId(annotation.id);
  };

  const removeAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setEditingId((current) => (current === id ? null : current));
  };

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === id ? ({ ...annotation, ...patch } as Annotation) : annotation,
      ),
    );
  };

  const createTextAnnotation = (page: number, point: Point, preset?: Partial<TextAnnotation>) => {
    addAnnotation({
      id: uid("text"),
      page,
      type: preset?.type ?? "text",
      x: point.x,
      y: point.y,
      w: preset?.w ?? 0.28,
      h: preset?.h ?? 0.055,
      text: preset?.text ?? "",
      color: preset?.color ?? textColor,
      fontSize: preset?.fontSize ?? 16,
      bold: preset?.bold ?? false,
      background: preset?.background,
      opacity: preset?.opacity,
      rotation: preset?.rotation,
      repeat: preset?.repeat,
    });
  };

  const addWatermark = (page = activePage) => {
    if (!pdfDoc || !pageSizes.length) {
      setStatus("Open a PDF before adding a watermark.");
      return;
    }
    createTextAnnotation(page, { x: 0.18, y: 0.42 }, {
      type: "watermark",
      text: "WATERMARK",
      w: 0.64,
      h: 0.14,
      fontSize: 54,
      color: "#64748b",
      bold: true,
      opacity: 0.22,
      rotation: -35,
      repeat: false,
    });
    setStatus("Watermark added. Edit text, opacity, angle, and repeat in the right panel.");
  };

  const handlePagePointerDown = (event: React.PointerEvent<HTMLDivElement>, pageIndex: number) => {
    if (!pdfDoc) return;
    const point = pagePoint(event, event.currentTarget);
    const page = pageIndex + 1;
    setActivePage(page);
    const annotationAtPoint = annotations
      .filter((annotation): annotation is Annotation & BaseAnnotation => annotation.type !== "draw" && annotation.page === page)
      .find((annotation) => point.x >= annotation.x && point.x <= annotation.x + annotation.w && point.y >= annotation.y && point.y <= annotation.y + annotation.h);
    const formZone = formZones.find(
      (zone) => zone.page === page && point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h,
    );
    const lineZone = lineZones.find(
      (zone) => zone.page === page && point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h,
    );

    if (tool === "eraser") {
      activeEraseRef.current = true;
      setEraserPreview({ page, x: point.x, y: point.y });
      setAnnotations((current) => eraseDrawingsAt(current, page, point, eraserSize / event.currentTarget.clientWidth));
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "select") {
      if (annotationAtPoint) {
        setSelectedId(annotationAtPoint.id);
        setEditingId(isTextAnnotation(annotationAtPoint) || annotationAtPoint.type === "field" ? annotationAtPoint.id : null);
        return;
      }
      if (formZone) {
        if (formZone.fieldType === "Btn") {
          addAnnotation({
            id: uid("checkbox"),
            page,
            type: "checkbox",
            x: formZone.x,
            y: formZone.y,
            w: formZone.w,
            h: formZone.h,
            checked: /^(1|true|yes|y|checked|x)$/i.test(formZone.value ?? ""),
            mark: "check",
          });
          return;
        }
        addAnnotation({
          id: uid("field"),
          page,
          type: "field",
          x: formZone.x,
          y: formZone.y,
          w: formZone.w,
          h: formZone.h,
          name: formZone.name,
          value: formZone.value ?? "",
          fontSize: 12,
        });
        return;
      }
      if (lineZone) {
        createTextAnnotation(page, { x: lineZone.x, y: lineZone.y }, { w: lineZone.w, h: lineZone.h, text: "", fontSize: 13 });
        return;
      }
      setSelectedId(null);
      setEditingId(null);
      return;
    }

    if (tool === "text") {
      createTextAnnotation(page, lineZone ? { x: lineZone.x, y: lineZone.y } : point, lineZone ? { w: lineZone.w, h: lineZone.h, text: "", fontSize: 13 } : undefined);
      return;
    }

    if (tool === "editText") {
      const zone = textZones
        .filter((item) => item.page === page)
        .find((item) => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h);
      if (!zone) {
        setSelectedId(null);
        setEditingId(null);
        setStatus("Edit Text only edits detected PDF text. Use Add text for new text boxes.");
        return;
      }
      const existing = annotations.find((annotation) =>
        annotation.page === page &&
        annotation.type === "detectedText" &&
        Math.abs(annotation.x - zone.x) < 0.006 &&
        Math.abs(annotation.y - zone.y) < 0.006 &&
        Math.abs(annotation.w - zone.w) < 0.02,
      );
      if (existing) {
        setSelectedId(existing.id);
        setEditingId(existing.id);
        return;
      }
      createTextAnnotation(page, { x: zone?.x ?? point.x, y: zone?.y ?? point.y }, {
        type: "detectedText",
        text: zone?.text ?? "",
        w: zone?.w ?? 0.28,
        h: zone?.h ?? 0.045,
        fontSize: zone ? clamp(zone.fontSize, 8, 28) : 14,
        background: "#ffffff",
      });
      return;
    }

    if (tool === "field") {
      addAnnotation({
        id: uid("field"),
        page,
        type: "field",
        x: point.x,
        y: point.y,
        w: 0.3,
        h: 0.05,
        name: `Field_${annotations.filter((item) => item.type === "field").length + 1}`,
        value: "",
        fontSize: 12,
      });
      return;
    }

    if (tool === "watermark") {
      addWatermark(page);
      return;
    }

    if (["date", "comment", "note", "pageNumber"].includes(tool)) {
      const pageText = tool === "pageNumber" ? `${page}` : "";
      const dateText = new Date().toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
      createTextAnnotation(page, point, {
        type: tool as TextAnnotation["type"],
        text: tool === "date" ? dateText : pageText,
        w: 0.24,
        h: tool === "note" || tool === "comment" ? 0.1 : 0.045,
        fontSize: 14,
        color: textColor,
        background: tool === "note" ? "#fef3c7" : undefined,
      });
      return;
    }

    if (["checkbox", "radio", "checkmark"].includes(tool)) {
      const size = tool === "checkmark" ? 0.035 : 0.032;
      addAnnotation({
        id: uid(tool),
        page,
        type: tool as ChoiceAnnotation["type"],
        x: clamp(point.x - size / 2, 0, 1),
        y: clamp(point.y - size / 2, 0, 1),
        w: size,
        h: size,
        checked: true,
        mark: tool === "checkmark" ? "check" : "x",
      });
      return;
    }

    if (tool === "signature" || tool === "initials") {
      const assetId = tool === "signature" ? activeSignature : activeInitials;
      const asset = assets.find((item) => item.id === assetId);
      if (!asset) {
        setSignatureModal(tool);
        return;
      }
      const w = tool === "signature" ? 0.28 : 0.12;
      const h = tool === "signature" ? 0.08 : 0.06;
      addAnnotation({
        id: uid(tool),
        page,
        type: tool,
        x: clamp(point.x - w / 2, 0, 1),
        y: clamp(point.y - h / 2, 0, 1),
        w,
        h,
        dataUrl: asset.dataUrl,
        label: asset.label,
      });
      return;
    }

    if (tool === "image") {
      imageUploadRef.current?.click();
      setStatus("Choose an image, then click the PDF again to position it.");
      return;
    }

    if (tool === "draw") {
      const id = uid("draw");
      activeDrawRef.current = id;
      setAnnotations((current) => [...current, { id, page, type: "draw", points: [point], color: drawColor, width: drawWidth }]);
      setSelectedId(id);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (["whiteout", "highlight", "circle", "rectangle", "line", "arrow"].includes(tool)) {
      const id = uid(tool);
      setDraftBox({ id, page, type: tool as DraftBox["type"], x: point.x, y: point.y, w: 0.001, h: 0.001 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "table") {
      addAnnotation({ id: uid("table"), page, type: "table", x: point.x, y: point.y, w: 0.42, h: 0.16, rows: 3, cols: 3, color: palette.ink, cells: Array(9).fill("") });
      setTool("select");
    }
  };

  const handlePagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (["checkbox", "radio", "checkmark"].includes(tool)) {
      const point = pagePoint(event, event.currentTarget);
      setPlacementPreview({ page: Number(event.currentTarget.dataset.page), x: point.x, y: point.y, tool });
      setImagePlacementPreview(null);
    } else if (tool === "signature" || tool === "initials") {
      const assetId = tool === "signature" ? activeSignature : activeInitials;
      const asset = assets.find((item) => item.id === assetId);
      const point = pagePoint(event, event.currentTarget);
      if (asset) {
        setImagePlacementPreview({
          page: Number(event.currentTarget.dataset.page),
          x: point.x,
          y: point.y,
          w: tool === "signature" ? 0.28 : 0.12,
          h: tool === "signature" ? 0.08 : 0.06,
          dataUrl: asset.dataUrl,
          label: asset.label,
        });
      }
      setPlacementPreview(null);
    } else if (tool === "eraser") {
      const point = pagePoint(event, event.currentTarget);
      setEraserPreview({ page: Number(event.currentTarget.dataset.page), x: point.x, y: point.y });
      setPlacementPreview(null);
      setImagePlacementPreview(null);
    }
    if (tool === "eraser" && activeEraseRef.current) {
      const point = pagePoint(event, event.currentTarget);
      const page = Number(event.currentTarget.dataset.page);
      setEraserPreview({ page, x: point.x, y: point.y });
      setAnnotations((current) => eraseDrawingsAt(current, page, point, eraserSize / event.currentTarget.clientWidth));
      return;
    }

    if (tool === "draw" && activeDrawRef.current) {
      const point = pagePoint(event, event.currentTarget);
      const id = activeDrawRef.current;
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === id && annotation.type === "draw"
            ? { ...annotation, points: [...annotation.points, point] }
            : annotation,
        ),
      );
      return;
    }

    if (draftBox) {
      const point = pagePoint(event, event.currentTarget);
      setDraftBox((current) => {
        if (!current) return null;
        let w = point.x - current.x;
        let h = point.y - current.y;
        if (event.shiftKey && (current.type === "circle" || current.type === "rectangle" || current.type === "whiteout" || current.type === "highlight")) {
          const size = Math.min(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * size;
          h = Math.sign(h || 1) * size;
        }
        return { ...current, w, h };
      });
    }
  };

  const finishPagePointer = () => {
    if (activeDrawRef.current) {
      activeDrawRef.current = null;
    }
    activeEraseRef.current = false;
    setEraserPreview(null);
    if (!draftBox) return;
    const normalized = {
      x: draftBox.w < 0 ? draftBox.x + draftBox.w : draftBox.x,
      y: draftBox.h < 0 ? draftBox.y + draftBox.h : draftBox.y,
      w: Math.abs(draftBox.w),
      h: Math.abs(draftBox.h),
    };
    if (draftBox.type === "line" || draftBox.type === "arrow") {
      addAnnotation({
        id: draftBox.id,
        page: draftBox.page,
        type: draftBox.type,
        x: clamp(normalized.x, 0, 1),
        y: clamp(normalized.y, 0, 1),
        w: clamp(normalized.w || 0.16, 0.01, 1),
        h: clamp(normalized.h || 0.05, 0.01, 1),
        color: shapeStrokeColor,
        width: shapeStrokeWidth,
      });
      setDraftBox(null);
      return;
    }
    const isShape = draftBox.type === "circle" || draftBox.type === "rectangle";
    const color = draftBox.type === "highlight" ? "#fde047" : draftBox.type === "whiteout" ? "#ffffff" : drawColor;
    addAnnotation({
      id: draftBox.id,
      page: draftBox.page,
      type: draftBox.type,
      x: clamp(normalized.x, 0, 1),
      y: clamp(normalized.y, 0, 1),
      w: clamp(normalized.w || 0.16, 0.01, 1),
      h: clamp(normalized.h || 0.05, 0.01, 1),
      color: isShape ? shapeFillColor : color,
      opacity: draftBox.type === "highlight" ? 0.45 : isShape ? shapeFillOpacity : 1,
      stroke: isShape,
      filled: isShape ? true : !isShape,
      outlined: isShape,
      fillColor: isShape ? shapeFillColor : color,
      strokeColor: isShape ? shapeStrokeColor : drawColor,
      fillOpacity: draftBox.type === "highlight" ? 0.45 : isShape ? shapeFillOpacity : 1,
      strokeOpacity: isShape ? shapeStrokeOpacity : 1,
      strokeWidth: isShape ? shapeStrokeWidth : 2,
    });
    setDraftBox(null);
  };

  const startAnnotationDrag = (
    event: React.PointerEvent,
    annotation: Annotation,
    pageSize: PageSize,
    mode: "move" | "resize",
  ) => {
    event.stopPropagation();
    if (editingId === annotation.id && mode === "move") return;
    setSelectedId(annotation.id);
    dragRef.current = {
      id: annotation.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: annotation,
      pageWidth: pageSize.width * zoom,
      pageHeight: pageSize.height * zoom,
    };
    window.addEventListener("pointermove", moveAnnotation);
    window.addEventListener("pointerup", stopAnnotationDrag, { once: true });
  };

  const moveAnnotation = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.pageWidth;
    const dy = (event.clientY - drag.startY) / drag.pageHeight;
    const original = drag.original;
    setAnnotations((current) =>
      current.map((annotation) => {
        if (annotation.id !== drag.id || annotation.type === "draw") return annotation;
        if (drag.mode === "move") {
          return { ...annotation, x: clamp((original as BaseAnnotation).x + dx, 0, 0.98), y: clamp((original as BaseAnnotation).y + dy, 0, 0.98) } as Annotation;
        }
        return { ...annotation, w: clamp((original as BaseAnnotation).w + dx, 0.015, 1), h: clamp((original as BaseAnnotation).h + dy, 0.015, 1) } as Annotation;
      }),
    );
  }, []);

  const stopAnnotationDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", moveAnnotation);
  }, [moveAnnotation]);

  useEffect(() => () => window.removeEventListener("pointermove", moveAnnotation), [moveAnnotation]);

  const importDetectedText = () => {
    if (!textZones.length) {
      setStatus("No selectable text found. Scanned PDFs need OCR before text can be edited.");
      return;
    }
    const existing = new Set(
      annotations
        .filter((item): item is TextAnnotation => item.type === "detectedText")
        .map((item) => `${item.page}:${Math.round(item.x * 10000)}:${Math.round(item.y * 10000)}`),
    );
    const imports = textZones
      .filter((zone) => !existing.has(`${zone.page}:${Math.round(zone.x * 10000)}:${Math.round(zone.y * 10000)}`))
      .map<TextAnnotation>((zone) => ({
        id: uid("detected"),
        page: zone.page,
        type: "detectedText",
        x: zone.x,
        y: zone.y,
        w: Math.max(zone.w, 0.025),
        h: Math.max(zone.h, 0.02),
        text: zone.text,
        color: palette.ink,
        fontSize: clamp(zone.fontSize, 7, 28),
        bold: false,
        background: "#ffffff",
    }));
    setAnnotations((current) => [...current, ...imports]);
    setStatus("Editable text boxes added.");
  };

  const applyPrefill = () => {
    const entries = parsePrefillEntries(prefillText);
    if (!entries.length || !pageSizes.length) return;
    const rows = entries.map((entry) => `${entry.key}: ${entry.value}`);
    setAnnotations((current) => [
      ...current,
      ...rows.map<TextAnnotation>((row, index) => ({
        id: uid("prefill"),
        page: 1,
        type: "text",
        x: 0.08,
        y: 0.1 + index * 0.045,
        w: 0.5,
        h: 0.035,
        text: row,
        color: palette.ink,
        fontSize: 12,
        bold: false,
      })),
    ]);
  };

  const buildPdfBytes = async () => {
    if (!pdfBytes) return null;
    const pdf = await PDFDocument.load(pdfBytes.slice(0));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const prefillEntries = parsePrefillEntries(prefillText);

    if (prefillEntries.length) {
      const form = pdf.getForm();
      const fields = form.getFields();
      for (const entry of prefillEntries) {
        const field = fields.find((candidate) => candidate.getName().toLowerCase() === entry.key.toLowerCase());
        if (!field) continue;
        try {
          if (field instanceof PDFTextField) form.getTextField(field.getName()).setText(entry.value);
          if (field instanceof PDFCheckBox) {
            const checkbox = form.getCheckBox(field.getName());
            if (/^(1|true|yes|y|checked|x)$/i.test(entry.value)) checkbox.check();
            else checkbox.uncheck();
          }
        } catch {
          // Unsupported PDF widgets are left intact.
        }
      }
      form.updateFieldAppearances(font);
    }

    for (const annotation of annotations) {
      const page = pdf.getPage(annotation.page - 1);
      const { width, height } = page.getSize();

      if (annotation.type === "field") {
        const field = pdf.getForm().createTextField(annotation.name || uid("Field"));
        field.setText(annotation.value);
        field.addToPage(page, {
          x: annotation.x * width,
          y: height - annotation.y * height - annotation.h * height,
          width: annotation.w * width,
          height: annotation.h * height,
          textColor: rgb(0.07, 0.09, 0.12),
          borderColor: rgb(0.37, 0.48, 0.61),
          backgroundColor: rgb(1, 1, 1),
        });
        continue;
      }

      if (isTextAnnotation(annotation)) {
        if (annotation.background) {
          page.drawRectangle({
            x: annotation.x * width,
            y: height - annotation.y * height - annotation.h * height,
            width: annotation.w * width,
            height: annotation.h * height,
            color: rgb(1, 1, 1),
            opacity: annotation.type === "watermark" ? 0 : 1,
          });
        }
        const color = hexToRgb(annotation.color);
        const opacity = annotation.type === "watermark" ? annotation.opacity ?? 0.22 : 1;
        if (annotation.type === "watermark" && annotation.repeat) {
          const text = annotation.text || "WATERMARK";
          const size = annotation.fontSize;
          const textWidth = font.widthOfTextAtSize(text, size);
          const gapX = Math.max(textWidth + 140, 240);
          const gapY = Math.max(size * 4, 130);
          for (let y = -height * 0.2; y < height * 1.25; y += gapY) {
            for (let x = -width * 0.1; x < width * 1.15; x += gapX) {
              page.drawText(text, {
                x,
                y,
                size,
                font: annotation.bold ? boldFont : font,
                color: rgb(color.r, color.g, color.b),
                opacity,
                rotate: degrees(annotation.rotation ?? -35),
              });
            }
          }
          continue;
        }
        page.drawText(annotation.text || " ", {
          x: annotation.x * width,
          y: height - annotation.y * height - annotation.fontSize,
          size: annotation.fontSize,
          font: annotation.bold ? boldFont : font,
          color: rgb(color.r, color.g, color.b),
          opacity,
          rotate: annotation.type === "watermark" ? degrees(annotation.rotation ?? -35) : undefined,
          maxWidth: annotation.w * width,
          lineHeight: annotation.fontSize * 1.18,
        });
      }

      if (isImageAnnotation(annotation)) {
        const imageBytes = await fetch(annotation.dataUrl).then((response) => response.arrayBuffer());
        const image = await pdf.embedPng(imageBytes);
        page.drawImage(image, {
          x: annotation.x * width,
          y: height - annotation.y * height - annotation.h * height,
          width: annotation.w * width,
          height: annotation.h * height,
        });
      }

      if (annotation.type === "draw") {
        const color = hexToRgb(annotation.color);
        for (let index = 1; index < annotation.points.length; index += 1) {
          const previous = annotation.points[index - 1];
          const current = annotation.points[index];
          page.drawLine({
            start: { x: previous.x * width, y: height - previous.y * height },
            end: { x: current.x * width, y: height - current.y * height },
            thickness: annotation.width,
            color: rgb(color.r, color.g, color.b),
          });
        }
      }

      if (isRectAnnotation(annotation)) {
        const fillColor = hexToRgb(annotation.fillColor ?? annotation.color);
        const strokeColor = hexToRgb(annotation.strokeColor ?? annotation.color);
        const options = {
          x: annotation.x * width,
          y: height - annotation.y * height - annotation.h * height,
          width: annotation.w * width,
          height: annotation.h * height,
        };
        const filled = annotation.filled ?? !annotation.stroke;
        const outlined = annotation.outlined ?? Boolean(annotation.stroke);
        const fillOpacity = annotation.fillOpacity ?? annotation.opacity;
        const strokeOpacity = annotation.strokeOpacity ?? annotation.opacity;
        const strokeWidth = annotation.strokeWidth ?? 2;
        if (annotation.type === "circle") {
          const ellipse = {
            x: options.x + options.width / 2,
            y: options.y + options.height / 2,
            xScale: options.width / 2,
            yScale: options.height / 2,
          };
          if (filled) page.drawEllipse({ ...ellipse, color: rgb(fillColor.r, fillColor.g, fillColor.b), opacity: fillOpacity });
          if (outlined) page.drawEllipse({ ...ellipse, borderColor: rgb(strokeColor.r, strokeColor.g, strokeColor.b), borderWidth: strokeWidth, opacity: strokeOpacity });
        } else {
          if (filled) page.drawRectangle({ ...options, color: rgb(fillColor.r, fillColor.g, fillColor.b), opacity: fillOpacity });
          if (outlined) page.drawRectangle({ ...options, borderColor: rgb(strokeColor.r, strokeColor.g, strokeColor.b), borderWidth: strokeWidth, opacity: strokeOpacity });
        }
      }

      if (isChoiceAnnotation(annotation)) {
        const box = Math.min(annotation.w * width, annotation.h * height);
        const x = annotation.x * width;
        const y = height - annotation.y * height - box;
        if (annotation.type === "radio") {
          page.drawEllipse({ x: x + box / 2, y: y + box / 2, xScale: box / 2, yScale: box / 2, borderColor: rgb(0.07, 0.09, 0.12), borderWidth: 1.5 });
          if (annotation.checked) page.drawEllipse({ x: x + box / 2, y: y + box / 2, xScale: box / 4, yScale: box / 4, color: rgb(0.07, 0.09, 0.12) });
        } else if (annotation.type === "checkmark") {
          page.drawText(annotation.mark === "x" ? "X" : "✓", { x, y, size: box, font: boldFont, color: rgb(0.07, 0.09, 0.12) });
        } else {
          page.drawRectangle({ x, y, width: box, height: box, borderColor: rgb(0.07, 0.09, 0.12), borderWidth: 1.4, color: rgb(1, 1, 1) });
          if (annotation.checked) page.drawText(annotation.mark === "check" ? "✓" : "X", { x: x + box * 0.12, y: y + box * 0.02, size: box * 0.9, font: boldFont, color: rgb(0.07, 0.09, 0.12) });
        }
      }

      if (annotation.type === "arrow" || annotation.type === "line") {
        const color = hexToRgb(annotation.color);
        const start = { x: annotation.x * width, y: height - annotation.y * height - annotation.h * height };
        const end = { x: annotation.x * width + annotation.w * width, y: height - annotation.y * height };
        page.drawLine({ start, end, thickness: annotation.width, color: rgb(color.r, color.g, color.b) });
        if (annotation.type === "arrow") {
          page.drawLine({ start: end, end: { x: end.x - 12, y: end.y - 4 }, thickness: annotation.width, color: rgb(color.r, color.g, color.b) });
          page.drawLine({ start: end, end: { x: end.x - 5, y: end.y - 12 }, thickness: annotation.width, color: rgb(color.r, color.g, color.b) });
        }
      }

      if (annotation.type === "table") {
        const color = hexToRgb(annotation.color);
        const left = annotation.x * width;
        const bottom = height - annotation.y * height - annotation.h * height;
        const tableW = annotation.w * width;
        const tableH = annotation.h * height;
        for (let row = 0; row <= annotation.rows; row += 1) {
          const y = bottom + (tableH / annotation.rows) * row;
          page.drawLine({ start: { x: left, y }, end: { x: left + tableW, y }, thickness: 1, color: rgb(color.r, color.g, color.b) });
        }
        for (let col = 0; col <= annotation.cols; col += 1) {
          const x = left + (tableW / annotation.cols) * col;
          page.drawLine({ start: { x, y: bottom }, end: { x, y: bottom + tableH }, thickness: 1, color: rgb(color.r, color.g, color.b) });
        }
        const cellW = tableW / annotation.cols;
        const cellH = tableH / annotation.rows;
        for (let row = 0; row < annotation.rows; row += 1) {
          for (let col = 0; col < annotation.cols; col += 1) {
            const text = annotation.cells?.[row * annotation.cols + col] ?? "";
            if (!text.trim()) continue;
            page.drawText(text, {
              x: left + col * cellW + 4,
              y: bottom + tableH - (row + 1) * cellH + Math.max(4, cellH - 12),
              size: Math.min(11, cellH * 0.55),
              font,
              color: rgb(0.07, 0.09, 0.12),
              maxWidth: cellW - 8,
            });
          }
        }
      }
    }

    pdf.getForm().updateFieldAppearances(font);
    return pdf.save();
  };

  const downloadPdf = async () => {
    const output = await buildPdfBytes();
    if (!output) return;
    const outputBuffer = new ArrayBuffer(output.byteLength);
    new Uint8Array(outputBuffer).set(output);
    const blob = new Blob([outputBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.replace(/\.pdf$/i, "") + "-filled.pdf";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Exported PDF.");
  };

  const savePdf = async () => {
    const output = await buildPdfBytes();
    if (!output) return;
    if (window.pdfFillerDesktop) {
      const result = await window.pdfFillerDesktop.savePdfFile({
        defaultName: fileName.replace(/\.pdf$/i, "") + "-filled.pdf",
        bytes: Array.from(output),
      });
      if (!result.canceled && result.filePath) setStatus(`Saved ${result.filePath}`);
      if (!result.canceled) {
        setIsDirty(false);
        setTabs((current) => {
          const next = current.map((tab) => (tab.id === activeTabId ? { ...tab, isDirty: false } : tab));
          void window.pdfFillerDesktop?.setDirty(next.some((tab) => tab.isDirty));
          return next;
        });
      }
      return;
    }
    await downloadPdf();
  };

  const printPdf = async () => {
    const output = await buildPdfBytes();
    if (!output) return;
    if (window.pdfFillerDesktop) {
      setStatus("Preparing print preview...");
      const result = await window.pdfFillerDesktop.printPdfFile({
        defaultName: fileName.replace(/\.pdf$/i, "") + "-filled.pdf",
        bytes: Array.from(output),
      });
      setStatus(result.ok ? "Print dialog opened." : result.reason || "Print was canceled.");
    } else {
      const outputBuffer = new ArrayBuffer(output.byteLength);
      new Uint8Array(outputBuffer).set(output);
      const blob = new Blob([outputBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank");
      if (!printWindow) {
        setStatus("Allow popups to print this PDF.");
        URL.revokeObjectURL(url);
        return;
      }
      printWindow.addEventListener("load", () => {
        printWindow.focus();
        printWindow.print();
        URL.revokeObjectURL(url);
      });
    }
  };

  const savePdfBytes = async (bytes: Uint8Array, defaultName: string) => {
    if (window.pdfFillerDesktop) {
      const result = await window.pdfFillerDesktop.savePdfFile({
        defaultName,
        bytes: Array.from(bytes),
      });
      if (!result.canceled && result.filePath) setStatus(`Saved ${result.filePath}`);
      return result;
    }
    const outputBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(outputBuffer).set(bytes);
    const blob = new Blob([outputBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    URL.revokeObjectURL(url);
    return { canceled: false };
  };

  const saveMultiplePdfFiles = async (files: Array<{ name: string; bytes: Uint8Array }>) => {
    if (!files.length) return { canceled: true };
    if (window.pdfFillerDesktop) {
      const result = await window.pdfFillerDesktop.savePdfFiles({
        title: "Choose folder for split PDFs",
        files: files.map((file) => ({ name: file.name, bytes: Array.from(file.bytes) })),
      });
      if (!result.canceled && result.folder) setStatus(`Saved ${files.length} PDFs to ${result.folder}`);
      return result;
    }
    for (const file of files) {
      await savePdfBytes(file.bytes, file.name);
    }
    return { canceled: false };
  };

  const mergePdfFiles = async (files: File[]) => {
    if (files.length < 2) {
      setStatus("Choose at least two PDFs to merge.");
      return;
    }
    setStatus("Merging PDFs...");
    const output = await PDFDocument.create();
    for (const file of files) {
      const source = await PDFDocument.load(await file.arrayBuffer());
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach((page) => output.addPage(page));
    }
    await savePdfBytes(await output.save(), "merged.pdf");
    setMergeOpen(false);
    setStatus(`Merged ${files.length} PDFs.`);
  };

  const splitPdfFile = async (file: File, ranges: PageRange[]) => {
    setStatus("Splitting PDF...");
    const sourceBytes = await file.arrayBuffer();
    const source = await PDFDocument.load(sourceBytes.slice(0));
    const baseName = basePdfName(file.name);
    const outputs: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const [index, range] of ranges.entries()) {
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, pageRangeIndices(range));
      pages.forEach((page) => output.addPage(page));
      outputs.push({
        name: `${baseName}-split-${index + 1}-p${range.start}${range.end === range.start ? "" : `-${range.end}`}.pdf`,
        bytes: await output.save(),
      });
    }
    const result = await saveMultiplePdfFiles(outputs);
    if (!result.canceled) {
      setSplitOpen(false);
      setStatus(`Created ${outputs.length} split PDF${outputs.length === 1 ? "" : "s"}.`);
    }
  };

  const extractPagesFromFile = async (file: File, pagesToExtract: number[]) => {
    if (!pagesToExtract.length) {
      setStatus("Select at least one page to extract.");
      return;
    }
    setStatus("Extracting pages...");
    const sourceBytes = await file.arrayBuffer();
    const source = await PDFDocument.load(sourceBytes.slice(0));
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, pagesToExtract.map((page) => page - 1));
    pages.forEach((page) => output.addPage(page));
    await savePdfBytes(await output.save(), `${basePdfName(file.name)}-extracted-pages.pdf`);
    setExtractPagesOpen(false);
    setStatus(`Extracted ${pagesToExtract.length} page${pagesToExtract.length === 1 ? "" : "s"}.`);
  };

  const removePagesFromFile = async (file: File, pagesToRemove: number[], openAfterSave: boolean) => {
    setStatus("Removing pages...");
    const sourceBytes = await file.arrayBuffer();
    const source = await PDFDocument.load(sourceBytes.slice(0));
    const total = source.getPageCount();
    const removeSet = new Set(pagesToRemove);
    const keep = Array.from({ length: total }, (_, index) => index).filter((index) => !removeSet.has(index + 1));
    if (!keep.length) {
      setStatus("At least one page must remain.");
      return;
    }
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, keep);
    pages.forEach((page) => output.addPage(page));
    const result = await savePdfBytes(await output.save(), `${basePdfName(file.name)}-removed-pages.pdf`);
    setRemovePagesOpen(false);
    setStatus(`Removed ${pagesToRemove.length} page${pagesToRemove.length === 1 ? "" : "s"}.`);
    if (openAfterSave && result && !result.canceled && result.filePath) {
      await loadDesktopPdfPath(result.filePath);
    }
  };

  const exportSelectedPages = async (indices: number[], defaultName: string) => {
    if (!pdfBytes) {
      setStatus("Open a PDF before using this tool.");
      return;
    }
    const source = await PDFDocument.load(pdfBytes.slice(0));
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, indices);
    pages.forEach((page) => output.addPage(page));
    await savePdfBytes(await output.save(), defaultName);
  };

  const deleteActivePage = async () => {
    if (!pdfBytes || pageSizes.length <= 1) {
      setStatus("Open a multi-page PDF before deleting a page.");
      return;
    }
    const keep = pageSizes.map((_, index) => index).filter((index) => index !== activePage - 1);
    const nextAnnotations = annotations
      .filter((annotation) => annotation.page !== activePage)
      .map((annotation) => annotation.page > activePage ? ({ ...annotation, page: annotation.page - 1 } as Annotation) : annotation);
    const source = await PDFDocument.load(pdfBytes.slice(0));
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, keep);
    pages.forEach((page) => output.addPage(page));
    const bytes = await output.save();
    await loadPdfBytes(payloadToArrayBuffer(bytes), fileName, currentPath, { replaceActive: true });
    setAnnotations(nextAnnotations);
    setStatus(`Deleted page ${activePage}.`);
  };

  const rotateActivePage = async (direction: -1 | 1 = 1) => {
    if (!pdfBytes) return;
    const pdf = await PDFDocument.load(pdfBytes.slice(0));
    const page = pdf.getPage(activePage - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + direction * 90 + 360) % 360));
    const bytes = await pdf.save();
    const preservedAnnotations = annotations;
    await loadPdfBytes(payloadToArrayBuffer(bytes), fileName, currentPath, { replaceActive: true });
    setAnnotations(preservedAnnotations);
    setStatus(`Rotated page ${activePage} ${direction === 1 ? "right" : "left"}.`);
  };

  const addPageNumbers = () => {
    if (!pageSizes.length) return;
    setAnnotations((current) => [
      ...current,
      ...pageSizes.map<TextAnnotation>((_, index) => ({
        id: uid("pageNumber"),
        page: index + 1,
        type: "pageNumber",
        x: 0.47,
        y: 0.94,
        w: 0.1,
        h: 0.035,
        text: `${index + 1}`,
        color: palette.ink,
        fontSize: 11,
        bold: false,
      })),
    ]);
    setStatus("Page numbers added.");
  };

  const runTopMenuAction = (item: string) => {
    setActiveMenu(null);
    if (item === "Open PDF") document.getElementById("pdf-upload")?.click();
    if (item === "Save") void savePdf();
    if (item === "Print") void printPdf();
    if (item === "Merge PDFs") setMergeOpen(true);
    if (item === "Split PDF" || item === "Split") setSplitOpen(true);
    if (item === "Extract PDF pages") setExtractPagesOpen(true);
    if (item === "Delete PDF pages" || item === "Remove Pages" || item === "Remove pages") setRemovePagesOpen(true);
    if (item === "Rotate PDF" || item === "Rotate PDF pages") void rotateActivePage();
    if (item === "Organize Pages") setStatus("Use Split, Extract, Delete, or the rotate buttons to organize pages.");
    if (item === "Add page numbers" || item === "Number PDF pages") addPageNumbers();
    if (item === "Edit PDF") setTool("editText");
    if (item === "Add Text") setTool("text");
    if (item === "Add Images") {
      setTool("image");
      imageUploadRef.current?.click();
    }
    if (item === "Erase") setTool("eraser");
    if (item === "Watermark") addWatermark();
    if (item === "Sign Document") setTool("signature");
    if (item === "Initials") setTool("initials");
    if (/Word|PowerPoint|Excel|Compress|Unlock|Protect|OCR|Summarize|Translate|Markdown|Repair|Compare|Scan/i.test(item)) {
      setStatus(`${item} needs a dedicated conversion/security engine. Local editing tools are available now.`);
    }
  };

  const exportTemplate = () => {
    const blob = new Blob([JSON.stringify({ fileName, annotations }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.replace(/\.pdf$/i, "") + "-template.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = async (file: File) => {
    const data = JSON.parse(await file.text()) as { annotations: Annotation[] };
    setAnnotations(data.annotations ?? []);
  };

  const goToPage = (page: number) => {
    setActivePage(page);
    pageRefs.current[page]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onDocumentWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey || event.defaultPrevented) return;
    event.preventDefault();
    setZoom((value) => clamp(value + (event.deltaY < 0 ? 0.1 : -0.1), 0.45, 2.5));
  };

  const selectedSignatureAssets = assets.filter((asset) => asset.kind === "signature");
  const selectedInitialAssets = assets.filter((asset) => asset.kind === "initials");
  const enterEditor = () => {
    setShowUpdateGate(false);
    setStartupReady(true);
  };

  if (isDesktop && !startupReady) {
    return (
      <UpdateGate
        appVersion={appVersion}
        state={updateState}
        onUpdate={() => void window.pdfFillerDesktop?.downloadUpdate()}
        onContinue={enterEditor}
      />
    );
  }

  return (
    <div className="shell">
      <header className="globalNav">
        <div className="globalBrand">
          <span className="brandMark compact">PF</span>
          <div className="globalBrandText">
            <strong>PDF Filler</strong>
            <span>v{appVersion}</span>
          </div>
        </div>
        <nav className="menuBar" aria-label="Application menu">
          {topMenus.map((menu) => (
            <div className="menuWrap" key={menu.title}>
              <button
                className={activeMenu === menu.title ? "menuButton active" : "menuButton"}
                onClick={() => setActiveMenu((current) => (current === menu.title ? null : menu.title))}
              >
                {menu.title}
                {menu.title !== "Home" && <span>⌄</span>}
              </button>
              {activeMenu === menu.title && (
                <div className="menuDropdown">
                  {menu.items.map((item) => (
                    <button key={item} onClick={() => runTopMenuAction(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </header>
      <div className="documentTabs" aria-label="Open PDFs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTabId ? "docTab active" : "docTab"}
            onClick={() => activateTab(tab.id)}
            title={tab.fileName}
          >
            <FileText size={14} />
            <span>{tab.fileName}</span>
            {tab.isDirty && <strong>*</strong>}
            <em
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeTab(tab.id);
                }
              }}
              title="Close tab"
            >
              x
            </em>
          </button>
        ))}
      </div>
      <main className="app">
      <aside className="rail" aria-label="Tools">
        <div className="brand">
          <span className="brandMark">PF</span>
          <div>
            <strong>PDF Filler</strong>
            <span>Local desktop editor</span>
          </div>
        </div>

        <div className="toolGroups">
          <div className="toolSectionTitle">Tools</div>
          <div className="toolGrid">
            {primaryTools.map(({ id, label, Icon }) => (
              <button
                className={tool === id ? "tool active" : "tool"}
                key={id}
                onContextMenu={(event) => {
                  if (!["draw", "eraser", "line", "arrow", "circle", "rectangle", "highlight", "whiteout"].includes(id)) return;
                  event.preventDefault();
                  setTool(id);
                  setToolMenu({ tool: id, x: event.clientX, y: event.clientY });
                }}
                onClick={() => {
                  if (id === "watermark") {
                    addWatermark();
                    return;
                  }
                  setTool(id);
                  if (id === "image") imageUploadRef.current?.click();
                }}
                title={label}
                aria-label={label}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {toolMenu && (
          <ToolContextMenu
            menu={toolMenu}
            drawColor={drawColor}
            drawWidth={drawWidth}
            eraserSize={eraserSize}
            eraserOpacity={eraserOpacity}
            shapeFillColor={shapeFillColor}
            shapeStrokeColor={shapeStrokeColor}
            shapeFillOpacity={shapeFillOpacity}
            shapeStrokeOpacity={shapeStrokeOpacity}
            shapeStrokeWidth={shapeStrokeWidth}
            onClose={() => setToolMenu(null)}
            onDrawColor={setDrawColor}
            onDrawWidth={setDrawWidth}
            onEraserSize={setEraserSize}
            onEraserOpacity={setEraserOpacity}
            onShapeFillColor={setShapeFillColor}
            onShapeStrokeColor={setShapeStrokeColor}
            onShapeFillOpacity={setShapeFillOpacity}
            onShapeStrokeOpacity={setShapeStrokeOpacity}
            onShapeStrokeWidth={setShapeStrokeWidth}
          />
        )}

        <div className="railDivider" />
        <button className="wideButton" onClick={() => document.getElementById("pdf-upload")?.click()}>
          <Upload size={18} />
          Open PDF
        </button>
        <input
          hidden
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadPdf(file);
          }}
        />
        <input
          hidden
          ref={imageUploadRef}
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file || !pageSizes.length) return;
            const reader = new FileReader();
            reader.onload = () => {
              addAnnotation({
                id: uid("image"),
                page: activePage,
                type: "image",
                x: 0.18,
                y: 0.18,
                w: 0.25,
                h: 0.18,
                dataUrl: String(reader.result),
                label: file.name,
              });
            };
            reader.readAsDataURL(file);
          }}
        />
        <button className="wideButton primary" disabled={!pdfBytes} onClick={() => void savePdf()}>
          <Save size={18} />
          Save
        </button>
        <button className="wideButton" disabled={!pdfBytes} onClick={() => void downloadPdf()}>
          <Download size={18} />
          Export
        </button>
        <button className="wideButton" disabled={!pdfBytes} onClick={() => void printPdf()}>
          <Printer size={18} />
          Print
        </button>

        {pdfDoc && (
          <div className="thumbnailPane">
            <div className="toolSectionTitle">Pages</div>
            {pageSizes.map((pageSize, index) => (
              <Thumbnail
                key={index}
                doc={pdfDoc}
                page={index + 1}
                pageSize={pageSize}
                active={activePage === index + 1}
                onClick={() => goToPage(index + 1)}
              />
            ))}
          </div>
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <strong>{pdfBytes ? fileName : "No PDF loaded"}</strong>
            <span>{status}</span>
          </div>
          <div className="topActions">
            <button onClick={() => rotateActivePage(-1)} disabled={!pdfBytes} title="Rotate page left">
              <RotateCcw size={17} />
            </button>
            <button onClick={() => rotateActivePage(1)} disabled={!pdfBytes} title="Rotate page right">
              <RotateCw size={17} />
            </button>
            <button onClick={undo} disabled={!historyRef.current.length} title="Undo">
              <Undo2 size={17} />
            </button>
            <button onClick={redo} disabled={!redoRef.current.length} title="Redo">
              <Redo2 size={17} />
            </button>
            <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.45, 2.5))} title="Zoom out">
              <ZoomOut size={17} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.45, 2.5))} title="Zoom in">
              <ZoomIn size={17} />
            </button>
          </div>
        </header>

        <div className={pdfDoc ? "documentScroller" : "documentScroller empty"} onWheelCapture={onDocumentWheel}>
          {!pdfDoc && (
            <label className="dropzone">
              <Upload size={34} />
              <strong>Open a PDF to begin editing</strong>
              <span>Files, signatures, and saved output stay local on this computer.</span>
              <input
                hidden
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadPdf(file);
                }}
              />
            </label>
          )}

          {pdfDoc &&
            pageSizes.map((pageSize, index) => (
              <PdfPage
                key={index}
                doc={pdfDoc}
                pageIndex={index}
                pageSize={pageSize}
                zoom={zoom}
                active={activePage === index + 1}
                annotations={annotations.filter((annotation) => annotation.page === index + 1)}
                textZones={textZones.filter((zone) => zone.page === index + 1)}
                formZones={formZones.filter((zone) => zone.page === index + 1)}
                lineZones={lineZones.filter((zone) => zone.page === index + 1)}
                showTextZones={tool === "editText"}
                showFillZones={tool === "text" || tool === "field"}
                selectedId={selectedId}
                editingId={editingId}
                draftBox={draftBox?.page === index + 1 ? draftBox : null}
                placementPreview={placementPreview?.page === index + 1 ? placementPreview : null}
                imagePlacementPreview={imagePlacementPreview?.page === index + 1 ? imagePlacementPreview : null}
                eraserPreview={eraserPreview?.page === index + 1 ? eraserPreview : null}
                eraserSize={eraserSize}
                eraserOpacity={eraserOpacity}
                onPageRef={(node) => {
                  pageRefs.current[index + 1] = node;
                }}
                onPointerDown={handlePagePointerDown}
                onPointerMove={handlePagePointerMove}
                onPointerUp={finishPagePointer}
                onAnnotationDrag={startAnnotationDrag}
                onRemove={removeAnnotation}
                onSelect={(id) => {
                  setSelectedId(id);
                  setEditingId(null);
                }}
                onEdit={(id) => {
                  setSelectedId(id);
                  setEditingId(id);
                }}
                onUpdate={updateAnnotation}
                onActive={() => setActivePage(index + 1)}
              />
            ))}
        </div>
      </section>

      <aside className="inspector">
        <section>
          <h2>Selected</h2>
          {!selected && <p className="muted">Choose a tool, then click the PDF. Text starts typing immediately.</p>}
          {selected && (
            <SelectedInspector
              annotation={selected}
              update={(patch) => updateAnnotation(selected.id, patch)}
              remove={() => removeAnnotation(selected.id)}
            />
          )}
        </section>

        <section>
          <h2>Signatures</h2>
          <button className="wideButton" onClick={() => setSignatureModal("signature")}>
            <Plus size={18} />
            Add Signature
          </button>
          <button className="wideButton" onClick={() => setSignatureModal("initials")}>
            <Plus size={18} />
            Add Initials
          </button>
          <label>Signature</label>
          <select value={activeSignature} onChange={(event) => setActiveSignature(event.target.value)}>
            <option value="">None saved</option>
            {selectedSignatureAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
          </select>
          <label>Initials</label>
          <select value={activeInitials} onChange={(event) => setActiveInitials(event.target.value)}>
            <option value="">None saved</option>
            {selectedInitialAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
          </select>
        </section>

        <section>
          <h2>Prefill</h2>
          <textarea
            value={prefillText}
            onChange={(event) => setPrefillText(event.target.value)}
            placeholder={"Name = Alex Smith\nAddress = 10 Main Street\nApproved = yes"}
          />
          <button className="wideButton" disabled={!pdfBytes} onClick={applyPrefill}>
            <Wand2 size={18} />
            Populate
          </button>
        </section>

        <section>
          <h2>Style</h2>
          <label>Text color</label>
          <ColorRow value={textColor} onChange={setTextColor} />
          <label>Ink color</label>
          <ColorRow value={drawColor} onChange={setDrawColor} />
          <label>Ink width</label>
          <input type="range" min="1" max="12" value={drawWidth} onChange={(event) => setDrawWidth(Number(event.target.value))} />
        </section>

        {isDesktop && (
          <section>
            <h2>Desktop</h2>
            <div className="versionBadge">
              <span>Installed version</span>
              <strong>{appVersion}</strong>
            </div>
            <label className="checkRow">
              <input
                type="checkbox"
                checked={startupEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setStartupEnabled(enabled);
                  void window.pdfFillerDesktop?.setStartupEnabled(enabled).then(setStartupEnabled);
                }}
              />
              Start with Windows
            </label>
            <button className="wideButton" onClick={() => void window.pdfFillerDesktop?.openDefaultAppSettings()}>
              <Settings size={18} />
              Default Apps
            </button>
            <label className="checkRow">
              <input
                type="checkbox"
                checked={updatesEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setUpdatesEnabled(enabled);
                  void window.pdfFillerDesktop?.setUpdateSettings({ enabled });
                }}
              />
              Check for updates on startup
            </label>
            <label>Update source</label>
            <select
              value={updateProvider}
              onChange={(event) => {
                const provider = event.target.value as "github" | "generic";
                setUpdateProvider(provider);
                void window.pdfFillerDesktop?.setUpdateSettings({ provider });
              }}
            >
              <option value="github">GitHub Releases</option>
              <option value="generic">Website folder</option>
            </select>
            {updateProvider === "github" ? (
              <>
                <label>GitHub repo</label>
                <input
                  value={githubRepo}
                  onChange={(event) => setGithubRepo(event.target.value)}
                  onBlur={() => void window.pdfFillerDesktop?.setUpdateSettings({ githubRepo: githubRepo.trim() })}
                  placeholder="your-github-name/pdf-filler"
                />
              </>
            ) : (
              <>
                <label>Update feed URL</label>
                <input
                  value={updateFeedUrl}
                  onChange={(event) => setUpdateFeedUrl(event.target.value)}
                  onBlur={() => void window.pdfFillerDesktop?.setUpdateSettings({ feedUrl: updateFeedUrl.trim() })}
                  placeholder="https://your-site.com/pdf-filler-updates/"
                />
              </>
            )}
            <button
              className="wideButton"
              onClick={() => {
                void window.pdfFillerDesktop?.setUpdateSettings({
                  enabled: updatesEnabled,
                  provider: updateProvider,
                  githubRepo: githubRepo.trim(),
                  feedUrl: updateFeedUrl.trim(),
                }).then(() => {
                  setShowUpdateGate(true);
                  void window.pdfFillerDesktop?.checkForUpdates();
                });
              }}
            >
              <RefreshCw size={18} />
              Check Updates
            </button>
            <p className="muted">{updateStatus}</p>
          </section>
        )}

      </aside>

      {signatureModal && (
        <SignatureModal
          kind={signatureModal}
          onClose={() => setSignatureModal(null)}
          onSave={(asset) => {
            setAssets((current) => [...current, asset]);
            if (asset.kind === "signature") setActiveSignature(asset.id);
            if (asset.kind === "initials") setActiveInitials(asset.id);
            setSignatureModal(null);
          }}
        />
      )}
      </main>
      {mergeOpen && (
        <MergeModal
          onClose={() => setMergeOpen(false)}
          onMerge={(files) => void mergePdfFiles(files)}
        />
      )}
      {splitOpen && (
        <SplitPdfModal
          onClose={() => setSplitOpen(false)}
          onSplit={(file, ranges) => void splitPdfFile(file, ranges)}
        />
      )}
      {removePagesOpen && (
        <RemovePagesModal
          onClose={() => setRemovePagesOpen(false)}
          onRemove={(file, pages, openAfterSave) => void removePagesFromFile(file, pages, openAfterSave)}
        />
      )}
      {extractPagesOpen && (
        <ExtractPagesModal
          onClose={() => setExtractPagesOpen(false)}
          onExtract={(file, pages) => void extractPagesFromFile(file, pages)}
        />
      )}
      {isDesktop && showUpdateGate && (
        <UpdateGate
          appVersion={appVersion}
          state={updateState}
          onUpdate={() => void window.pdfFillerDesktop?.downloadUpdate()}
          onContinue={enterEditor}
        />
      )}
    </div>
  );
}

function UpdateGate({
  appVersion,
  state,
  onUpdate,
  onContinue,
}: {
  appVersion: string;
  state: DesktopUpdateState;
  onUpdate: () => void;
  onContinue: () => void;
}) {
  const canUpdate = state.phase === "available";
  const canContinue = ["available", "error", "disabled", "development"].includes(state.phase);
  const busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "downloaded";
  const title =
    state.phase === "available"
      ? `PDF Filler ${state.version} is available`
      : state.phase === "downloading"
        ? "Downloading update"
        : state.phase === "downloaded"
          ? "Installing update"
          : state.phase === "error"
            ? "Update check needs attention"
            : state.phase === "not-available"
              ? "PDF Filler is up to date"
              : "Checking for updates";

  return (
    <div className="updateGate" role="dialog" aria-modal="true">
      <section className="updatePanel">
        <div className="updateLogo">
          <span className="brandMark">PF</span>
          <div>
            <strong>PDF Filler</strong>
            <span>Installed v{appVersion}</span>
          </div>
        </div>
        <h1>{title}</h1>
        <p>{state.status}</p>
        {(state.phase === "downloading" || state.phase === "downloaded") && (
          <div className="updateProgress" aria-label="Download progress">
            <span style={{ width: `${state.phase === "downloaded" ? 100 : state.percent}%` }} />
          </div>
        )}
        <div className="updateActions">
          {canUpdate && <button className="primaryAction" onClick={onUpdate}>Update now</button>}
          {canContinue && <button onClick={onContinue}>{state.phase === "available" ? "Later" : "Continue"}</button>}
          {busy && <span className="updateSpinner" />}
        </div>
      </section>
    </div>
  );
}

function PdfPage({
  doc,
  pageIndex,
  pageSize,
  zoom,
  active,
  annotations,
  textZones,
  formZones,
  lineZones,
  showTextZones,
  showFillZones,
  selectedId,
  editingId,
  draftBox,
  placementPreview,
  imagePlacementPreview,
  eraserPreview,
  eraserSize,
  eraserOpacity,
  onPageRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onAnnotationDrag,
  onRemove,
  onSelect,
  onEdit,
  onUpdate,
  onActive,
}: {
  doc: any;
  pageIndex: number;
  pageSize: PageSize;
  zoom: number;
  active: boolean;
  annotations: Annotation[];
  textZones: TextZone[];
  formZones: FormZone[];
  lineZones: LineZone[];
  showTextZones: boolean;
  showFillZones: boolean;
  selectedId: string | null;
  editingId: string | null;
  draftBox: DraftBox | null;
  placementPreview: { page: number; x: number; y: number; tool: Tool } | null;
  imagePlacementPreview: { page: number; x: number; y: number; w: number; h: number; dataUrl: string; label: string } | null;
  eraserPreview: { page: number; x: number; y: number } | null;
  eraserSize: number;
  eraserOpacity: number;
  onPageRef: (node: HTMLElement | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, pageIndex: number) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onAnnotationDrag: (event: React.PointerEvent, annotation: Annotation, pageSize: PageSize, mode: "move" | "resize") => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onActive: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, zoom]);

  const displayWidth = pageSize.width * zoom;
  const displayHeight = pageSize.height * zoom;

  return (
    <article ref={onPageRef} className={active ? "pageWrap active" : "pageWrap"} onPointerEnter={onActive}>
      <div className="pageNumber">Page {pageIndex + 1}</div>
      <div
        className="page"
        data-page={pageIndex + 1}
        style={{ width: displayWidth, height: displayHeight }}
        onPointerDown={(event) => onPointerDown(event, pageIndex)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} style={{ width: displayWidth, height: displayHeight }} />
        <div className="annotationLayer">
          {showFillZones && formZones.map((zone) => <div key={zone.id} className="formZone" style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` }} title={zone.name} />)}
          {showFillZones && lineZones.map((zone) => <div key={zone.id} className="lineZone" style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` }} title="Click to fill" />)}
          {showTextZones && textZones.map((zone) => <div key={zone.id} className="textZone" style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` }} />)}
          {annotations.map((annotation) => (
            <AnnotationView
              key={annotation.id}
              annotation={annotation}
              selected={selectedId === annotation.id}
              editing={editingId === annotation.id}
              pageSize={pageSize}
              zoom={zoom}
              onDrag={onAnnotationDrag}
              onRemove={onRemove}
              onSelect={onSelect}
              onEdit={onEdit}
              onUpdate={onUpdate}
            />
          ))}
          {draftBox && (
            <div
              className={`draftBox ${draftBox.type}`}
              style={{
                left: `${Math.min(draftBox.x, draftBox.x + draftBox.w) * 100}%`,
                top: `${Math.min(draftBox.y, draftBox.y + draftBox.h) * 100}%`,
                width: `${Math.abs(draftBox.w) * 100}%`,
                height: `${Math.abs(draftBox.h) * 100}%`,
              }}
            />
          )}
          {placementPreview && (
            <div
              className={`placementPreview ${placementPreview.tool}`}
              style={{
                left: `${(placementPreview.x - 0.017) * 100}%`,
                top: `${(placementPreview.y - 0.017) * 100}%`,
                width: "3.4%",
                height: "3.4%",
              }}
            >
              {placementPreview.tool === "radio" ? "o" : placementPreview.tool === "checkbox" ? "☑" : "✓"}
            </div>
          )}
          {imagePlacementPreview && (
            <img
              className="imagePlacementPreview"
              src={imagePlacementPreview.dataUrl}
              alt={imagePlacementPreview.label}
              style={{
                left: `${(imagePlacementPreview.x - imagePlacementPreview.w / 2) * 100}%`,
                top: `${(imagePlacementPreview.y - imagePlacementPreview.h / 2) * 100}%`,
                width: `${imagePlacementPreview.w * 100}%`,
                height: `${imagePlacementPreview.h * 100}%`,
              }}
            />
          )}
          {eraserPreview && (
            <div
              className="eraserPreview"
              style={{
                left: eraserPreview.x * displayWidth - eraserSize / 2,
                top: eraserPreview.y * displayHeight - eraserSize / 2,
                width: eraserSize,
                height: eraserSize,
                opacity: eraserOpacity,
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function AnnotationView({
  annotation,
  selected,
  editing,
  pageSize,
  zoom,
  onDrag,
  onRemove,
  onSelect,
  onEdit,
  onUpdate,
}: {
  annotation: Annotation;
  selected: boolean;
  editing: boolean;
  pageSize: PageSize;
  zoom: number;
  onDrag: (event: React.PointerEvent, annotation: Annotation, pageSize: PageSize, mode: "move" | "resize") => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    if ("select" in inputRef.current!) inputRef.current?.select();
  }, [editing]);

  if (annotation.type === "draw") {
    const path = annotation.points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x * pageSize.width * zoom} ${point.y * pageSize.height * zoom}`)
      .join(" ");
    return (
      <svg className="drawLayer" viewBox={`0 0 ${pageSize.width * zoom} ${pageSize.height * zoom}`}>
        <path
          d={path}
          fill="none"
          stroke={annotation.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={annotation.width}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelect(annotation.id);
          }}
        />
      </svg>
    );
  }

  const style = {
    left: `${annotation.x * 100}%`,
    top: `${annotation.y * 100}%`,
    width: `${annotation.w * 100}%`,
    height: `${annotation.h * 100}%`,
    transform: annotation.type === "watermark" && !annotation.repeat ? `rotate(${annotation.rotation ?? -35}deg)` : undefined,
    transformOrigin: annotation.type === "watermark" ? "center" : undefined,
  };
  const watermarkCopies = Array.from({ length: 24 });

  return (
    <div
      className={`annotation ${annotation.type} ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}
      style={style}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEdit(annotation.id);
      }}
      onPointerDown={(event) => onDrag(event, annotation, pageSize, "move")}
    >
      {isTextAnnotation(annotation) && annotation.type === "watermark" && annotation.repeat && (
        <div
          className="watermarkRepeat"
          style={{
            color: annotation.color,
            fontSize: annotation.fontSize * zoom,
            fontWeight: annotation.bold ? 700 : 400,
            opacity: annotation.opacity ?? 0.22,
          }}
        >
          {watermarkCopies.map((_, index) => (
            <span key={index} style={{ transform: `rotate(${annotation.rotation ?? -35}deg)` }}>
              {annotation.text || "WATERMARK"}
            </span>
          ))}
        </div>
      )}
      {isTextAnnotation(annotation) && !(annotation.type === "watermark" && annotation.repeat) && (
        editing ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="liveTextInput"
            value={annotation.text}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(annotation.id, { text: event.target.value })}
            onBlur={() => undefined}
            style={{ color: annotation.color, fontSize: annotation.fontSize * zoom, fontWeight: annotation.bold ? 700 : 400, background: annotation.background ?? "transparent", opacity: annotation.type === "watermark" ? annotation.opacity ?? 0.22 : 1 }}
          />
        ) : (
          <div className="textAnnotation" style={{ color: annotation.color, fontSize: annotation.fontSize * zoom, fontWeight: annotation.bold ? 700 : 400, background: annotation.background, opacity: annotation.type === "watermark" ? annotation.opacity ?? 0.22 : 1 }}>
            {annotation.text || "Type here"}
          </div>
        )
      )}
      {annotation.type === "field" && (
        editing ? (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="liveTextInput"
            value={annotation.value}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(annotation.id, { value: event.target.value })}
          />
        ) : (
          <div className="fieldAnnotation">{annotation.value || annotation.name}</div>
        )
      )}
      {isImageAnnotation(annotation) && <img src={annotation.dataUrl} alt={annotation.label} draggable={false} />}
      {isRectAnnotation(annotation) && (
        <div
          className={`rectAnnotation ${annotation.type}`}
          style={{
            background: annotation.filled ?? !annotation.stroke ? hexToRgba(annotation.fillColor ?? annotation.color, annotation.fillOpacity ?? annotation.opacity) : "transparent",
            borderColor: hexToRgba(annotation.strokeColor ?? annotation.color, annotation.strokeOpacity ?? annotation.opacity),
            borderWidth: annotation.outlined ?? Boolean(annotation.stroke) ? annotation.strokeWidth ?? 2 : 0,
          }}
        />
      )}
      {isChoiceAnnotation(annotation) && (
        <span className="checkmark">
          {annotation.type === "radio" ? (annotation.checked ? "o" : "") : annotation.checked ? (annotation.mark === "check" ? "✓" : "X") : ""}
        </span>
      )}
      {(annotation.type === "arrow" || annotation.type === "line") && <ArrowOverlay color={annotation.color} width={annotation.width} arrow={annotation.type === "arrow"} />}
      {annotation.type === "table" && (
        <TableOverlay
          rows={annotation.rows}
          cols={annotation.cols}
          color={annotation.color}
          cells={annotation.cells ?? []}
          editable={selected}
          onCellChange={(index, value) => {
            const cells = Array.from({ length: annotation.rows * annotation.cols }, (_, cellIndex) => annotation.cells?.[cellIndex] ?? "");
            cells[index] = value;
            onUpdate(annotation.id, { cells });
          }}
        />
      )}
      {selected && (
        <>
          <button className="deleteBubble" onClick={(event) => { event.stopPropagation(); onRemove(annotation.id); }} title="Delete"><Trash2 size={13} /></button>
          <button className="resizeHandle" onPointerDown={(event) => onDrag(event, annotation, pageSize, "resize")} title="Resize" />
        </>
      )}
    </div>
  );
}

function ArrowOverlay({ color, width, arrow = true }: { color: string; width: number; arrow?: boolean }) {
  return (
    <svg className="shapeOverlay" viewBox="0 0 100 40" preserveAspectRatio="none">
      <line x1="4" y1="34" x2="92" y2="6" stroke={color} strokeWidth={width} />
      {arrow && <polyline points="78,4 92,6 83,18" fill="none" stroke={color} strokeWidth={width} />}
    </svg>
  );
}

function TableOverlay({ rows, cols, color, cells, editable, onCellChange }: { rows: number; cols: number; color: string; cells: string[]; editable: boolean; onCellChange: (index: number, value: string) => void }) {
  return (
    <div className="tableOverlay" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {Array.from({ length: rows * cols }).map((_, index) => (
        <span key={index} style={{ borderColor: color }}>
          {editable ? (
            <input value={cells[index] ?? ""} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onCellChange(index, event.target.value)} />
          ) : (
            cells[index] ?? ""
          )}
        </span>
      ))}
    </div>
  );
}

function Thumbnail({ doc, page, pageSize, active, onClick }: { doc: any; page: number; pageSize: PageSize; active: boolean; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const pdfPage = await doc.getPage(page);
      const scale = 110 / pageSize.width;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [doc, page, pageSize.width]);
  return (
    <button className={active ? "thumbnail active" : "thumbnail"} onClick={onClick}>
      <canvas ref={canvasRef} />
      <span>{page}</span>
    </button>
  );
}

function SelectedInspector({ annotation, update, remove }: { annotation: Annotation; update: (patch: Partial<Annotation>) => void; remove: () => void }) {
  return (
    <div className="selectedTools">
      <span className="pill">{annotation.type}</span>
      {isTextAnnotation(annotation) && (
        <>
          <label>Text</label>
          <textarea value={annotation.text} onChange={(event) => update({ text: event.target.value })} />
          <label>Size</label>
          <input type="number" min="7" max="96" value={annotation.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} />
          <label className="checkRow"><input type="checkbox" checked={annotation.bold} onChange={(event) => update({ bold: event.target.checked })} /> Bold</label>
          <ColorRow value={annotation.color} onChange={(color) => update({ color })} />
          {annotation.type === "watermark" && (
            <>
              <label>Opacity</label>
              <input type="range" min="0.05" max="0.75" step="0.01" value={annotation.opacity ?? 0.22} onChange={(event) => update({ opacity: Number(event.target.value) })} />
              <label>Angle</label>
              <input type="number" min="-90" max="90" value={annotation.rotation ?? -35} onChange={(event) => update({ rotation: Number(event.target.value) })} />
              <label className="checkRow">
                <input
                  type="checkbox"
                  checked={annotation.repeat ?? false}
                  onChange={(event) => update(event.target.checked ? { repeat: true, x: 0, y: 0, w: 1, h: 1 } : { repeat: false, x: 0.18, y: 0.42, w: 0.64, h: 0.14 })}
                />
                Repeat across page
              </label>
            </>
          )}
        </>
      )}
      {annotation.type === "field" && (
        <>
          <label>Field name</label>
          <input value={annotation.name} onChange={(event) => update({ name: event.target.value })} />
          <label>Value</label>
          <input value={annotation.value} onChange={(event) => update({ value: event.target.value })} />
        </>
      )}
      {isRectAnnotation(annotation) && (
        <>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={annotation.filled ?? !annotation.stroke}
              onChange={(event) => update({ filled: event.target.checked })}
            />
            Fill
          </label>
          <ColorRow value={annotation.fillColor ?? annotation.color} onChange={(fillColor) => update({ fillColor })} />
          <label>Fill opacity</label>
          <input type="range" min="0.1" max="1" step="0.05" value={annotation.fillOpacity ?? annotation.opacity} onChange={(event) => update({ fillOpacity: Number(event.target.value), opacity: Number(event.target.value) })} />
          <label className="checkRow">
            <input
              type="checkbox"
              checked={annotation.outlined ?? Boolean(annotation.stroke)}
              onChange={(event) => update({ outlined: event.target.checked })}
            />
            Outline
          </label>
          <ColorRow value={annotation.strokeColor ?? annotation.color} onChange={(strokeColor) => update({ strokeColor })} />
          <label>Outline opacity</label>
          <input type="range" min="0.1" max="1" step="0.05" value={annotation.strokeOpacity ?? annotation.opacity} onChange={(event) => update({ strokeOpacity: Number(event.target.value) })} />
          <label>Outline width</label>
          <input type="number" min="0" max="20" value={annotation.strokeWidth ?? 2} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} />
        </>
      )}
      {isChoiceAnnotation(annotation) && (
        <>
          <label className="checkRow"><input type="checkbox" checked={annotation.checked} onChange={(event) => update({ checked: event.target.checked })} /> Checked</label>
          {annotation.type !== "radio" && (
            <>
              <label>Mark</label>
              <select value={annotation.mark ?? "x"} onChange={(event) => update({ mark: event.target.value as "check" | "x" })}>
                <option value="check">Tick</option>
                <option value="x">X</option>
              </select>
            </>
          )}
        </>
      )}
      {annotation.type === "table" && (
        <>
          <label>Rows</label>
          <input type="number" min="1" max="20" value={annotation.rows} onChange={(event) => {
            const rows = Number(event.target.value);
            update({ rows, cells: Array.from({ length: rows * annotation.cols }, (_, index) => annotation.cells?.[index] ?? "") });
          }} />
          <label>Columns</label>
          <input type="number" min="1" max="12" value={annotation.cols} onChange={(event) => {
            const cols = Number(event.target.value);
            update({ cols, cells: Array.from({ length: annotation.rows * cols }, (_, index) => annotation.cells?.[index] ?? "") });
          }} />
        </>
      )}
      <button className="wideButton danger" onClick={remove}><Trash2 size={18} /> Delete Item</button>
    </div>
  );
}

function ColorRow({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="colorRow">
      {Object.values(palette).map((color) => (
        <button key={color} className={value === color ? "swatch active" : "swatch"} style={{ background: color }} onClick={() => onChange(color)} title={color} />
      ))}
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ToolContextMenu({
  menu,
  drawColor,
  drawWidth,
  eraserSize,
  eraserOpacity,
  shapeFillColor,
  shapeStrokeColor,
  shapeFillOpacity,
  shapeStrokeOpacity,
  shapeStrokeWidth,
  onClose,
  onDrawColor,
  onDrawWidth,
  onEraserSize,
  onEraserOpacity,
  onShapeFillColor,
  onShapeStrokeColor,
  onShapeFillOpacity,
  onShapeStrokeOpacity,
  onShapeStrokeWidth,
}: {
  menu: { tool: Tool; x: number; y: number };
  drawColor: string;
  drawWidth: number;
  eraserSize: number;
  eraserOpacity: number;
  shapeFillColor: string;
  shapeStrokeColor: string;
  shapeFillOpacity: number;
  shapeStrokeOpacity: number;
  shapeStrokeWidth: number;
  onClose: () => void;
  onDrawColor: (value: string) => void;
  onDrawWidth: (value: number) => void;
  onEraserSize: (value: number) => void;
  onEraserOpacity: (value: number) => void;
  onShapeFillColor: (value: string) => void;
  onShapeStrokeColor: (value: string) => void;
  onShapeFillOpacity: (value: number) => void;
  onShapeStrokeOpacity: (value: number) => void;
  onShapeStrokeWidth: (value: number) => void;
}) {
  const isDraw = menu.tool === "draw";
  const isEraser = menu.tool === "eraser";

  return (
    <div className="toolContextMenu" style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
      <header>
        <strong>{menu.tool === "draw" ? "Pencil" : menu.tool === "eraser" ? "Eraser" : "Shape"} options</strong>
        <button onClick={onClose}>x</button>
      </header>
      {isDraw && (
        <>
          <label>Color</label>
          <ColorRow value={drawColor} onChange={onDrawColor} />
          <label>Width</label>
          <input type="range" min="1" max="18" value={drawWidth} onChange={(event) => onDrawWidth(Number(event.target.value))} />
        </>
      )}
      {isEraser && (
        <>
          <label>Size</label>
          <input type="range" min="8" max="90" value={eraserSize} onChange={(event) => onEraserSize(Number(event.target.value))} />
          <label>Preview opacity</label>
          <input type="range" min="0.08" max="0.55" step="0.01" value={eraserOpacity} onChange={(event) => onEraserOpacity(Number(event.target.value))} />
        </>
      )}
      {!isDraw && !isEraser && (
        <>
          <label>Fill color</label>
          <ColorRow value={shapeFillColor} onChange={onShapeFillColor} />
          <label>Fill opacity</label>
          <input type="range" min="0" max="1" step="0.05" value={shapeFillOpacity} onChange={(event) => onShapeFillOpacity(Number(event.target.value))} />
          <label>Outline color</label>
          <ColorRow value={shapeStrokeColor} onChange={onShapeStrokeColor} />
          <label>Outline opacity</label>
          <input type="range" min="0" max="1" step="0.05" value={shapeStrokeOpacity} onChange={(event) => onShapeStrokeOpacity(Number(event.target.value))} />
          <label>Outline width</label>
          <input type="range" min="1" max="12" value={shapeStrokeWidth} onChange={(event) => onShapeStrokeWidth(Number(event.target.value))} />
        </>
      )}
    </div>
  );
}

function MergeModal({ onClose, onMerge }: { onClose: () => void; onMerge: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.click();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadCounts = async () => {
      const entries: Record<string, number> = {};
      for (const file of files) {
        try {
          const doc = await getDocument({ data: (await file.arrayBuffer()).slice(0) }).promise;
          entries[file.name] = doc.numPages;
        } catch {
          entries[file.name] = 0;
        }
      }
      if (!cancelled) setPageCounts(entries);
    };
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [files]);

  const moveFile = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= files.length) return;
    setFiles((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="mergeModal">
        <header>
          <div>
            <h2>Merge PDFs</h2>
            <p className="muted">Files are merged in this order. The next PDF starts after the previous PDF's last page.</p>
          </div>
          <div className="modalActions">
            <button onClick={onClose}>Cancel</button>
            <button className="primaryAction" disabled={files.length < 2} onClick={() => onMerge(files)}>
              Merge
            </button>
          </div>
        </header>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="application/pdf"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <button className="wideButton" onClick={() => inputRef.current?.click()}>
          <Plus size={18} />
          Add PDFs
        </button>
        <div className="mergeList">
          {files.map((file, index) => (
            <div className="mergeRow" key={`${file.name}-${file.lastModified}`}>
              <span className="dragDots">::::</span>
              <FileText size={28} />
              <div>
                <strong>{file.name}</strong>
                <span>{pageCounts[file.name] ? `1-${pageCounts[file.name]} pages` : "Reading pages..."}</span>
              </div>
              <button onClick={() => moveFile(index, -1)} disabled={index === 0}>Up</button>
              <button onClick={() => moveFile(index, 1)} disabled={index === files.length - 1}>Down</button>
              <button className="iconDanger" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          {!files.length && <p className="muted">Choose two or more PDFs.</p>}
        </div>
      </div>
    </div>
  );
}

function ToolPdfThumbnail({ doc, page, selected, onClick }: { doc: any; page: number; selected?: boolean; onClick?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const pdfPage = await doc.getPage(page);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const scale = 118 / viewport.width;
      const scaled = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context || cancelled) return;
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      await pdfPage.render({ canvasContext: context, viewport: scaled, background: "#ffffff" }).promise;
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  return (
    <button className={selected ? "toolPageThumb selected" : "toolPageThumb"} onClick={onClick} type="button">
      <canvas ref={canvasRef} />
      <span>Page {page}</span>
    </button>
  );
}

function SplitPdfModal({ onClose, onSplit }: { onClose: () => void; onSplit: (file: File, ranges: PageRange[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<"fixed" | "custom">("fixed");
  const [fixedSize, setFixedSize] = useState(1);
  const [customInput, setCustomInput] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.click();
  }, []);

  const loadFile = async (nextFile: File | null) => {
    setError("");
    setFile(nextFile);
    setDoc(null);
    setPageCount(0);
    if (!nextFile) return;
    try {
      const pdf = await getDocument({ data: (await nextFile.arrayBuffer()).slice(0) }).promise;
      setDoc(pdf);
      setPageCount(pdf.numPages);
      setFixedSize(1);
      setCustomInput(`1-${pdf.numPages}`);
    } catch {
      setError("That PDF could not be opened.");
    }
  };

  const splitPlan = useMemo(() => {
    if (!pageCount) return { ranges: [], error: "" };
    try {
      return { ranges: mode === "fixed" ? fixedRanges(pageCount, fixedSize) : rangesFromInput(customInput, pageCount), error: "" };
    } catch (err) {
      return { ranges: [], error: err instanceof Error ? err.message : "Check your ranges." };
    }
  }, [customInput, fixedSize, mode, pageCount]);
  const ranges = splitPlan.ranges;

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="toolWorkflowModal">
        <header>
          <div>
            <h2>Split PDF file</h2>
            <p className="muted">Separate one PDF into independent files using fixed page chunks or custom ranges.</p>
          </div>
          <div className="modalActions">
            <button onClick={onClose}>Cancel</button>
            <button className="primaryAction" disabled={!file || !ranges.length} onClick={() => file && onSplit(file, ranges)}>
              Split PDF
            </button>
          </div>
        </header>

        <input ref={inputRef} hidden type="file" accept="application/pdf" onChange={(event) => void loadFile(event.target.files?.[0] ?? null)} />

        {!file && (
          <div className="fileDropPanel">
            <Scissors size={44} />
            <button className="primaryAction" onClick={() => inputRef.current?.click()}>Select PDF file</button>
            <span>Choose a PDF to split</span>
          </div>
        )}

        {file && doc && (
          <div className="toolWorkflowGrid">
            <section className="toolPreviewArea">
              <div className="workflowTitleRow">
                <strong>{file.name}</strong>
                <button className="wideButton" onClick={() => inputRef.current?.click()}>Choose different PDF</button>
              </div>
              <div className="splitRangePreview">
                {ranges.map((range, index) => (
                  <div className="rangeGroup" key={`${range.start}-${range.end}-${index}`}>
                    <strong>Range {index + 1}</strong>
                    <div className="rangeThumbs">
                      <ToolPdfThumbnail doc={doc} page={range.start} />
                      {range.end !== range.start && <span className="rangeDots">...</span>}
                      {range.end !== range.start && <ToolPdfThumbnail doc={doc} page={range.end} />}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="toolSidePanel">
              <h3>Split</h3>
              <div className="segmented">
                <button className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>Custom</button>
                <button className={mode === "fixed" ? "active" : ""} onClick={() => setMode("fixed")}>Fixed</button>
              </div>
              {mode === "fixed" ? (
                <label className="fieldStack">
                  <span>Split into page ranges of</span>
                  <input min={1} max={pageCount} type="number" value={fixedSize} onChange={(event) => setFixedSize(clamp(Number(event.target.value) || 1, 1, pageCount))} />
                </label>
              ) : (
                <label className="fieldStack">
                  <span>Custom ranges</span>
                  <input value={customInput} onChange={(event) => setCustomInput(event.target.value)} placeholder="example: 1-3,4-6" />
                </label>
              )}
              <div className="infoPanel">
                This PDF will be split into files of {mode === "fixed" ? `${fixedSize} page${fixedSize === 1 ? "" : "s"}` : "your selected ranges"}.
                <strong>{ranges.length} PDF{ranges.length === 1 ? "" : "s"} will be created.</strong>
              </div>
              {(error || splitPlan.error) && <p className="errorText">{error || splitPlan.error}</p>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function ExtractPagesModal({ onClose, onExtract }: { onClose: () => void; onExtract: (file: File, pages: number[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.click();
  }, []);

  const loadFile = async (nextFile: File | null) => {
    setError("");
    setFile(nextFile);
    setDoc(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setRangeInput("");
    if (!nextFile) return;
    try {
      const pdf = await getDocument({ data: (await nextFile.arrayBuffer()).slice(0) }).promise;
      setDoc(pdf);
      setPageCount(pdf.numPages);
    } catch {
      setError("That PDF could not be opened.");
    }
  };

  const togglePage = (page: number) => {
    setSelectedPages((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const applyRange = () => {
    try {
      setSelectedPages(pageNumbersFromRangeInput(rangeInput, pageCount));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check your page range.");
    }
  };

  const selected = Array.from(selectedPages).sort((a, b) => a - b);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="toolWorkflowModal">
        <header>
          <div>
            <h2>Extract PDF pages</h2>
            <p className="muted">Choose the pages to save into a separate PDF.</p>
          </div>
          <div className="modalActions">
            <button onClick={onClose}>Cancel</button>
            <button className="primaryAction" disabled={!file || selected.length === 0} onClick={() => file && onExtract(file, selected)}>
              Extract pages
            </button>
          </div>
        </header>

        <input ref={inputRef} hidden type="file" accept="application/pdf" onChange={(event) => void loadFile(event.target.files?.[0] ?? null)} />

        {!file && (
          <div className="fileDropPanel">
            <FilePlus2 size={44} />
            <button className="primaryAction" onClick={() => inputRef.current?.click()}>Select PDF file</button>
            <span>Choose a PDF to extract pages from</span>
          </div>
        )}

        {file && doc && (
          <div className="toolWorkflowGrid">
            <section className="toolPreviewArea">
              <div className="workflowTitleRow">
                <strong>{file.name}</strong>
                <button className="wideButton" onClick={() => inputRef.current?.click()}>Choose different PDF</button>
              </div>
              <div className="removePageGrid">
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                  <ToolPdfThumbnail key={page} doc={doc} page={page} selected={selectedPages.has(page)} onClick={() => togglePage(page)} />
                ))}
              </div>
            </section>

            <aside className="toolSidePanel">
              <h3>Extract pages</h3>
              <div className="infoPanel compact">Click the pages you want in the new PDF.</div>
              <p className="toolMeta">Total pages: {pageCount}</p>
              <label className="fieldStack">
                <span>Pages to extract</span>
                <input value={rangeInput} onChange={(event) => setRangeInput(event.target.value)} placeholder="example: 1-3,8" />
              </label>
              <button className="wideButton" onClick={applyRange}>Use range</button>
              <button className="wideButton" onClick={() => setSelectedPages(new Set())}>Clear selection</button>
              <p className="toolMeta">{selected.length ? `${selected.length} selected: ${selected.join(", ")}` : "No pages selected."}</p>
              {error && <p className="errorText">{error}</p>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function RemovePagesModal({ onClose, onRemove }: { onClose: () => void; onRemove: (file: File, pages: number[], openAfterSave: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [openAfterSave, setOpenAfterSave] = useState(true);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.click();
  }, []);

  const loadFile = async (nextFile: File | null) => {
    setError("");
    setFile(nextFile);
    setDoc(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setRangeInput("");
    if (!nextFile) return;
    try {
      const pdf = await getDocument({ data: (await nextFile.arrayBuffer()).slice(0) }).promise;
      setDoc(pdf);
      setPageCount(pdf.numPages);
    } catch {
      setError("That PDF could not be opened.");
    }
  };

  const togglePage = (page: number) => {
    setSelectedPages((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  };

  const applyRange = () => {
    try {
      setSelectedPages(pageNumbersFromRangeInput(rangeInput, pageCount));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check your page range.");
    }
  };

  const selected = Array.from(selectedPages).sort((a, b) => a - b);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="toolWorkflowModal">
        <header>
          <div>
            <h2>Remove PDF pages</h2>
            <p className="muted">Select pages visually or enter a range such as 1-3,8.</p>
          </div>
          <div className="modalActions">
            <button onClick={onClose}>Cancel</button>
            <button className="primaryAction dangerAction" disabled={!file || selected.length === 0 || selected.length >= pageCount} onClick={() => file && onRemove(file, selected, openAfterSave)}>
              Remove pages
            </button>
          </div>
        </header>

        <input ref={inputRef} hidden type="file" accept="application/pdf" onChange={(event) => void loadFile(event.target.files?.[0] ?? null)} />

        {!file && (
          <div className="fileDropPanel">
            <Trash2 size={44} />
            <button className="primaryAction" onClick={() => inputRef.current?.click()}>Select PDF file</button>
            <span>Choose a PDF to edit</span>
          </div>
        )}

        {file && doc && (
          <div className="toolWorkflowGrid">
            <section className="toolPreviewArea">
              <div className="workflowTitleRow">
                <strong>{file.name}</strong>
                <button className="wideButton" onClick={() => inputRef.current?.click()}>Choose different PDF</button>
              </div>
              <div className="removePageGrid">
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                  <ToolPdfThumbnail key={page} doc={doc} page={page} selected={selectedPages.has(page)} onClick={() => togglePage(page)} />
                ))}
              </div>
            </section>

            <aside className="toolSidePanel">
              <h3>Remove pages</h3>
              <div className="infoPanel compact">Click pages to remove them from the document.</div>
              <p className="toolMeta">Total pages: {pageCount}</p>
              <label className="fieldStack">
                <span>Pages to remove</span>
                <input value={rangeInput} onChange={(event) => setRangeInput(event.target.value)} placeholder="example: 1-3,8" />
              </label>
              <button className="wideButton" onClick={applyRange}>Use range</button>
              <button className="wideButton" onClick={() => setSelectedPages(new Set())}>Clear selection</button>
              <label className="checkRow">
                <input type="checkbox" checked={openAfterSave} onChange={(event) => setOpenAfterSave(event.target.checked)} />
                Open saved PDF afterwards
              </label>
              <p className="toolMeta">{selected.length ? `${selected.length} selected: ${selected.join(", ")}` : "No pages selected."}</p>
              {selected.length >= pageCount && <p className="errorText">At least one page must remain.</p>}
              {error && <p className="errorText">{error}</p>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function SignatureModal({ kind, onSave, onClose }: { kind: "signature" | "initials"; onSave: (asset: SignatureAsset) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [label, setLabel] = useState(kind === "signature" ? "My signature" : "My initials");
  const [typed, setTyped] = useState("");
  const [selectedFont, setSelectedFont] = useState(signatureFonts[0].id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 640;
    canvas.height = 210;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.strokeStyle = "#111827";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width, y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height };
  };

  const drawTyped = (fontId = selectedFont) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !typed.trim()) return;
    const font = signatureFonts.find((item) => item.id === fontId) ?? signatureFonts[0];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111827";
    context.font = `${kind === "signature" ? 64 : 76}px ${font.family}`;
    context.fillText(typed.trim(), 42, 126);
  };

  const clear = () => {
    const context = canvasRef.current?.getContext("2d");
    if (canvasRef.current && context) context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="signatureModal">
        <header>
          <h2>{kind === "signature" ? "Create Signature" : "Create Initials"}</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <label>Name</label>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
        <label>Type or draw</label>
        <div className="typedRow">
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Type a name or initials" />
          <button onClick={() => drawTyped()}>Use Text</button>
        </div>
        <div className="signatureStyleGrid">
          {signatureFonts.map((font) => (
            <button
              key={font.id}
              className={selectedFont === font.id ? "signatureStyle active" : "signatureStyle"}
              onClick={() => {
                setSelectedFont(font.id);
                if (typed.trim()) drawTyped(font.id);
              }}
              type="button"
            >
              <span style={{ fontFamily: font.family }}>{typed.trim() || (kind === "signature" ? "Your signature" : "AB")}</span>
              <small>{font.label}</small>
            </button>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          className="signaturePad"
          onPointerDown={(event) => {
            drawingRef.current = true;
            const point = canvasPoint(event);
            const context = event.currentTarget.getContext("2d");
            context?.beginPath();
            context?.moveTo(point.x, point.y);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) return;
            const point = canvasPoint(event);
            const context = event.currentTarget.getContext("2d");
            context?.lineTo(point.x, point.y);
            context?.stroke();
          }}
          onPointerUp={() => { drawingRef.current = false; }}
          onPointerCancel={() => { drawingRef.current = false; }}
        />
        <footer>
          <button onClick={clear}>Clear</button>
          <button
            className="primaryAction"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              onSave({ id: uid(kind), kind, label: label.trim() || (kind === "signature" ? "Signature" : "Initials"), dataUrl: canvas.toDataURL("image/png") });
            }}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

export default App;
