import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
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
  PanelRight,
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
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { LineCapStyle, PDFCheckBox, PDFDocument, PDFRadioGroup, PDFTextField, clip, concatTransformationMatrix, degrees, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, StandardFonts } from "pdf-lib";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnnotationMode, GlobalWorkerOptions, Util, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import Tesseract from "tesseract.js";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { detectFillZones, nearbyCheckboxLabel, type DetectedFillZone, type FormTextRun } from "./formDetection";

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
type BaseAnnotation = { id: string; page: number; x: number; y: number; w: number; h: number; rotation?: number };

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
  repeatSpacingX?: number;
  repeatSpacingY?: number;
  detectedField?: { id: string; label: string };
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
  sourceFieldName?: string;
  sourceOption?: string;
  sourceLabel?: string;
  originalChecked?: boolean;
  readOnly?: boolean;
  detectedField?: { id: string; label: string };
};

type ArrowAnnotation = BaseAnnotation & {
  type: "arrow" | "line";
  color: string;
  width: number;
  reverseX?: boolean;
  reverseY?: boolean;
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
  sourceFieldName?: string;
  multiline?: boolean;
  readOnly?: boolean;
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

type PdfTabState = {
  id: string;
  fileName: string;
  currentPath: string | null;
  pdfBytes: ArrayBuffer;
  pdfDoc: any;
  pageSizes: PageSize[];
  textZones: TextZone[];
  fillZones: DetectedFillZone[];
  annotations: Annotation[];
  selectedId: string | null;
  editingId: string | null;
  zoom: number;
  activePage: number;
  scroll?: { top: number; left: number };
  isDirty: boolean;
  savedAnnotations: Annotation[] | null;
  status: string;
  history: Annotation[][];
  redo: Annotation[][];
};

type PageRange = {
  start: number;
  end: number;
};

type OcrResult = {
  page: number;
  text: string;
  confidence: number;
};

type PageAnalysis = {
  textZones: TextZone[];
  fillZones: DetectedFillZone[];
  annotations: Annotation[];
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
  { id: "select", label: "Select & fill", Icon: MousePointer2 },
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
  { id: "radio", label: "Radio choice", Icon: Radio },
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

const toolGroups: Array<{ title: string; tools: Tool[] }> = [
  { title: "Fill & sign", tools: ["select", "text", "field", "checkmark", "checkbox", "radio", "signature", "initials", "date"] },
  { title: "Edit", tools: ["editText", "image", "whiteout", "table", "watermark", "pageNumber"] },
  { title: "Markup", tools: ["highlight", "draw", "eraser", "comment", "note", "line", "arrow", "circle", "rectangle"] },
];

const topMenus = [
  { title: "File", items: ["Open PDF", "Save", "Save As", "Export PDF", "Print"] },
  { title: "Pages", items: ["Organize pages", "Merge PDFs", "Split PDF", "Extract pages from file", "Remove pages from file", "Add page numbers"] },
  { title: "Edit", items: ["Check Text", "Edit PDF", "Add Text", "Add Images", "Erase", "Watermark"] },
];

const fileActionsWithoutDocument = new Set(["Open PDF", "Merge PDFs", "Split PDF", "Extract pages from file", "Remove pages from file"]);

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatAustralianDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function isConstrainedShape(type: DraftBox["type"]) {
  return ["circle", "rectangle", "whiteout", "highlight"].includes(type);
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
  let anyChanged = false;
  const next = annotations.flatMap<Annotation>((annotation) => {
    if (annotation.type !== "draw" || annotation.page !== page) return [annotation];
    let changed = false;
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
    anyChanged = true;
    return segments.map((points, index) => ({
      ...annotation,
      id: index === 0 ? annotation.id : uid("draw"),
      points,
    }));
  });
  return anyChanged ? next : annotations;
}

function rotateAnnotation(annotation: Annotation, page: number, pageSize: PageSize, direction: -1 | 1): Annotation {
  if (annotation.page !== page) return annotation;
  if (annotation.type === "draw") {
    return {
      ...annotation,
      points: annotation.points.map((point) => direction === 1
        ? { x: 1 - point.y, y: point.x }
        : { x: point.y, y: 1 - point.x }),
    };
  }
  if (annotation.type === "arrow" || annotation.type === "line") {
    const start = {
      x: annotation.reverseX ? annotation.x + annotation.w : annotation.x,
      y: annotation.reverseY ? annotation.y + annotation.h : annotation.y,
    };
    const end = {
      x: annotation.reverseX ? annotation.x : annotation.x + annotation.w,
      y: annotation.reverseY ? annotation.y : annotation.y + annotation.h,
    };
    const rotatePoint = (point: Point) => direction === 1
      ? { x: 1 - point.y, y: point.x }
      : { x: point.y, y: 1 - point.x };
    const nextStart = rotatePoint(start);
    const nextEnd = rotatePoint(end);
    return {
      ...annotation,
      x: Math.min(nextStart.x, nextEnd.x),
      y: Math.min(nextStart.y, nextEnd.y),
      w: Math.abs(nextEnd.x - nextStart.x),
      h: Math.abs(nextEnd.y - nextStart.y),
      reverseX: nextStart.x > nextEnd.x,
      reverseY: nextStart.y > nextEnd.y,
    };
  }
  if (annotation.type === "field" || (isChoiceAnnotation(annotation) && annotation.sourceFieldName)) {
    return direction === 1
      ? { ...annotation, x: 1 - annotation.y - annotation.h, y: annotation.x, w: annotation.h, h: annotation.w }
      : { ...annotation, x: annotation.y, y: 1 - annotation.x - annotation.w, w: annotation.h, h: annotation.w };
  }
  const centerX = annotation.x + annotation.w / 2;
  const centerY = annotation.y + annotation.h / 2;
  const [x, y] = direction === 1 ? [1 - centerY, centerX] : [centerY, 1 - centerX];
  const w = annotation.w * pageSize.width / pageSize.height;
  const h = annotation.h * pageSize.height / pageSize.width;
  return { ...annotation, x: x - w / 2, y: y - h / 2, w, h, rotation: (annotation.rotation ?? 0) + direction * 90 };
}

function isChoiceAnnotation(annotation: Annotation): annotation is ChoiceAnnotation {
  return ["checkbox", "radio", "checkmark"].includes(annotation.type);
}

const choiceInk = "#111827";
const tickPoints = [[23, 51], [42, 70], [78, 30]];
const crossPoints = [[[30, 30], [70, 70]], [[70, 30], [30, 70]]];

function groupByPage<T extends { page: number }>(items: T[]) {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const group = groups.get(item.page);
    if (group) group.push(item);
    else groups.set(item.page, [item]);
  }
  return groups;
}

const emptyAnnotations: Annotation[] = [];
const emptyTextZones: TextZone[] = [];
const emptyFillZones: DetectedFillZone[] = [];

function hasSourceFieldName(annotation: Annotation): annotation is (FieldAnnotation | ChoiceAnnotation) & { sourceFieldName: string } {
  return (annotation.type === "field" || isChoiceAnnotation(annotation)) && Boolean(annotation.sourceFieldName);
}

function isFixedFill(annotation: Annotation) {
  return hasSourceFieldName(annotation) ||
    ((isTextAnnotation(annotation) || isChoiceAnnotation(annotation)) && Boolean(annotation.detectedField));
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

function fieldFontSize(box: Pick<BaseAnnotation, "h">, pageSize: PageSize) {
  return Math.round(clamp(box.h * pageSize.height * 0.48, 6, 13));
}

function isCheckedFieldValue(value: unknown) {
  return /^(1|true|yes|y|checked|x)$/i.test(String(value ?? ""));
}

async function analyzePdfPage(doc: PDFDocumentProxy, pageNumber: number, pageSize: PageSize): Promise<PageAnalysis> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const [operatorList, textContent, pdfAnnotations] = await Promise.all([
    page.getOperatorList(), page.getTextContent(), page.getAnnotations(),
  ]);
  const textZones: TextZone[] = [];
  const runs: FormTextRun[] = [];
  const widgetBoxes: Array<Pick<BaseAnnotation, "x" | "y" | "w" | "h">> = [];
  const annotations: Annotation[] = [];
  const toPageBounds = (box: Pick<BaseAnnotation, "x" | "y" | "w" | "h">) => ({
    left: box.x * pageSize.width, right: (box.x + box.w) * pageSize.width,
    top: box.y * pageSize.height, bottom: (box.y + box.h) * pageSize.height,
  });

  for (const item of textContent.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [a, b, c, d, x, y] = Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(1, Math.hypot(c, d));
    const advance = item.width * viewport.scale || fontSize * item.str.length * 0.45;
    const textDirection = Math.hypot(a, b) || 1;
    const direction = { x: a / textDirection, y: b / textDirection };
    const ascent = { x: c / fontSize, y: d / fontSize };
    const corners = [0, advance].flatMap((dx) => [-fontSize * 0.16, fontSize * 0.88].map((dy) => ({
      x: x + direction.x * dx + ascent.x * dy,
      y: y + direction.y * dx + ascent.y * dy,
    })));
    const left = Math.min(...corners.map((corner) => corner.x));
    const top = Math.min(...corners.map((corner) => corner.y));
    const right = Math.max(...corners.map((corner) => corner.x));
    const bottom = Math.max(...corners.map((corner) => corner.y));
    runs.push({ text: item.str, baseline: { x, y }, direction, ascent, advance, fontSize, left, top, right, bottom });
    textZones.push({
      id: uid("zone"),
      page: pageNumber,
      x: clamp(left / pageSize.width, 0, 1),
      y: clamp(top / pageSize.height, 0, 1),
      w: clamp((right - left) / pageSize.width, 0.01, 1),
      h: clamp((bottom - top) / pageSize.height, 0.01, 1),
      text: item.str,
      fontSize,
    });
  }

  const candidates = pdfAnnotations.filter((candidate) => candidate.rect).map((candidate) => ({
    candidate, box: rectFromPdf(viewport, candidate.rect, pageSize),
  }));
  for (const { candidate, box } of candidates) {
    if (candidate.subtype === "Widget") {
      widgetBoxes.push(box);
      const fieldName = candidate.fieldName;
      if (!fieldName) continue;
      const fieldValue = String(candidate.fieldValue ?? "");
      if (candidate.checkBox || candidate.radioButton) {
        const sourceOption = candidate.radioButton ? candidate.buttonValue : undefined;
        const onValue = sourceOption ?? candidate.exportValue;
        const checked = onValue ? fieldValue === onValue : isCheckedFieldValue(fieldValue);
        const radioNeighbor = candidate.radioButton
          ? candidates.filter((entry) => entry.candidate.radioButton && entry.box.x > box.x && Math.abs(entry.box.y - box.y) < 0.01)
            .sort((a, b) => a.box.x - b.box.x)[0]
          : undefined;
        const printedLabel = candidate.radioButton
          ? nearbyCheckboxLabel(toPageBounds(box), runs, radioNeighbor ? toPageBounds(radioNeighbor.box) : undefined)
          : "";
        annotations.push({
          id: `widget-${pageNumber}-${candidate.id}`,
          page: pageNumber,
          ...box,
          type: candidate.radioButton ? "radio" : "checkbox",
          checked,
          originalChecked: checked,
          mark: "check",
          sourceFieldName: fieldName,
          sourceOption,
          sourceLabel: printedLabel || (candidate.radioButton && sourceOption !== undefined ? `${fieldName} (${sourceOption})` : undefined),
          readOnly: candidate.readOnly,
        });
      } else if (candidate.fieldType === "Tx" || candidate.fieldType === "Ch") {
        annotations.push({
          id: `widget-${pageNumber}-${candidate.id}`,
          page: pageNumber,
          ...box,
          type: "field",
          name: fieldName,
          value: fieldValue,
          fontSize: fieldFontSize(box, pageSize),
          sourceFieldName: fieldName,
          multiline: candidate.multiLine,
          readOnly: candidate.readOnly || candidate.fieldType === "Ch",
        });
      }
      continue;
    }
    if (candidate.subtype === "FreeText" && candidate.contents) {
      annotations.push({
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
      annotations.push({
        id: uid("edgeHighlight"),
        page: pageNumber,
        type: "highlight",
        ...box,
        color: "#fde047",
        opacity: 0.45,
      });
    }
  }

  const fillZones = detectFillZones(operatorList, viewport, runs, pageNumber).filter((zone) => !widgetBoxes.some((widget) =>
    Math.min(zone.x + zone.w, widget.x + widget.w) - Math.max(zone.x, widget.x) > 0.004 &&
    Math.min(zone.y + zone.h, widget.y + widget.h) - Math.max(zone.y, widget.y) > 0.004,
  ));
  return { textZones, fillZones, annotations };
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
  const [fillZones, setFillZones] = useState<DetectedFillZone[]>([]);
  const [draftFill, setDraftFill] = useState<TextAnnotation | null>(null);
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
  const [sidebarView, setSidebarView] = useState<"tools" | "pages">("tools");
  const [showInspector, setShowInspector] = useState(() => window.innerWidth > 760);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [removePagesOpen, setRemovePagesOpen] = useState(false);
  const [extractPagesOpen, setExtractPagesOpen] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{ page: number; x: number; y: number; tool: ChoiceAnnotation["type"] } | null>(null);
  const [imagePlacementPreview, setImagePlacementPreview] = useState<{ page: number; x: number; y: number; w: number; h: number; dataUrl: string; label: string } | null>(null);
  const [imageToPlace, setImageToPlace] = useState<{ dataUrl: string; label: string; aspectRatio: number } | null>(null);
  const [eraserPreview, setEraserPreview] = useState<{ page: number; x: number; y: number } | null>(null);
  const [toolMenu, setToolMenu] = useState<{ tool: Tool; x: number; y: number } | null>(null);
  const isDesktop = Boolean(window.pdfFillerDesktop);
  const historyRef = useRef<Annotation[][]>([]);
  const redoRef = useRef<Annotation[][]>([]);
  const annotationsRef = useRef<Annotation[]>([]);
  const savedAnnotationsRef = useRef<Annotation[] | null>(null);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});
  const documentScrollerRef = useRef<HTMLDivElement | null>(null);
  const pendingPageScrollRef = useRef<{ page: number; scroll?: PdfTabState["scroll"] } | null>(null);
  const scrollFrameRef = useRef(0);
  const menuBarRef = useRef<HTMLElement | null>(null);
  const pendingZoomAnchorRef = useRef<{
    page: number;
    xRatio: number;
    yRatio: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const imageUploadRef = useRef<HTMLInputElement | null>(null);
  const draftBoxRef = useRef<DraftBox | null>(null);
  const draftRawSizeRef = useRef<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    mode: "move" | "resize" | "rotate";
    startX: number;
    startY: number;
    original: BaseAnnotation;
    pageWidth: number;
    pageHeight: number;
    centerX?: number;
    centerY?: number;
    startAngle?: number;
  } | null>(null);
  const gestureStartRef = useRef<Annotation[] | null>(null);
  const activeDrawRef = useRef<string | null>(null);
  const activeEraseRef = useRef(false);
  const pendingInitialPdfRef = useRef<DesktopPdfPayload | null>(null);
  const startupReadyRef = useRef(startupReady);
  const ocrCancelRef = useRef(false);
  const analyzedPagesRef = useRef(new Set<number>());
  const analyzingPagesRef = useRef(new Set<number>());
  const activeTabIdRef = useRef<string | null>(null);
  const pdfDocRef = useRef<any>(null);
  const savePdfRef = useRef<() => Promise<boolean>>(async () => false);
  const savingRef = useRef(false);
  const printPdfRef = useRef<() => Promise<void>>(async () => undefined);
  const saveAndCloseRef = useRef<() => Promise<void>>(async () => undefined);
  const saveBeforeDesktopCloseRef = useRef<() => Promise<void>>(async () => undefined);

  const visibleDraftFill = draftFill?.id === selectedId ? draftFill : null;
  const selected = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedId) ?? visibleDraftFill,
    [annotations, selectedId, visibleDraftFill],
  );
  const annotationsByPage = useMemo(() => groupByPage(visibleDraftFill ? [...annotations, visibleDraftFill] : annotations), [annotations, visibleDraftFill]);
  const textZonesByPage = useMemo(() => groupByPage(textZones), [textZones]);
  const fillZonesByPage = useMemo(() => groupByPage(fillZones), [fillZones]);

  useEffect(() => {
    if (!activeMenu) return;
    const dismissMenu = (event: PointerEvent) => {
      if (!menuBarRef.current?.contains(event.target as Node)) setActiveMenu(null);
    };
    document.addEventListener("pointerdown", dismissMenu);
    return () => document.removeEventListener("pointerdown", dismissMenu);
  }, [activeMenu]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
    pdfDocRef.current = pdfDoc;
  }, [activeTabId, pdfDoc]);

  const updateDraftBox = useCallback((next: DraftBox | null) => {
    draftBoxRef.current = next;
    setDraftBox(next);
  }, []);

  useEffect(() => {
    const applyShiftConstraint = (constrained: boolean) => {
      const current = draftBoxRef.current;
      const raw = draftRawSizeRef.current;
      if (!current || !raw || !isConstrainedShape(current.type)) return;
      const size = Math.min(Math.abs(raw.w), Math.abs(raw.h));
      updateDraftBox({
        ...current,
        w: constrained ? Math.sign(raw.w || 1) * size : raw.w,
        h: constrained ? Math.sign(raw.h || 1) * size : raw.h,
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") applyShiftConstraint(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") applyShiftConstraint(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [updateDraftBox]);

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
      fillZones,
      annotations: annotationsRef.current,
      selectedId: visibleDraftFill ? null : selectedId,
      editingId: visibleDraftFill ? null : editingId,
      zoom,
      activePage,
      scroll: documentScrollerRef.current ? {
        top: documentScrollerRef.current.scrollTop,
        left: documentScrollerRef.current.scrollLeft,
      } : undefined,
      isDirty,
      savedAnnotations: savedAnnotationsRef.current,
      status,
      history: historyRef.current,
      redo: redoRef.current,
    };
  }, [activePage, activeTabId, currentPath, editingId, fileName, fillZones, isDirty, pageSizes, pdfBytes, pdfDoc, selectedId, status, textZones, visibleDraftFill, zoom]);
  const snapshotRef = useRef(currentTabSnapshot);
  snapshotRef.current = currentTabSnapshot;

  const restoreTab = (tab: PdfTabState) => {
    activeTabIdRef.current = tab.id;
    pdfDocRef.current = tab.pdfDoc;
    pendingPageScrollRef.current = { page: tab.activePage, scroll: tab.scroll };
    analyzedPagesRef.current = new Set([
      ...tab.textZones.map((zone) => zone.page),
      ...tab.fillZones.map((zone) => zone.page),
    ]);
    analyzingPagesRef.current = new Set();
    historyRef.current = tab.history;
    redoRef.current = tab.redo;
    annotationsRef.current = tab.annotations;
    savedAnnotationsRef.current = tab.savedAnnotations;
    setActiveTabId(tab.id);
    setPdfBytes(tab.pdfBytes);
    setPdfDoc(tab.pdfDoc);
    setFileName(tab.fileName);
    setCurrentPath(tab.currentPath);
    setPageSizes(tab.pageSizes);
    setTextZones(tab.textZones);
    setFillZones(tab.fillZones);
    setDraftFill(null);
    setAnnotations(tab.annotations);
    setSelectedId(tab.selectedId);
    setEditingId(tab.editingId);
    setZoom(tab.zoom);
    setActivePage(tab.activePage);
    setIsDirty(tab.isDirty);
    setStatus(tab.status);
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
    const closingIndex = tabs.findIndex((tab) => tab.id === id);
    const snapshot = currentTabSnapshot();
    const nextTabs = (snapshot ? tabs.map((tab) => (tab.id === snapshot.id ? snapshot : tab)) : tabs).filter((tab) => tab.id !== id);
    setTabs(nextTabs);
    if (id !== activeTabId) {
      return;
    }
    const next = nextTabs[Math.min(Math.max(closingIndex, 0), nextTabs.length - 1)] ?? null;
    if (next) {
      restoreTab(next);
      return;
    }
    setActiveTabId(null);
    activeTabIdRef.current = null;
    pdfDocRef.current = null;
    setPdfBytes(null);
    setPdfDoc(null);
    setFileName("untitled.pdf");
    setCurrentPath(null);
    setPageSizes([]);
    setTextZones([]);
    setFillZones([]);
    setDraftFill(null);
    historyRef.current = [];
    redoRef.current = [];
    annotationsRef.current = [];
    savedAnnotationsRef.current = null;
    setAnnotations([]);
    analyzedPagesRef.current = new Set();
    analyzingPagesRef.current = new Set();
    setSelectedId(null);
    setEditingId(null);
    setIsDirty(false);
    setStatus("Ready");
  };

  const requestCloseTab = (id: string) => {
    const snapshot = currentTabSnapshot();
    const currentTabs = snapshot ? tabs.map((tab) => (tab.id === snapshot.id ? snapshot : tab)) : tabs;
    const target = currentTabs.find((tab) => tab.id === id);
    if (!target) return;
    setTabs(currentTabs);
    if (!target.isDirty) {
      closeTab(id);
      return;
    }
    if (id !== activeTabId) restoreTab(target);
    setPendingCloseTabId(id);
  };

  const loadPdfBytes = async (bytes: ArrayBuffer, name: string, sourcePath: string | null = null, options: { tabId: string; annotations: Annotation[]; activePage: number; status: string } | null = null) => {
    const task = getDocument({ data: bytes.slice(0) });
    const sizes: PageSize[] = [];
    let doc;
    try {
      doc = await task.promise;
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        sizes.push({ width: viewport.width, height: viewport.height });
      }
    } catch (error) {
      await task.destroy().catch(() => undefined);
      throw error;
    }

    const previousSnapshot = snapshotRef.current();
    const statusText = options?.status ?? "PDF opened";
    const tabId = options?.tabId ?? uid("tab");
    const nextAnnotations = options?.annotations ?? [];
    const nextTab: PdfTabState = {
      id: tabId,
      fileName: name,
      currentPath: sourcePath,
      pdfBytes: bytes,
      pdfDoc: doc,
      pageSizes: sizes,
      textZones: [],
      fillZones: [],
      annotations: nextAnnotations,
      selectedId: null,
      editingId: null,
      zoom: options ? zoom : Math.min(1, getFitZoom(sizes[0])),
      activePage: options?.activePage ?? 1,
      isDirty: Boolean(options),
      savedAnnotations: options ? null : nextAnnotations,
      status: statusText,
      history: [],
      redo: [],
    };

    setTabs((current) => {
      const updated = previousSnapshot ? current.map((tab) => (tab.id === previousSnapshot.id ? previousSnapshot : tab)) : current;
      return options ? updated.map((tab) => tab.id === tabId ? nextTab : tab) : [...updated, nextTab];
    });
    if (!options || previousSnapshot?.id === tabId) {
      restoreTab(nextTab);
      if (!options) setTool("select");
    }
  };

  const loadPdf = async (file: File) => {
    try {
      await loadPdfBytes(await file.arrayBuffer(), file.name);
    } catch (error) {
      setStatus(`Could not open ${file.name}. ${error instanceof Error ? error.message : "Choose a valid PDF."}`);
    }
  };

  const loadDesktopPdfPath = async (filePath: string) => {
    try {
      const payload = await window.pdfFillerDesktop?.readPdfFile(filePath);
      if (!payload) return;
      await loadPdfBytes(payloadToArrayBuffer(payload.bytes), payload.name, payload.path);
    } catch (error) {
      setStatus(`Could not open PDF. ${error instanceof Error ? error.message : ""}`);
    }
  };

  const readPlacementImage = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image rendering is unavailable.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      setImageToPlace({ dataUrl: canvas.toDataURL("image/png"), label: file.name, aspectRatio: canvas.width / canvas.height });
      setStatus("Click the PDF to place the image.");
    } catch {
      setStatus(`Could not open ${file.name} as an image.`);
    } finally {
      URL.revokeObjectURL(url);
    }
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
      if (startupReadyRef.current) openInitialPdf();
    }).catch((error: Error) => setStatus(`Could not open PDF. ${error.message}`));
    const removeOpenListener = window.pdfFillerDesktop.onPdfOpenedFromSystem((filePath) => {
      void loadDesktopPdfPath(filePath);
    });
    const removeUpdateListener = window.pdfFillerDesktop.onUpdaterStatus(setUpdateStatus);
    const removeUpdateStateListener = window.pdfFillerDesktop.onUpdaterState((state) => {
      setUpdateState(state);
      setShowUpdateGate(true);
    });
    const removeSaveBeforeCloseListener = window.pdfFillerDesktop.onSaveBeforeClose(() => {
      void saveBeforeDesktopCloseRef.current();
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
    if (startupReady || !showUpdateGate || updateState.phase !== "checking") return;
    const timeout = window.setTimeout(() => {
      setShowUpdateGate(false);
      setStartupReady(true);
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [showUpdateGate, startupReady, updateState.phase]);

  useEffect(() => {
    startupReadyRef.current = startupReady;
    if (startupReady) openInitialPdf();
  }, [startupReady]);

  const openInitialPdf = () => {
    const payload = pendingInitialPdfRef.current;
    if (!payload) return;
    pendingInitialPdfRef.current = null;
    void loadPdfBytes(payloadToArrayBuffer(payload.bytes), payload.name, payload.path)
      .catch((error: Error) => setStatus(`Could not open PDF. ${error.message}`));
  };

  useEffect(() => {
    void window.pdfFillerDesktop?.setDirty(isDirty || tabs.some((tab) => tab.id !== activeTabId && tab.isDirty));
  }, [activeTabId, isDirty, tabs]);

  const updateDirtyState = useCallback(() => {
    const dirty = annotationsRef.current !== savedAnnotationsRef.current;
    setIsDirty(dirty);
    setTabs((current) => current.map((tab) => tab.id === activeTabIdRef.current ? { ...tab, isDirty: dirty } : tab));
  }, []);

  const recordAnnotationEdit = useCallback((previous: Annotation[]) => {
    if (previous === annotationsRef.current) return;
    historyRef.current = [...historyRef.current.slice(-39), previous];
    redoRef.current = [];
    updateDirtyState();
  }, [updateDirtyState]);

  const changeAnnotations = useCallback((update: (current: Annotation[]) => Annotation[], recordHistory = true) => {
    const previous = annotationsRef.current;
    const next = update(previous);
    if (next === previous) return;
    annotationsRef.current = next;
    setAnnotations(next);
    if (recordHistory) recordAnnotationEdit(previous);
  }, [recordAnnotationEdit]);

  const finishAnnotationGesture = useCallback(() => {
    const previous = gestureStartRef.current;
    gestureStartRef.current = null;
    if (previous) recordAnnotationEdit(previous);
  }, [recordAnnotationEdit]);

  const undo = useCallback(() => {
    if (gestureStartRef.current) return;
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current = [...redoRef.current, annotationsRef.current];
    changeAnnotations(() => previous, false);
    updateDirtyState();
    setSelectedId(null);
    setEditingId(null);
  }, [changeAnnotations, updateDirtyState]);

  const redo = useCallback(() => {
    if (gestureStartRef.current) return;
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, annotationsRef.current];
    changeAnnotations(() => next, false);
    updateDirtyState();
    setSelectedId(null);
    setEditingId(null);
  }, [changeAnnotations, updateDirtyState]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void savePdfRef.current();
        return;
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void printPdfRef.current();
        return;
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        void saveAndCloseRef.current();
        return;
      }
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
        setSelectedId(null);
        setEditingId(null);
        setTool("select");
        setActiveMenu(null);
        setToolMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId, undo, redo]);

  const ensurePageAnalyzed = useCallback(async (page: number) => {
    if (!pdfDoc || !pageSizes[page - 1]) return;
    if (analyzedPagesRef.current.has(page) || analyzingPagesRef.current.has(page)) return;
    const doc = pdfDoc;
    const tabId = activeTabId;
    const analyzing = analyzingPagesRef.current;
    analyzing.add(page);
    try {
      const analysis = await analyzePdfPage(doc, page, pageSizes[page - 1]);
      if (pdfDocRef.current !== doc || activeTabIdRef.current !== tabId) return;
      analyzedPagesRef.current.add(page);
      setTextZones((current) => [...current.filter((zone) => zone.page !== page), ...analysis.textZones]);
      setFillZones((current) => [...current.filter((zone) => zone.page !== page), ...analysis.fillZones]);
      if (analysis.annotations.length) {
        const snapshots = new Map<Annotation[], Annotation[]>();
        const includeFormFields = (current: Annotation[]) => {
          const existing = snapshots.get(current);
          if (existing) return existing;
          const imported = analysis.annotations.filter((candidate) => !current.some((annotation) =>
            annotation.page === page && annotation.type === candidate.type &&
            hasSourceFieldName(candidate) && hasSourceFieldName(annotation) &&
            annotation.sourceFieldName === candidate.sourceFieldName &&
            Math.abs(annotation.x - candidate.x) < 0.001 && Math.abs(annotation.y - candidate.y) < 0.001,
          )).map((candidate) => {
            if (!hasSourceFieldName(candidate)) return candidate;
            if (candidate.type === "field") {
              const peer = current.find((annotation): annotation is FieldAnnotation =>
                annotation.type === "field" && annotation.sourceFieldName === candidate.sourceFieldName,
              );
              return peer && peer.value !== candidate.value ? { ...candidate, value: peer.value } : candidate;
            }
            const peers = current.filter((annotation): annotation is ChoiceAnnotation =>
              isChoiceAnnotation(annotation) && annotation.type === candidate.type && annotation.sourceFieldName === candidate.sourceFieldName,
            );
            const changed = peers.find((annotation) => annotation.originalChecked !== undefined && annotation.originalChecked !== annotation.checked);
            if (!changed) return candidate;
            if (candidate.type !== "radio") return { ...candidate, checked: changed.checked };
            const selected = peers.find((annotation) => annotation.checked);
            return { ...candidate, checked: Boolean(selected && selected.sourceOption === candidate.sourceOption) };
          });
          const next = imported.length ? [...current, ...imported] : current;
          snapshots.set(current, next);
          return next;
        };
        historyRef.current = historyRef.current.map(includeFormFields);
        redoRef.current = redoRef.current.map(includeFormFields);
        if (gestureStartRef.current) gestureStartRef.current = includeFormFields(gestureStartRef.current);
        if (savedAnnotationsRef.current) savedAnnotationsRef.current = includeFormFields(savedAnnotationsRef.current);
        changeAnnotations(includeFormFields, false);
      }
    } catch (error) {
      console.warn("Page analysis failed", error);
      if (pdfDocRef.current === doc) setStatus(`Page ${page} loaded. Some fill areas could not be detected.`);
    } finally {
      analyzing.delete(page);
    }
  }, [activeTabId, changeAnnotations, pageSizes, pdfDoc]);

  const addAnnotation = (annotation: Annotation) => {
    changeAnnotations((current) => [...current, annotation]);
    setSelectedId(annotation.id);
    setEditingId(isTextAnnotation(annotation) || annotation.type === "field" ? annotation.id : null);
  };

  const removeAnnotation = (id: string) => {
    if (draftFill?.id === id) setDraftFill(null);
    const existing = annotationsRef.current.find((annotation) => annotation.id === id);
    if (existing && (existing.type === "field" || isChoiceAnnotation(existing)) && existing.readOnly) return;
    if (existing?.type === "field" && existing.sourceFieldName) {
      updateAnnotation(id, { value: "" });
      setEditingId(id);
      setStatus("Form field cleared.");
      return;
    }
    if (existing && isChoiceAnnotation(existing) && existing.sourceFieldName) {
      setChoiceChecked(id, false);
      setStatus("Form field cleared.");
      return;
    }
    changeAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setEditingId((current) => (current === id ? null : current));
  };

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    if (visibleDraftFill?.id === id) {
      const next = { ...visibleDraftFill, ...patch } as TextAnnotation;
      if (next.text) {
        changeAnnotations((current) => [...current, next]);
        setDraftFill(null);
      } else setDraftFill(next);
      return;
    }
    changeAnnotations((current) => {
      const index = current.findIndex((annotation) => annotation.id === id);
      if (index === -1) return current;
      const annotation = current[index];
      if (Object.entries(patch).every(([key, value]) => annotation[key as keyof typeof annotation] === value)) return current;
      const updated = { ...annotation, ...patch } as Annotation;
      return current.map((other) => {
        if (other.id === id) return updated;
        if (updated.type === "field" && updated.sourceFieldName && other.type === "field" &&
          other.sourceFieldName === updated.sourceFieldName && other.value !== updated.value) {
          return { ...other, value: updated.value };
        }
        return other;
      });
    });
  };

  const setChoiceChecked = (id: string, checked?: boolean) => {
    const target = annotationsRef.current.find((annotation) => annotation.id === id);
    if (!target || !isChoiceAnnotation(target) || target.readOnly) return;
    const nextChecked = checked ?? (target.sourceOption ? true : !target.checked);
    if (nextChecked !== target.checked) {
      changeAnnotations((current) => current.map((annotation) => {
        if (!isChoiceAnnotation(annotation)) return annotation;
        if (annotation.id === id) return { ...annotation, checked: nextChecked };
        if (!target.sourceFieldName || annotation.sourceFieldName !== target.sourceFieldName || annotation.type !== target.type) return annotation;
        const state = target.type === "radio" ? nextChecked && annotation.sourceOption === target.sourceOption : nextChecked;
        return state === annotation.checked ? annotation : { ...annotation, checked: state };
      }));
    }
    setActivePage(target.page);
    setSelectedId(id);
    setEditingId(null);
  };

  const activateFillZone = (zone: DetectedFillZone) => {
    const existing = annotationsRef.current.find((annotation) =>
      (isTextAnnotation(annotation) || isChoiceAnnotation(annotation)) && annotation.detectedField?.id === zone.id && annotation.page === zone.page,
    );
    setActivePage(zone.page);
    if (existing) {
      if (isChoiceAnnotation(existing)) setChoiceChecked(existing.id);
      else {
        setSelectedId(existing.id);
        setEditingId(existing.id);
      }
      return;
    }
    const detectedField = { id: zone.id, label: zone.label };
    if (zone.kind === "checkbox") {
      const { page, x, y, w, h } = zone;
      addAnnotation({ id: uid("tick"), page, x, y, w, h, type: "checkmark", checked: true, mark: "check", detectedField });
      return;
    }
    if (visibleDraftFill?.detectedField?.id === zone.id && visibleDraftFill.page === zone.page) return;
    const size = pageSizes[zone.page - 1];
    const horizontalPadding = (zone.source === "line" ? 2 : 4) / size.width;
    const verticalPadding = clamp((zone.h * size.height - 15) / 2, 2, 7) / size.height;
    const field: TextAnnotation = {
      id: uid("fillText"),
      page: zone.page,
      type: "text",
      x: zone.x + horizontalPadding,
      y: zone.y + verticalPadding,
      w: zone.w - horizontalPadding * 2,
      h: zone.h - verticalPadding - 2 / size.height,
      text: "",
      color: textColor,
      fontSize: 11,
      bold: false,
      detectedField,
    };
    setDraftFill(field);
    setSelectedId(field.id);
    setEditingId(field.id);
  };

  const createTextAnnotation = (page: number, point: Point, preset?: Partial<TextAnnotation>) => {
    const w = preset?.w ?? 0.28;
    const h = preset?.h ?? 0.055;
    addAnnotation({
      id: uid("text"),
      page,
      type: preset?.type ?? "text",
      x: clamp(point.x, 0, 1 - w),
      y: clamp(point.y, 0, 1 - h),
      w,
      h,
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
    const existing = annotations.find((annotation) => annotation.page === page && annotation.type === "watermark");
    if (existing) {
      setSelectedId(existing.id);
      setEditingId(existing.id);
      setStatus("This page already has a watermark. The existing watermark is selected for editing.");
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

  const getImagePlacement = (page: number, point: Point) => {
    if (!imageToPlace) return null;
    const { width, height } = pageSizes[page - 1];
    const imageWidth = Math.min(width * 0.28, height * 0.23 * imageToPlace.aspectRatio);
    const w = imageWidth / width;
    const h = imageWidth / imageToPlace.aspectRatio / height;
    return { ...imageToPlace, page, w, h, x: clamp(point.x - w / 2, 0, 1 - w), y: clamp(point.y - h / 2, 0, 1 - h) };
  };

  const handlePagePointerDown = (event: React.PointerEvent<HTMLDivElement>, pageIndex: number) => {
    if (!pdfDoc || event.button !== 0 || !event.isPrimary) return;
    const point = pagePoint(event, event.currentTarget);
    const page = pageIndex + 1;
    setActivePage(page);
    if (selectedId && (tool === "text" || tool === "field")) {
      setSelectedId(null);
      setEditingId(null);
      return;
    }

    if (tool === "eraser") {
      const eraserRadius = eraserSize / Math.max(event.currentTarget.clientWidth, 1);
      activeEraseRef.current = true;
      gestureStartRef.current = annotationsRef.current;
      setEraserPreview({ page, x: point.x, y: point.y });
      changeAnnotations((current) => eraseDrawingsAt(current, page, point, eraserRadius), false);
      setSelectedId(null);
      setEditingId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "select") {
      setSelectedId(null);
      setEditingId(null);
      return;
    }

    if (tool === "text") {
      const zone = fillZonesByPage.get(page)?.find((candidate) => candidate.kind === "text" &&
        point.x >= candidate.x && point.x <= candidate.x + candidate.w &&
        point.y >= candidate.y && point.y <= candidate.y + candidate.h);
      if (zone) activateFillZone(zone);
      else createTextAnnotation(page, point);
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
      const dateText = formatAustralianDate();
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

    if (tool === "checkbox" || tool === "radio" || tool === "checkmark") {
      const { width, height } = pageSizes[pageIndex];
      const size = tool === "checkmark" ? 20 : 17;
      const w = size / width;
      const h = size / height;
      addAnnotation({
        id: uid(tool),
        page,
        type: tool,
        x: clamp(point.x - w / 2, 0, 1 - w),
        y: clamp(point.y - h / 2, 0, 1 - h),
        w,
        h,
        checked: true,
        mark: tool === "checkmark" ? "check" : "x",
      });
      setPlacementPreview(null);
      setImagePlacementPreview(null);
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
      setPlacementPreview(null);
      setImagePlacementPreview(null);
      return;
    }

    if (tool === "image") {
      const placement = getImagePlacement(page, point);
      if (!placement) {
        imageUploadRef.current?.click();
        return;
      }
      const { x, y, w, h, dataUrl, label } = placement;
      addAnnotation({ id: uid("image"), page, type: "image", x, y, w, h, dataUrl, label });
      setImageToPlace(null);
      setImagePlacementPreview(null);
      setTool("select");
      setStatus("Image placed");
      return;
    }

    if (tool === "draw") {
      const id = uid("draw");
      activeDrawRef.current = id;
      gestureStartRef.current = annotationsRef.current;
      changeAnnotations((current) => [...current, { id, page, type: "draw", points: [point], color: drawColor, width: drawWidth }], false);
      setSelectedId(id);
      setEditingId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (["whiteout", "highlight", "circle", "rectangle", "line", "arrow"].includes(tool)) {
      const id = uid(tool);
      draftRawSizeRef.current = { w: 0.001, h: 0.001 };
      updateDraftBox({ id, page, type: tool as DraftBox["type"], x: point.x, y: point.y, w: 0.001, h: 0.001 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "table") {
      addAnnotation({ id: uid("table"), page, type: "table", x: point.x, y: point.y, w: 0.42, h: 0.16, rows: 3, cols: 3, color: palette.ink, cells: Array(9).fill("") });
      setTool("select");
    }
  };

  const handlePagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    if (tool === "checkbox" || tool === "radio" || tool === "checkmark") {
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
          x: clamp(point.x - (tool === "signature" ? 0.28 : 0.12) / 2, 0, 1 - (tool === "signature" ? 0.28 : 0.12)),
          y: clamp(point.y - (tool === "signature" ? 0.08 : 0.06) / 2, 0, 1 - (tool === "signature" ? 0.08 : 0.06)),
          w: tool === "signature" ? 0.28 : 0.12,
          h: tool === "signature" ? 0.08 : 0.06,
          dataUrl: asset.dataUrl,
          label: asset.label,
        });
      }
      setPlacementPreview(null);
    } else if (tool === "image") {
      const point = pagePoint(event, event.currentTarget);
      setImagePlacementPreview(getImagePlacement(Number(event.currentTarget.dataset.page), point));
    } else if (tool === "eraser") {
      const point = pagePoint(event, event.currentTarget);
      setEraserPreview({ page: Number(event.currentTarget.dataset.page), x: point.x, y: point.y });
      setPlacementPreview(null);
      setImagePlacementPreview(null);
    }
    if (tool === "eraser" && activeEraseRef.current) {
      const point = pagePoint(event, event.currentTarget);
      const page = Number(event.currentTarget.dataset.page);
      const eraserRadius = eraserSize / Math.max(event.currentTarget.clientWidth, 1);
      setEraserPreview({ page, x: point.x, y: point.y });
      changeAnnotations((current) => eraseDrawingsAt(current, page, point, eraserRadius), false);
      return;
    }

    if (tool === "draw" && activeDrawRef.current) {
      const point = pagePoint(event, event.currentTarget);
      const id = activeDrawRef.current;
      changeAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === id && annotation.type === "draw"
            ? { ...annotation, points: [...annotation.points, point] }
            : annotation,
        ), false,
      );
      return;
    }

    const drawingBox = draftBoxRef.current;
    if (drawingBox) {
      const point = pagePoint(event, event.currentTarget);
      let w = point.x - drawingBox.x;
      let h = point.y - drawingBox.y;
      draftRawSizeRef.current = { w, h };
      if (event.shiftKey && isConstrainedShape(drawingBox.type)) {
        const size = Math.min(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      updateDraftBox({ ...drawingBox, w, h });
    }
  };

  const clearPlacementPreviews = useCallback(() => {
    setPlacementPreview(null);
    setImagePlacementPreview(null);
  }, []);

  useEffect(() => {
    clearPlacementPreviews();
    setEraserPreview(null);
  }, [activeInitials, activeSignature, activeTabId, clearPlacementPreviews, tool]);

  const finishPagePointer = () => {
    if (activeDrawRef.current || activeEraseRef.current) finishAnnotationGesture();
    activeDrawRef.current = null;
    activeEraseRef.current = false;
    setEraserPreview(null);
    const draftBox = draftBoxRef.current;
    if (!draftBox) return;
    updateDraftBox(null);
    draftRawSizeRef.current = null;
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
        reverseX: draftBox.w < 0,
        reverseY: draftBox.h < 0,
      });
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
  };

  const startAnnotationDrag = (
    event: React.PointerEvent,
    annotation: Annotation,
    pageSize: PageSize,
    mode: "move" | "resize" | "rotate",
  ) => {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary || annotation.type === "draw") return;
    if (editingId === annotation.id && mode === "move") return;
    setActivePage(annotation.page);
    setSelectedId(annotation.id);
    if (editingId !== annotation.id) setEditingId(null);
    gestureStartRef.current = annotationsRef.current;
    const annotationElement = (event.currentTarget as HTMLElement).closest(".annotation") as HTMLElement | null;
    const rect = annotationElement?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : undefined;
    const centerY = rect ? rect.top + rect.height / 2 : undefined;
    dragRef.current = {
      id: annotation.id,
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: annotation,
      pageWidth: pageSize.width * zoom,
      pageHeight: pageSize.height * zoom,
      centerX,
      centerY,
      startAngle: centerX !== undefined && centerY !== undefined ? Math.atan2(event.clientY - centerY, event.clientX - centerX) : undefined,
    };
    window.addEventListener("pointermove", moveAnnotation);
    window.addEventListener("pointerup", stopAnnotationDrag);
    window.addEventListener("pointercancel", stopAnnotationDrag);
  };

  const moveAnnotation = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = (event.clientX - drag.startX) / drag.pageWidth;
    const dy = (event.clientY - drag.startY) / drag.pageHeight;
    const original = drag.original;
    if (annotationsRef.current === gestureStartRef.current && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 2) return;
    changeAnnotations((current) => {
      const index = current.findIndex((annotation) => annotation.id === drag.id);
      const annotation = current[index];
      if (!annotation || annotation.type === "draw") return current;
      let patch: Partial<BaseAnnotation>;
      if (drag.mode === "move") {
        patch = { x: clamp(original.x + dx, 0, Math.max(1 - original.w, 0)), y: clamp(original.y + dy, 0, Math.max(1 - original.h, 0)) };
      } else if (drag.mode === "rotate" && drag.centerX !== undefined && drag.centerY !== undefined && drag.startAngle !== undefined) {
        const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX);
        const rotation = Math.round((original.rotation ?? 0) + (angle - drag.startAngle) * 180 / Math.PI);
        patch = { rotation: ((rotation % 360) + 540) % 360 - 180 };
      } else {
        patch = { w: clamp(original.w + dx, 0.015, Math.max(0.015, 1 - original.x)), h: clamp(original.h + dy, 0.015, Math.max(0.015, 1 - original.y)) };
      }
      if (Object.entries(patch).every(([key, value]) => annotation[key as keyof BaseAnnotation] === value)) return current;
      const next = current.slice();
      next[index] = { ...annotation, ...patch };
      return next;
    }, false);
  }, [changeAnnotations]);

  const stopAnnotationDrag = useCallback(function stop(event?: PointerEvent) {
    if (event && event.pointerId !== dragRef.current?.pointerId) return;
    if (dragRef.current) finishAnnotationGesture();
    dragRef.current = null;
    window.removeEventListener("pointermove", moveAnnotation);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  }, [finishAnnotationGesture, moveAnnotation]);

  useEffect(() => () => stopAnnotationDrag(), [stopAnnotationDrag]);

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
    }));
    changeAnnotations((current) => [...current, ...imports]);
    setStatus("Editable text boxes added.");
  };

  const checkTextOnActivePage = async () => {
    if (!pdfDoc || !pageSizes.length) {
      setStatus("Open a PDF before checking text.");
      return;
    }
    ocrCancelRef.current = false;
    setOcrBusy(true);
    setOcrProgress(0);
    setOcrError("");
    setOcrResult(null);
    setStatus(`Checking text on page ${activePage}...`);
    let worker: Tesseract.Worker | null = null;
    try {
      const page = await pdfDoc.getPage(activePage);
      const pageSize = pageSizes[activePage - 1];
      const scale = clamp(2400 / Math.max(pageSize.width, 1), 2, 4);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the OCR image.");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;

      const ocrAssetRoot = new URL("./ocr/", window.location.href).href.replace(/\/$/, "");
      worker = await Tesseract.createWorker("eng", undefined, {
        workerPath: `${ocrAssetRoot}/worker.min.js`,
        corePath: `${ocrAssetRoot}/tesseract-core`,
        langPath: `${ocrAssetRoot}/lang`,
        logger: (message) => {
          if (message.status === "recognizing text") setOcrProgress(Math.round(message.progress * 100));
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      const { data } = await worker.recognize(canvas);
      if (ocrCancelRef.current) return;
      setOcrResult({
        page: activePage,
        text: data.text.trim(),
        confidence: Math.round(data.confidence ?? 0),
      });
      setStatus(data.text.trim() ? `Checked text on page ${activePage}.` : `No text was confidently detected on page ${activePage}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Text check failed.";
      setOcrError(message);
      setStatus(`Check text failed: ${message}`);
    } finally {
      await worker?.terminate().catch(() => undefined);
      setOcrBusy(false);
    }
  };

  const applyPrefill = () => {
    const entries = parsePrefillEntries(prefillText);
    if (!entries.length || !pageSizes.length) return;
    const rows = entries.map((entry) => `${entry.key}: ${entry.value}`);
    changeAnnotations((current) => [
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

  const buildPdfBytes = async (items = annotations) => {
    if (!pdfBytes) return null;
    const pdf = await PDFDocument.load(pdfBytes.slice(0));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const form = pdf.getForm();
    const fieldNames = new Set(form.getFields().map((field) => field.getName()));
    const prefillEntries = parsePrefillEntries(prefillText);
    const radioChanges = new Map<string, string | null>();

    if (prefillEntries.length) {
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

    for (const annotation of items) {
      const page = pdf.getPage(annotation.page - 1);
      const { width, height } = page.getSize();

      if (annotation.type === "field") {
        if (annotation.sourceFieldName) {
          if (annotation.readOnly) continue;
          try {
            form.getTextField(annotation.sourceFieldName).setText(annotation.value);
          } catch {
            // Unsupported source fields are left as-is rather than duplicated.
          }
          form.updateFieldAppearances(font);
          continue;
        }
        const requestedName = annotation.name.trim() || "Field";
        let fieldName = requestedName;
        for (let suffix = 2; fieldNames.has(fieldName); suffix += 1) fieldName = `${requestedName}_${suffix}`;
        fieldNames.add(fieldName);
        const field = form.createTextField(fieldName);
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
        form.updateFieldAppearances(font);
        continue;
      }

      if (isChoiceAnnotation(annotation) && annotation.sourceFieldName) {
        if (annotation.checked === annotation.originalChecked) continue;
        if (annotation.type === "radio") {
          if (annotation.checked && annotation.sourceOption) radioChanges.set(annotation.sourceFieldName, annotation.sourceOption);
          else if (!radioChanges.has(annotation.sourceFieldName)) radioChanges.set(annotation.sourceFieldName, null);
          continue;
        }
        try {
          const checkbox = form.getCheckBox(annotation.sourceFieldName);
          if (annotation.checked) checkbox.check();
          else checkbox.uncheck();
        } catch {
          // Unsupported button widgets are left intact.
        }
        form.updateFieldAppearances(font);
      }
    }

    for (const [name, option] of radioChanges) {
      const group = form.getFieldMaybe(name);
      if (!(group instanceof PDFRadioGroup)) continue;
      if (option === null) group.clear();
      else if (group.getOptions().includes(option)) group.select(option);
      else {
        // PDF.js exposes widget appearance names. Some forms store separate export values.
        const buttonIndex = group.acroField.getWidgets().findIndex((widget) => widget.getOnValue()?.decodeText() === option);
        const exportValue = group.getOptions()[buttonIndex];
        if (exportValue !== undefined) group.select(exportValue);
      }
    }

    const hasSignatureOverlay = items.some((annotation) => annotation.type === "signature" || annotation.type === "initials");
    if (hasSignatureOverlay) {
      try {
        form.flatten({ updateFieldAppearances: true });
      } catch {
        form.updateFieldAppearances(font);
      }
    }

    const exportAnnotations = [
      ...items.filter((annotation) =>
        annotation.type !== "field" &&
        !(isChoiceAnnotation(annotation) && annotation.sourceFieldName) &&
        annotation.type !== "signature" &&
        annotation.type !== "initials",
      ),
      ...items.filter((annotation) => annotation.type === "signature" || annotation.type === "initials"),
    ];

    for (const annotation of exportAnnotations) {
      const page = pdf.getPage(annotation.page - 1);
      const sourcePage = await pdfDoc.getPage(annotation.page);
      const viewport = sourcePage.getViewport({ scale: 1 });
      const { width, height } = viewport;
      const [originX, originY] = viewport.convertToPdfPoint(0, height);
      const [rightX, rightY] = viewport.convertToPdfPoint(1, height);
      const [upX, upY] = viewport.convertToPdfPoint(0, height - 1);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(
        rightX - originX, rightY - originY, upX - originX, upY - originY, originX, originY,
      ));
      if (annotation.type !== "draw" && annotation.rotation && !(annotation.type === "watermark" && annotation.repeat)) {
        const x = (annotation.x + annotation.w / 2) * width;
        const y = height - (annotation.y + annotation.h / 2) * height;
        const angle = -annotation.rotation * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        page.pushOperators(concatTransformationMatrix(cos, sin, -sin, cos, x - x * cos + y * sin, y - x * sin - y * cos));
      }

      if (isTextAnnotation(annotation)) {
        if (annotation.detectedField) {
          page.pushOperators(rectangle(
            annotation.x * width, height - (annotation.y + annotation.h) * height, annotation.w * width, annotation.h * height,
          ), clip(), endPath());
        }
        if (annotation.background && annotation.type !== "detectedText") {
          const background = hexToRgb(annotation.background);
          page.drawRectangle({
            x: annotation.x * width,
            y: height - annotation.y * height - annotation.h * height,
            width: annotation.w * width,
            height: annotation.h * height,
            color: rgb(background.r, background.g, background.b),
            opacity: annotation.type === "watermark" ? 0 : 1,
          });
        }
        const color = hexToRgb(annotation.color);
        const opacity = annotation.type === "watermark" ? annotation.opacity ?? 0.22 : 1;
        if (annotation.type === "watermark" && annotation.repeat) {
          const text = annotation.text || "WATERMARK";
          const size = annotation.fontSize;
          const textWidth = font.widthOfTextAtSize(text, size);
          const gapX = Math.max(textWidth + (annotation.repeatSpacingX ?? 140), textWidth + 20);
          const gapY = Math.max(annotation.repeatSpacingY ?? 130, size * 1.5);
          for (let y = -height * 0.2; y < height * 1.25; y += gapY) {
            for (let x = -width * 0.1; x < width * 1.15; x += gapX) {
              page.drawText(text, {
                x,
                y,
                size,
                font: annotation.bold ? boldFont : font,
                color: rgb(color.r, color.g, color.b),
                opacity,
                rotate: degrees(-(annotation.rotation ?? -35)),
              });
            }
          }
          page.pushOperators(popGraphicsState());
          continue;
        }
        page.drawText(annotation.text || " ", {
          x: annotation.x * width,
          y: height - annotation.y * height - annotation.fontSize,
          size: annotation.fontSize,
          font: annotation.bold ? boldFont : font,
          color: rgb(color.r, color.g, color.b),
          opacity,
          maxWidth: annotation.w * width,
          lineHeight: annotation.fontSize * 1.18,
        });
      }

      if (isImageAnnotation(annotation)) {
        const imageBytes = await fetch(annotation.dataUrl).then((response) => response.arrayBuffer());
        const image = /^data:image\/jpe?g[;,]/i.test(annotation.dataUrl) ? await pdf.embedJpg(imageBytes) : await pdf.embedPng(imageBytes);
        const scale = Math.min(annotation.w * width / image.width, annotation.h * height / image.height);
        const imageWidth = image.width * scale;
        const imageHeight = image.height * scale;
        page.drawImage(image, {
          x: (annotation.x + annotation.w / 2) * width - imageWidth / 2,
          y: height - (annotation.y + annotation.h / 2) * height - imageHeight / 2,
          width: imageWidth,
          height: imageHeight,
        });
      }

      if (annotation.type === "draw") {
        const color = hexToRgb(annotation.color);
        if (annotation.points.length === 1) {
          const [point] = annotation.points;
          page.drawCircle({ x: point.x * width, y: height - point.y * height, size: annotation.width / 2, color: rgb(color.r, color.g, color.b) });
        }
        for (let index = 1; index < annotation.points.length; index += 1) {
          const previous = annotation.points[index - 1];
          const current = annotation.points[index];
          page.drawLine({
            start: { x: previous.x * width, y: height - previous.y * height },
            end: { x: current.x * width, y: height - current.y * height },
            thickness: annotation.width,
            color: rgb(color.r, color.g, color.b),
            lineCap: LineCapStyle.Round,
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
        const centerX = (annotation.x + annotation.w / 2) * width;
        const centerY = height - (annotation.y + annotation.h / 2) * height;
        const color = hexToRgb(choiceInk);
        const ink = rgb(color.r, color.g, color.b);
        const pointOnPage = ([x, y]: number[]) => ({
          x: centerX + (x / 100 - 0.5) * box,
          y: centerY + (0.5 - y / 100) * box,
        });
        if (annotation.type === "radio") {
          page.drawCircle({ x: centerX, y: centerY, size: box * 0.43, borderColor: ink, borderWidth: box * 0.08 });
          if (annotation.checked) page.drawCircle({ x: centerX, y: centerY, size: box * 0.23, color: ink });
          page.pushOperators(popGraphicsState());
          continue;
        }
        if (annotation.type === "checkbox") {
          page.drawRectangle({ ...pointOnPage([8, 92]), width: box * 0.84, height: box * 0.84, borderColor: ink, borderWidth: box * 0.08 });
        }
        if (annotation.checked) {
          const mark = annotation.mark ?? (annotation.type === "checkmark" ? "check" : "x");
          for (const points of mark === "check" ? [tickPoints] : crossPoints) {
            for (let index = 1; index < points.length; index += 1) {
              page.drawLine({ start: pointOnPage(points[index - 1]), end: pointOnPage(points[index]), thickness: box * 0.12, color: ink, lineCap: LineCapStyle.Round });
            }
          }
        }
      }

      if (annotation.type === "arrow" || annotation.type === "line") {
        const color = hexToRgb(annotation.color);
        const start = {
          x: (annotation.x + (annotation.reverseX ? annotation.w : 0)) * width,
          y: height - (annotation.y + (annotation.reverseY ? annotation.h : 0)) * height,
        };
        const end = {
          x: (annotation.x + (annotation.reverseX ? 0 : annotation.w)) * width,
          y: height - (annotation.y + (annotation.reverseY ? 0 : annotation.h)) * height,
        };
        page.drawLine({ start, end, thickness: annotation.width, color: rgb(color.r, color.g, color.b) });
        if (annotation.type === "arrow") {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLength = 12;
          for (const offset of [-Math.PI / 6, Math.PI / 6]) {
            page.drawLine({
              start: end,
              end: {
                x: end.x - headLength * Math.cos(angle + offset),
                y: end.y - headLength * Math.sin(angle + offset),
              },
              thickness: annotation.width,
              color: rgb(color.r, color.g, color.b),
            });
          }
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
      page.pushOperators(popGraphicsState());
    }

    return pdf.save();
  };

  const downloadOutput = (output: Uint8Array, name: string) => {
    const outputBuffer = new ArrayBuffer(output.byteLength);
    new Uint8Array(outputBuffer).set(output);
    const blob = new Blob([outputBuffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    try {
      const output = await buildPdfBytes();
      if (!output) return;
      downloadOutput(output, basePdfName(fileName) + "-filled.pdf");
      setStatus("Exported PDF");
    } catch (error) {
      setStatus(`Could not export PDF. ${error instanceof Error ? error.message : ""}`);
    }
  };

  const savePdf = async (mode: "save" | "saveAs" = "save") => {
    if (!activeTabId || savingRef.current) return false;
    savingRef.current = true;
    const saved = annotationsRef.current;
    const defaultName = currentPath && mode === "save" ? fileName : basePdfName(fileName) + "-filled.pdf";
    try {
      const output = await buildPdfBytes(saved);
      if (!output) return false;
      let path = currentPath;
      let name = fileName;
      if (window.pdfFillerDesktop) {
        const result = await window.pdfFillerDesktop.savePdfFile({
          defaultName,
          title: mode === "saveAs" ? "Save PDF As" : "Save PDF",
          targetPath: mode === "save" ? currentPath : null,
          protectedPath: mode === "saveAs" ? currentPath : null,
          bytes: Array.from(output),
        });
        if (result.canceled || result.blocked) {
          setStatus(result.reason || "Save canceled");
          return false;
        }
        path = result.filePath ?? currentPath;
        name = path?.split(/[\\/]/).pop() || fileName;
      } else {
        downloadOutput(output, defaultName);
      }
      const active = activeTabIdRef.current === activeTabId && pdfDocRef.current === pdfDoc;
      const currentItems = active ? annotationsRef.current : null;
      const unchanged = currentItems === saved;
      if (active) {
        savedAnnotationsRef.current = saved;
        setCurrentPath(path);
        setFileName(name);
        setIsDirty(!unchanged);
        setStatus(unchanged ? `Saved ${path ? name : defaultName}` : "Saved. Newer changes are still unsaved.");
      }
      setTabs((current) => current.map((tab) => tab.id === activeTabId && tab.pdfDoc === pdfDoc
        ? { ...tab, currentPath: path, fileName: name, savedAnnotations: saved, isDirty: (currentItems ?? tab.annotations) !== saved }
        : tab));
      return unchanged;
    } catch (error) {
      setStatus(`Could not save PDF. ${error instanceof Error ? error.message : ""}`);
      return false;
    } finally {
      savingRef.current = false;
    }
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

  savePdfRef.current = savePdf;
  printPdfRef.current = async () => {
    try {
      await printPdf();
    } catch (error) {
      setStatus(`Could not print PDF. ${error instanceof Error ? error.message : ""}`);
    }
  };
  saveBeforeDesktopCloseRef.current = async () => {
    if (isDirty && !await savePdf()) return;
    const next = tabs.find((tab) => tab.id !== activeTabId && tab.isDirty);
    if (next) {
      activateTab(next.id);
      setStatus("Save this document before closing.");
      return;
    }
    void window.pdfFillerDesktop?.closeAfterSave();
  };
  saveAndCloseRef.current = async () => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;
    if (await savePdf()) closeTab(tabId);
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
    if (!pdfBytes || !activeTabId || pageSizes.length <= 1) {
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
    await loadPdfBytes(payloadToArrayBuffer(bytes), fileName, currentPath, {
      tabId: activeTabId, annotations: nextAnnotations, activePage: Math.min(activePage, keep.length), status: `Deleted page ${activePage}.`,
    });
  };

  const rotateActivePage = async (direction: -1 | 1 = 1) => {
    if (!pdfBytes || !activeTabId) return;
    const pdf = await PDFDocument.load(pdfBytes.slice(0));
    const page = pdf.getPage(activePage - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + direction * 90 + 360) % 360));
    const bytes = await pdf.save();
    const preservedAnnotations = annotations.map((annotation) => rotateAnnotation(annotation, activePage, pageSizes[activePage - 1], direction));
    await loadPdfBytes(payloadToArrayBuffer(bytes), fileName, currentPath, {
      tabId: activeTabId, annotations: preservedAnnotations, activePage, status: `Rotated page ${activePage} ${direction === 1 ? "right" : "left"}.`,
    });
  };

  const organizeCurrentPages = async (order: number[]) => {
    if (!pdfBytes || !activeTabId || order.length !== pageSizes.length) {
      setStatus("Open a PDF before organizing pages.");
      return;
    }
    const uniquePages = new Set(order);
    const validOrder = order.every((page) => Number.isInteger(page) && page >= 1 && page <= pageSizes.length);
    if (!validOrder || uniquePages.size !== pageSizes.length) {
      setStatus("Page order is invalid.");
      return;
    }
    const changed = order.some((page, index) => page !== index + 1);
    if (!changed) {
      setOrganizeOpen(false);
      setStatus("Page order unchanged.");
      return;
    }

    setStatus("Reordering pages...");
    const pageMap = new Map(order.map((oldPage, index) => [oldPage, index + 1]));
    const nextAnnotations = annotations.map((annotation) => {
      const nextPage = pageMap.get(annotation.page) ?? annotation.page;
      const next = { ...annotation, page: nextPage } as Annotation;
      if (next.type === "pageNumber") next.text = String(nextPage);
      return next;
    });
    const activeIndex = order.indexOf(activePage);
    const nextActivePage = activeIndex >= 0 ? activeIndex + 1 : 1;

    const source = await PDFDocument.load(pdfBytes.slice(0));
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, order.map((page) => page - 1));
    pages.forEach((page) => output.addPage(page));
    const bytes = await output.save();

    await loadPdfBytes(payloadToArrayBuffer(bytes), fileName, currentPath, {
      tabId: activeTabId, annotations: nextAnnotations, activePage: nextActivePage, status: "Pages reordered.",
    });
    setOrganizeOpen(false);
  };

  const addPageNumbers = () => {
    if (!pageSizes.length) return;
    changeAnnotations((current) => [
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
    if (item === "Save As") void savePdf("saveAs");
    if (item === "Export PDF") void downloadPdf();
    if (item === "Print") void printPdfRef.current();
    if (item === "Merge PDFs") setMergeOpen(true);
    if (item === "Split PDF" || item === "Split") setSplitOpen(true);
    if (item === "Extract pages from file") setExtractPagesOpen(true);
    if (item === "Remove pages from file") setRemovePagesOpen(true);
    if (item === "Organize pages") setOrganizeOpen(true);
    if (item === "Add page numbers") addPageNumbers();
    if (item === "Edit PDF") setTool("editText");
    if (item === "Check Text") void checkTextOnActivePage();
    if (item === "Add Text") setTool("text");
    if (item === "Add Images") {
      setTool("image");
      imageUploadRef.current?.click();
    }
    if (item === "Erase") setTool("eraser");
    if (item === "Watermark") addWatermark();
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
    changeAnnotations(() => data.annotations ?? []);
  };

  const goToPage = (page: number) => {
    const scroller = documentScrollerRef.current;
    const tabPage = pageRefs.current[page];
    if (!scroller || !tabPage) return;
    scroller.scrollTop += tabPage.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
    setActivePage(page);
  };

  const getFitZoom = (pageSize?: PageSize) => {
    const scroller = documentScrollerRef.current;
    if (!scroller || !pageSize) return 1;
    const { paddingLeft, paddingRight } = getComputedStyle(scroller);
    const width = scroller.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight) - 12;
    return clamp(Math.floor(width / pageSize.width * 100) / 100, 0.45, 2.5);
  };

  const updateActivePageFromScroll = () => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      const scroller = documentScrollerRef.current;
      if (!scroller || !pdfDocRef.current) return;
      const bounds = scroller.getBoundingClientRect();
      const targetY = bounds.top + Math.min(scroller.clientHeight * 0.25, 120);
      let closestPage = 1;
      let bestDistance = Infinity;
      for (const node of Object.values(pageRefs.current)) {
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const distance = Math.max(rect.top - targetY, targetY - rect.bottom, 0);
        if (distance < bestDistance) {
          closestPage = Number(node.dataset.page);
          bestDistance = distance;
        }
        if (bestDistance === 0 || rect.top > targetY) break;
      }
      setActivePage(closestPage);
    });
  };

  useLayoutEffect(() => {
    const pending = pendingPageScrollRef.current;
    const scroller = documentScrollerRef.current;
    if (!pending || !scroller) return;
    pendingPageScrollRef.current = null;
    if (pending.scroll) {
      scroller.scrollTo(pending.scroll.left, pending.scroll.top);
    } else {
      scroller.scrollTo(0, 0);
      if (pending.page > 1) goToPage(pending.page);
    }
  }, [pdfDoc]);

  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), []);

  const zoomBy = useCallback((delta: number, clientX?: number, clientY?: number) => {
    const scroller = documentScrollerRef.current;
    const pageFromPointer =
      typeof clientX === "number" && typeof clientY === "number"
        ? (document.elementFromPoint(clientX, clientY)?.closest(".pageWrap") as HTMLElement | null)
        : null;
    const page = Number(pageFromPointer?.dataset.page || activePage || 1);
    const pageEl = pageRefs.current[page]?.querySelector(".page");
    if (scroller && pageEl) {
      const scrollerRect = scroller.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const anchorX = typeof clientX === "number" ? clientX : scrollerRect.left + scroller.clientWidth / 2;
      const anchorY = typeof clientY === "number" ? clientY : scrollerRect.top + scroller.clientHeight / 2;
      pendingZoomAnchorRef.current = {
        page,
        xRatio: clamp((anchorX - pageRect.left) / Math.max(pageRect.width, 1), 0, 1),
        yRatio: clamp((anchorY - pageRect.top) / Math.max(pageRect.height, 1), 0, 1),
        clientX: anchorX,
        clientY: anchorY,
      };
      setActivePage(page);
    }
    setZoom((value) => {
      const next = clamp(Number((value + delta).toFixed(2)), 0.45, 2.5);
      if (next === value) pendingZoomAnchorRef.current = null;
      return next;
    });
  }, [activePage]);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const scroller = documentScrollerRef.current;
    if (!anchor || !scroller) return;
    pendingZoomAnchorRef.current = null;
    const pageEl = pageRefs.current[anchor.page]?.querySelector(".page");
    if (!pageEl) return;
    const pageRect = pageEl.getBoundingClientRect();
    const targetX = pageRect.left + pageRect.width * anchor.xRatio;
    const targetY = pageRect.top + pageRect.height * anchor.yRatio;
    scroller.scrollLeft += targetX - anchor.clientX;
    scroller.scrollTop += targetY - anchor.clientY;
    setActivePage(anchor.page);
  }, [zoom]);

  const onDocumentWheel = useCallback((event: WheelEvent) => {
    const scroller = documentScrollerRef.current;
    if (!event.ctrlKey || event.defaultPrevented || !scroller || !pdfDoc) return;
    const target = event.target instanceof Node ? event.target : null;
    const rect = scroller.getBoundingClientRect();
    const pointerIsOverScroller =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!pointerIsOverScroller && (!target || !scroller.contains(target))) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.deltaY === 0) return;
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1, event.clientX, event.clientY);
  }, [pdfDoc, zoomBy]);

  useEffect(() => {
    window.addEventListener("wheel", onDocumentWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onDocumentWheel, { capture: true });
  }, [onDocumentWheel]);

  const selectedSignatureAssets = assets.filter((asset) => asset.kind === "signature");
  const selectedInitialAssets = assets.filter((asset) => asset.kind === "initials");
  const enterEditor = () => {
    setShowUpdateGate(false);
    setStartupReady(true);
  };
  const downloadAndInstallUpdate = () => {
    void window.pdfFillerDesktop?.downloadUpdate({ reopenPath: currentPath ?? pendingInitialPdfRef.current?.path ?? null });
  };

  const pageHandlers = useRef({
    handlePagePointerDown, handlePagePointerMove, finishPagePointer, startAnnotationDrag, removeAnnotation, updateAnnotation, activateFillZone, setChoiceChecked,
  });
  pageHandlers.current = {
    handlePagePointerDown, handlePagePointerMove, finishPagePointer, startAnnotationDrag, removeAnnotation, updateAnnotation, activateFillZone, setChoiceChecked,
  };
  const pageEvents = useMemo(() => ({
    onPointerDown: (...args: Parameters<typeof handlePagePointerDown>) => pageHandlers.current.handlePagePointerDown(...args),
    onPointerMove: (...args: Parameters<typeof handlePagePointerMove>) => pageHandlers.current.handlePagePointerMove(...args),
    onPointerUp: () => pageHandlers.current.finishPagePointer(),
    onPointerLeave: clearPlacementPreviews,
    onAnnotationDrag: (...args: Parameters<typeof startAnnotationDrag>) => pageHandlers.current.startAnnotationDrag(...args),
    onRemove: (id: string) => pageHandlers.current.removeAnnotation(id),
    onUpdate: (id: string, patch: Partial<Annotation>) => pageHandlers.current.updateAnnotation(id, patch),
    onFill: (zone: DetectedFillZone) => pageHandlers.current.activateFillZone(zone),
    onToggleChoice: (id: string) => pageHandlers.current.setChoiceChecked(id),
    onPageRef: (page: number, node: HTMLElement | null) => { pageRefs.current[page] = node; },
    onSelect: (id: string) => {
      setSelectedId(id);
      setEditingId(null);
    },
    onEdit: (id: string) => {
      const annotation = annotationsRef.current.find((candidate) => candidate.id === id);
      if (annotation) setActivePage(annotation.page);
      setSelectedId(id);
      setEditingId(id);
    },
  }), [clearPlacementPreviews]);

  if (isDesktop && !startupReady) {
    return (
      <UpdateGate
        appVersion={appVersion}
        state={updateState}
        onUpdate={downloadAndInstallUpdate}
        onContinue={enterEditor}
      />
    );
  }

  return (
    <div className="shell">
      <header className="globalNav">
        <div className="globalBrand">
          <span className="brandMark compact"><FileText size={18} /></span>
          <strong>PDF Filler</strong>
        </div>
        <nav className="menuBar" ref={menuBarRef} aria-label="Application menu">
          {topMenus.map((menu) => (
            <div className="menuWrap" key={menu.title}>
              <button
                className={activeMenu === menu.title ? "menuButton active" : "menuButton"}
                onClick={() => setActiveMenu((current) => (current === menu.title ? null : menu.title))}
                aria-expanded={activeMenu === menu.title}
              >
                {menu.title}
                <ChevronDown size={13} />
              </button>
              {activeMenu === menu.title && (
                <div className="menuDropdown">
                  {menu.items.map((item) => (
                    <button key={item} disabled={!pdfDoc && !fileActionsWithoutDocument.has(item)} onClick={() => runTopMenuAction(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="fileActions">
          <button onClick={() => document.getElementById("pdf-upload")?.click()} title="Open PDF" aria-label="Open PDF"><Upload size={16} /><span>Open</span></button>
          <button disabled={!pdfDoc} onClick={() => void downloadPdf()} title="Export PDF" aria-label="Export"><Download size={16} /><span>Export</span></button>
          <button className="primaryAction" disabled={!pdfDoc} onClick={() => void savePdf()} title="Save PDF" aria-label="Save"><Save size={16} /><span>Save</span></button>
        </div>
      </header>
      <div className="documentTabs" aria-label="Open documents">
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.id === activeTabId ? "docTab active" : "docTab"}>
            <button className="docTabTitle" onClick={() => activateTab(tab.id)} title={tab.fileName} aria-pressed={tab.id === activeTabId}>
              <FileText size={14} />
              <span>{tab.fileName}</span>
              {tab.isDirty && <span className="dirtyDot" title="Unsaved changes" aria-label="Unsaved changes" />}
            </button>
            <button className="docTabClose" onClick={() => requestCloseTab(tab.id)} title="Close tab" aria-label={`Close ${tab.fileName}`}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <main className={`app${showInspector ? "" : " inspectorHidden"}`}>
      <aside className="rail" aria-label="Tools">
        <div className="sidebarSwitch" aria-label="Sidebar">
          <button aria-pressed={sidebarView === "tools"} onClick={() => setSidebarView("tools")}>Tools</button>
          <button aria-pressed={sidebarView === "pages"} onClick={() => setSidebarView("pages")}>Pages</button>
        </div>

        {sidebarView === "tools" && <div className="toolGroups">
          {toolGroups.map((group) => <section className="toolGroup" key={group.title}>
          <h2 className="toolSectionTitle">{group.title}</h2>
          <div className="toolGrid">
            {group.tools.map((toolId) => {
              const { id, label, Icon } = primaryTools.find((item) => item.id === toolId)!;
              return (
              <button
                className={tool === id ? "tool active" : "tool"}
                key={id}
                disabled={!pdfDoc}
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
                aria-pressed={tool === id}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
              );
            })}
          </div>
          </section>)}
        </div>}
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

        <input
          hidden
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
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
            event.target.value = "";
            if (file && pageSizes.length) void readPlacementImage(file);
          }}
        />
        {sidebarView === "pages" && (
          <div className="thumbnailPane">
            <button className="wideButton" disabled={!pdfDoc} onClick={() => setOrganizeOpen(true)}>
              <Columns3 size={16} /> Organize pages
            </button>
            {!pdfDoc && <p className="muted">Open a PDF to see its pages.</p>}
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
          <div className="documentTitle">
            <strong>{primaryTools.find(({ id }) => id === tool)?.label}</strong>
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
            <button onClick={() => void checkTextOnActivePage()} disabled={!pdfDoc || ocrBusy} title="Check scanned or handwritten text on this page">
              <Wand2 size={17} />
              <span>Check text</span>
            </button>
            <button onClick={() => setShowInspector((current) => !current)} title="Toggle properties" aria-label="Toggle properties" aria-pressed={showInspector}>
              <PanelRight size={17} />
            </button>
          </div>
        </header>

        <div ref={documentScrollerRef} className={pdfDoc ? "documentScroller" : "documentScroller empty"}
          onScroll={updateActivePageFromScroll}
          onPointerDown={(event) => {
            if (event.button === 0 && !(event.target as Element).closest(".page")) {
              setSelectedId(null);
              setEditingId(null);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            const file = event.dataTransfer.files[0];
            if (!file) return;
            event.preventDefault();
            if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") void loadPdf(file);
            else setStatus("Choose a PDF file.");
          }}
        >
          {!pdfDoc && (
            <label className="dropzone">
              <span className="dropzoneIcon"><FileText size={32} /></span>
              <strong>Open a PDF</strong>
              <span>Drop a PDF here or browse your files.</span>
              <span className="dropzoneAction"><Upload size={16} /> Browse files</span>
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
                annotations={annotationsByPage.get(index + 1) ?? emptyAnnotations}
                textZones={textZonesByPage.get(index + 1) ?? emptyTextZones}
                fillZones={fillZonesByPage.get(index + 1) ?? emptyFillZones}
                showTextZones={tool === "editText"}
                fillMode={tool === "select"}
                editFillEntries={tool === "select" || tool === "text"}
                placementMode={["date", "signature", "initials", "checkbox", "radio", "checkmark", "image", "draw", "eraser", "whiteout", "highlight", "circle", "rectangle", "line", "arrow"].includes(tool)}
                markupMode={["draw", "eraser", "whiteout", "highlight", "circle", "rectangle", "line", "arrow"].includes(tool)}
                selectedId={selected?.page === index + 1 ? selectedId : null}
                editingId={selected?.page === index + 1 ? editingId : null}
                draftBox={draftBox?.page === index + 1 ? draftBox : null}
                placementPreview={placementPreview?.page === index + 1 ? placementPreview : null}
                imagePlacementPreview={imagePlacementPreview?.page === index + 1 ? imagePlacementPreview : null}
                eraserPreview={eraserPreview?.page === index + 1 ? eraserPreview : null}
                eraserSize={eraserSize}
                eraserOpacity={eraserOpacity}
                shapeStrokeColor={shapeStrokeColor}
                shapeStrokeWidth={shapeStrokeWidth}
                {...pageEvents}
                onVisible={ensurePageAnalyzed}
              />
            ))}
        </div>
        <footer className="documentStatus">
          <span className="statusMessage" role="status" title={status}>{status}</span>
          {pdfDoc && <>
            <div className="statusControls" aria-label="Page navigation">
              <button onClick={() => goToPage(activePage - 1)} disabled={activePage <= 1} title="Previous page" aria-label="Previous page"><ChevronLeft size={16} /></button>
              <span>Page {activePage} of {pageSizes.length}</span>
              <button onClick={() => goToPage(activePage + 1)} disabled={activePage >= pageSizes.length} title="Next page" aria-label="Next page"><ChevronRight size={16} /></button>
            </div>
            <div className="statusControls" aria-label="Zoom controls">
              <button onClick={() => zoomBy(-0.1)} disabled={zoom <= 0.45} title="Zoom out" aria-label="Zoom out"><ZoomOut size={16} /></button>
              <button className="zoomValue" onClick={() => zoomBy(getFitZoom(pageSizes[activePage - 1]) - zoom)} title="Fit page width" aria-label="Fit page width">{Math.round(zoom * 100)}%</button>
              <button onClick={() => zoomBy(0.1)} disabled={zoom >= 2.5} title="Zoom in" aria-label="Zoom in"><ZoomIn size={16} /></button>
            </div>
          </>}
        </footer>
      </section>

      <aside className="inspector" hidden={!showInspector} aria-label="Properties">
        <div className="inspectorHeader"><h2>Properties</h2><button onClick={() => setShowInspector(false)} title="Hide properties" aria-label="Hide properties"><X size={16} /></button></div>
        <section>
          {!selected && <p className="muted inspectorEmpty">Select an item on the page to edit its properties.</p>}
          {selected && (
            <SelectedInspector
              annotation={selected}
              update={(patch) => {
                if (isChoiceAnnotation(selected) && isFixedFill(selected) && "checked" in patch) setChoiceChecked(selected.id, patch.checked);
                else updateAnnotation(selected.id, patch);
              }}
              remove={() => removeAnnotation(selected.id)}
            />
          )}
        </section>

        <details className="inspectorPanel">
          <summary>Signatures</summary>
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
          <AssetPreview asset={selectedSignatureAssets.find((asset) => asset.id === activeSignature)} emptyLabel="No signature selected" />
          <label>Initials</label>
          <select value={activeInitials} onChange={(event) => setActiveInitials(event.target.value)}>
            <option value="">None saved</option>
            {selectedInitialAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
          </select>
          <AssetPreview asset={selectedInitialAssets.find((asset) => asset.id === activeInitials)} emptyLabel="No initials selected" />
        </details>

        <details className="inspectorPanel">
          <summary>Prefill</summary>
          <textarea
            value={prefillText}
            onChange={(event) => setPrefillText(event.target.value)}
            placeholder={"Name = Alex Smith\nAddress = 10 Main Street\nApproved = yes"}
          />
          <button className="wideButton" disabled={!pdfBytes} onClick={applyPrefill}>
            <Wand2 size={18} />
            Populate
          </button>
        </details>

        <details className="inspectorPanel">
          <summary>Tool styles</summary>
          <label>Text color</label>
          <ColorRow value={textColor} onChange={setTextColor} />
          <label>Ink color</label>
          <ColorRow value={drawColor} onChange={setDrawColor} />
          <label>Ink width</label>
          <input type="range" min="1" max="12" value={drawWidth} onChange={(event) => setDrawWidth(Number(event.target.value))} />
        </details>

        {isDesktop && (
          <details className="inspectorPanel">
            <summary>Desktop settings</summary>
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
          </details>
        )}

      </aside>

      {pendingCloseTabId && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="close-tab-title">
          <div className="modalCard confirmModal">
            <h2 id="close-tab-title">Save changes?</h2>
            <p>You have unsaved changes in {fileName}.</p>
            <div className="modalActions">
              <button onClick={() => setPendingCloseTabId(null)}>Cancel</button>
              <button
                className="dangerAction"
                onClick={() => {
                  const id = pendingCloseTabId;
                  setPendingCloseTabId(null);
                  closeTab(id);
                }}
              >
                Discard
              </button>
              <button
                className="primaryAction"
                onClick={() => {
                  const id = pendingCloseTabId;
                  void savePdf().then((saved) => {
                    if (!saved) return;
                    setPendingCloseTabId(null);
                    closeTab(id);
                  });
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

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
          currentFile={pdfBytes ? new File([pdfBytes.slice(0)], fileName, { type: "application/pdf", lastModified: 0 }) : null}
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
      {organizeOpen && pdfDoc && (
        <OrganizePagesModal
          doc={pdfDoc}
          fileName={fileName}
          pageCount={pageSizes.length}
          onClose={() => setOrganizeOpen(false)}
          onApply={(order) => void organizeCurrentPages(order)}
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
      {(ocrBusy || ocrResult || ocrError) && (
        <OcrReviewModal
          busy={ocrBusy}
          progress={ocrProgress}
          result={ocrResult}
          error={ocrError}
          onClose={() => {
            ocrCancelRef.current = true;
            setOcrBusy(false);
            setOcrResult(null);
            setOcrError("");
          }}
          onUseText={(text) => {
            if (!text.trim()) return;
            createTextAnnotation(activePage, { x: 0.08, y: 0.12 }, { text: text.trim(), w: 0.64, h: 0.16, fontSize: 13 });
            setOcrResult(null);
          }}
        />
      )}
      {isDesktop && showUpdateGate && (
        <UpdateGate
          appVersion={appVersion}
          state={updateState}
          onUpdate={downloadAndInstallUpdate}
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
  const canContinue = ["checking", "available", "error", "disabled", "development"].includes(state.phase);
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

function AssetPreview({ asset, emptyLabel }: { asset?: SignatureAsset; emptyLabel: string }) {
  return (
    <div className={asset ? "assetPreview" : "assetPreview empty"}>
      {asset ? <img src={asset.dataUrl} alt={`${asset.label} preview`} /> : <span>{emptyLabel}</span>}
    </div>
  );
}

const PdfPage = memo(function PdfPage({
  doc,
  pageIndex,
  pageSize,
  zoom,
  active,
  annotations,
  textZones,
  fillZones,
  showTextZones,
  fillMode,
  editFillEntries,
  placementMode,
  markupMode,
  selectedId,
  editingId,
  draftBox,
  placementPreview,
  imagePlacementPreview,
  eraserPreview,
  eraserSize,
  eraserOpacity,
  shapeStrokeColor,
  shapeStrokeWidth,
  onPageRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onAnnotationDrag,
  onRemove,
  onSelect,
  onEdit,
  onUpdate,
  onFill,
  onToggleChoice,
  onVisible,
}: {
  doc: any;
  pageIndex: number;
  pageSize: PageSize;
  zoom: number;
  active: boolean;
  annotations: Annotation[];
  textZones: TextZone[];
  fillZones: DetectedFillZone[];
  showTextZones: boolean;
  fillMode: boolean;
  editFillEntries: boolean;
  placementMode: boolean;
  markupMode: boolean;
  selectedId: string | null;
  editingId: string | null;
  draftBox: DraftBox | null;
  placementPreview: { page: number; x: number; y: number; tool: ChoiceAnnotation["type"] } | null;
  imagePlacementPreview: { page: number; x: number; y: number; w: number; h: number; dataUrl: string; label: string } | null;
  eraserPreview: { page: number; x: number; y: number } | null;
  eraserSize: number;
  eraserOpacity: number;
  shapeStrokeColor: string;
  shapeStrokeWidth: number;
  onPageRef: (page: number, node: HTMLElement | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, pageIndex: number) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onAnnotationDrag: (event: React.PointerEvent, annotation: Annotation, pageSize: PageSize, mode: "move" | "resize" | "rotate") => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onFill: (zone: DetectedFillZone) => void;
  onToggleChoice: (id: string) => void;
  onVisible: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [renderedDocument, setRenderedDocument] = useState<unknown>(null);
  const isRendered = renderedDocument === doc;

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    const render = async () => {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: zoom });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const scratch = document.createElement("canvas");
      scratch.width = Math.ceil(viewport.width * pixelRatio);
      scratch.height = Math.ceil(viewport.height * pixelRatio);
      const scratchContext = scratch.getContext("2d");
      const canvas = canvasRef.current;
      if (!canvas || !scratchContext || cancelled) return;
      scratchContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      scratchContext.fillStyle = "#ffffff";
      scratchContext.fillRect(0, 0, viewport.width, viewport.height);
      const task = page.render({ canvasContext: scratchContext, viewport, background: "#ffffff", annotationMode: AnnotationMode.ENABLE_FORMS });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) {
          console.warn("PDF page render failed", error);
        }
        return;
      }
      if (cancelled || !canvasRef.current) return;
      const visible = canvasRef.current;
      const context = visible.getContext("2d");
      if (!context) return;
      visible.width = scratch.width;
      visible.height = scratch.height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(scratch, 0, 0);
      setRenderedDocument(doc);
    };
    void render().catch((error) => {
      if (!cancelled) console.warn("PDF page render failed", error);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageIndex, shouldRender, zoom]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const pageNumber = pageIndex + 1;
    if (!("IntersectionObserver" in window)) {
      setShouldRender(true);
      onVisible(pageNumber);
      return;
    }
    const root = node.closest(".documentScroller");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldRender(true);
        onVisible(pageNumber);
      },
      { root, rootMargin: "1400px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [doc, onVisible, pageIndex]);

  const setWrapRef = useCallback((node: HTMLElement | null) => {
    wrapRef.current = node;
    onPageRef(pageIndex + 1, node);
  }, [onPageRef, pageIndex]);

  const displayWidth = pageSize.width * zoom;
  const displayHeight = pageSize.height * zoom;
  const filledTargets = new Set(annotations.flatMap((annotation) =>
    (isChoiceAnnotation(annotation) || isTextAnnotation(annotation)) && annotation.detectedField ? [annotation.detectedField.id] : [],
  ));

  return (
    <article ref={setWrapRef} className={active ? "pageWrap active" : "pageWrap"} data-page={pageIndex + 1} style={{ containIntrinsicSize: `${displayWidth}px ${displayHeight + 25}px` }}>
      <div className="pageNumber">Page {pageIndex + 1}</div>
      <div
        className={`page${placementMode ? " placementMode" : ""}${markupMode ? " markupMode" : ""}`}
        data-page={pageIndex + 1}
        style={{ width: displayWidth, height: displayHeight }}
        onPointerDown={(event) => onPointerDown(event, pageIndex)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <canvas ref={canvasRef} className={isRendered ? "pdfCanvas ready" : "pdfCanvas"} style={{ width: displayWidth, height: displayHeight }} />
        {!isRendered && <div className="pageLoading" aria-hidden="true" />}
        <div className="annotationLayer">
          {fillMode && fillZones.filter((zone) => !filledTargets.has(zone.id)).map((zone) => (
            <button
              key={zone.id}
              type="button"
              className={`fillTarget ${zone.kind}`}
              style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` }}
              aria-label={zone.label}
              aria-pressed={zone.kind === "checkbox" ? false : undefined}
              title={zone.label}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onFill(zone)}
            />
          ))}
          {showTextZones && textZones.map((zone) => <div key={zone.id} className="textZone" style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` }} />)}
          {annotations.map((annotation) => (
            <AnnotationView
              key={annotation.id}
              annotation={annotation}
              selected={selectedId === annotation.id}
              editing={editingId === annotation.id}
              editFillEntries={editFillEntries}
              pageSize={pageSize}
              zoom={zoom}
              onDrag={onAnnotationDrag}
              onRemove={onRemove}
              onSelect={onSelect}
              onEdit={onEdit}
              onUpdate={onUpdate}
              onToggleChoice={onToggleChoice}
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
            >
              {(draftBox.type === "line" || draftBox.type === "arrow") && (
                <ArrowOverlay
                  color={shapeStrokeColor}
                  width={shapeStrokeWidth}
                  arrow={draftBox.type === "arrow"}
                  reverseX={draftBox.w < 0}
                  reverseY={draftBox.h < 0}
                  boxWidth={Math.max(Math.abs(draftBox.w) * pageSize.width * zoom, 1)}
                  boxHeight={Math.max(Math.abs(draftBox.h) * pageSize.height * zoom, 1)}
                />
              )}
            </div>
          )}
          {placementPreview && (() => {
            const size = (placementPreview.tool === "checkmark" ? 20 : 17) * zoom;
            return (
              <div className="placementPreview" style={{
                left: clamp(placementPreview.x * displayWidth - size / 2, 0, displayWidth - size),
                top: clamp(placementPreview.y * displayHeight - size / 2, 0, displayHeight - size),
                width: size,
                height: size,
              }}>
                <ChoiceMark type={placementPreview.tool} checked />
              </div>
            );
          })()}
          {imagePlacementPreview && (
            <img
              className="imagePlacementPreview"
              src={imagePlacementPreview.dataUrl}
              alt={imagePlacementPreview.label}
              style={{
                left: `${imagePlacementPreview.x * 100}%`,
                top: `${imagePlacementPreview.y * 100}%`,
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
});

const AnnotationView = memo(function AnnotationView({
  annotation,
  selected,
  editing,
  editFillEntries,
  pageSize,
  zoom,
  onDrag,
  onRemove,
  onSelect,
  onEdit,
  onUpdate,
  onToggleChoice,
}: {
  annotation: Annotation;
  selected: boolean;
  editing: boolean;
  editFillEntries: boolean;
  pageSize: PageSize;
  zoom: number;
  onDrag: (event: React.PointerEvent, annotation: Annotation, pageSize: PageSize, mode: "move" | "resize" | "rotate") => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onToggleChoice: (id: string) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if ("select" in input) input.select();
  }, [editing]);

  if (annotation.type === "draw") {
    const points = annotation.points.length === 1 ? [...annotation.points, annotation.points[0]] : annotation.points;
    const path = points
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
          strokeWidth={annotation.width * zoom}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
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
    transform: annotation.type === "watermark" && annotation.repeat ? undefined : `rotate(${annotation.rotation ?? 0}deg)`,
    transformOrigin: "center",
  };
  const watermarkCopies = Array.from({ length: 24 });
  const fixed = isFixedFill(annotation);
  const canFill = fixed && editFillEntries;
  const fillLabel = isChoiceAnnotation(annotation) || isTextAnnotation(annotation)
    ? annotation.detectedField?.label ?? (isChoiceAnnotation(annotation) ? annotation.sourceLabel ?? annotation.sourceFieldName : undefined)
    : annotation.type === "field" ? annotation.name : undefined;

  return (
    <div
      className={`annotation ${annotation.type} ${selected ? "selected" : ""} ${editing ? "editing" : ""}${fixed ? " fixedFill" : ""}`}
      style={style}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (fixed) return;
        if (isTextAnnotation(annotation) || annotation.type === "field") onEdit(annotation.id);
        else onSelect(annotation.id);
      }}
      onPointerDown={(event) => {
        if (fixed) event.stopPropagation();
        else onDrag(event, annotation, pageSize, "move");
      }}
    >
      {isTextAnnotation(annotation) && annotation.type === "watermark" && annotation.repeat && (
        <div
          className="watermarkRepeat"
          style={{
            color: annotation.color,
            fontSize: annotation.fontSize * zoom,
            fontWeight: annotation.bold ? 700 : 400,
            opacity: annotation.opacity ?? 0.22,
            columnGap: annotation.repeatSpacingX ?? 140,
            rowGap: annotation.repeatSpacingY ?? 130,
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
            aria-label={fillLabel || "Annotation text"}
            style={{ color: annotation.color, fontSize: annotation.fontSize * zoom, fontWeight: annotation.bold ? 700 : 400, background: annotation.type === "detectedText" ? "transparent" : annotation.background ?? "transparent", opacity: annotation.type === "watermark" ? annotation.opacity ?? 0.22 : 1 }}
          />
        ) : canFill ? (
          <button className="textAnnotation fillEntry" type="button" aria-label={fillLabel}
            onClick={() => onEdit(annotation.id)}
            style={{ color: annotation.color, fontSize: annotation.fontSize * zoom, fontWeight: annotation.bold ? 700 : 400 }}>
            {annotation.text}
          </button>
        ) : (
          <div className="textAnnotation" style={{ color: annotation.color, fontSize: annotation.fontSize * zoom, fontWeight: annotation.bold ? 700 : 400, background: annotation.type === "detectedText" ? "transparent" : annotation.background, opacity: annotation.type === "watermark" ? annotation.opacity ?? 0.22 : 1 }}>
            {annotation.text}
          </div>
        )
      )}
      {annotation.type === "field" && (
        editing && annotation.multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className="liveTextInput"
            aria-label={annotation.name}
            value={annotation.value}
            onChange={(event) => onUpdate(annotation.id, { value: event.target.value })}
            style={{ fontSize: annotation.fontSize * zoom }}
          />
        ) : editing ? (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className="liveTextInput"
            aria-label={annotation.name}
            value={annotation.value}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onUpdate(annotation.id, { value: event.target.value })}
            style={{ fontSize: annotation.fontSize * zoom }}
          />
        ) : canFill && !annotation.readOnly ? (
          <button className="fieldAnnotation fillEntry" type="button" aria-label={annotation.name}
            onClick={() => onEdit(annotation.id)} style={{ fontSize: annotation.fontSize * zoom }}>
            {annotation.value}
          </button>
        ) : (
          <div className="fieldAnnotation" style={{ fontSize: annotation.fontSize * zoom }}>{annotation.value}</div>
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
        canFill && !annotation.readOnly ? (
          <button className="fillEntry choice" type="button" aria-label={fillLabel || "Checkbox"} aria-pressed={annotation.checked}
            onClick={() => onToggleChoice(annotation.id)}>
            <ChoiceMark type={annotation.type} checked={annotation.checked} mark={annotation.mark} />
          </button>
        ) : <ChoiceMark type={annotation.type} checked={annotation.checked} mark={annotation.mark} />
      )}
      {(annotation.type === "arrow" || annotation.type === "line") && (
        <ArrowOverlay
          color={annotation.color}
          width={annotation.width}
          arrow={annotation.type === "arrow"}
          reverseX={annotation.reverseX}
          reverseY={annotation.reverseY}
          boxWidth={Math.max(annotation.w * pageSize.width * zoom, 1)}
          boxHeight={Math.max(annotation.h * pageSize.height * zoom, 1)}
        />
      )}
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
      {selected && !fixed && (
        <>
          <button className="deleteBubble" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(annotation.id); }} title="Delete" aria-label="Delete annotation"><Trash2 size={13} /></button>
          <button className="rotateHandle" onPointerDown={(event) => onDrag(event, annotation, pageSize, "rotate")} title="Drag to rotate"><RotateCw size={12} /></button>
          <button className="resizeHandle" onPointerDown={(event) => onDrag(event, annotation, pageSize, "resize")} title="Resize" aria-label="Resize annotation" />
        </>
      )}
    </div>
  );
});

function ChoiceMark({ type, checked, mark = type === "checkmark" ? "check" : "x" }: Pick<ChoiceAnnotation, "type" | "checked" | "mark">) {
  const points = mark === "check" ? [tickPoints] : crossPoints;
  return (
    <svg className="choiceMark" viewBox="0 0 100 100" fill="none" stroke={choiceInk} strokeWidth="8" aria-hidden="true">
      {type === "checkbox" && <rect x="8" y="8" width="84" height="84" />}
      {type === "radio" && <circle cx="50" cy="50" r="43" />}
      {type === "radio" && checked && <circle cx="50" cy="50" r="23" fill={choiceInk} stroke="none" />}
      {type !== "radio" && checked && points.map((path, index) => (
        <polyline key={index} points={path.map((point) => point.join(",")).join(" ")} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function ArrowOverlay({ color, width, arrow = true, reverseX = false, reverseY = false, boxWidth = 100, boxHeight = 100 }: { color: string; width: number; arrow?: boolean; reverseX?: boolean; reverseY?: boolean; boxWidth?: number; boxHeight?: number }) {
  const safeWidth = Math.max(boxWidth, 1);
  const safeHeight = Math.max(boxHeight, 1);
  const pad = Math.min(6, Math.max(1, Math.min(safeWidth, safeHeight) * 0.1));
  const start = { x: reverseX ? safeWidth - pad : pad, y: reverseY ? safeHeight - pad : pad };
  const end = { x: reverseX ? pad : safeWidth - pad, y: reverseY ? pad : safeHeight - pad };
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const lineLength = Math.hypot(end.x - start.x, end.y - start.y);
  const headLength = Math.min(Math.max(width * 4, 8), 18, lineLength * 0.35);
  const headPoints = [-Math.PI / 7, Math.PI / 7].map((offset) => ({
    x: end.x - headLength * Math.cos(angle + offset),
    y: end.y - headLength * Math.sin(angle + offset),
  }));
  return (
    <svg className="shapeOverlay" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={width} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {arrow && (
        <polyline points={`${headPoints[0].x},${headPoints[0].y} ${end.x},${end.y} ${headPoints[1].x},${headPoints[1].y}`} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      )}
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
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const [shouldRender, setShouldRender] = useState(active);

  useEffect(() => {
    if (active) setShouldRender(true);
  }, [active]);

  useEffect(() => {
    if (shouldRender) return;
    const node = rootRef.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setShouldRender(true);
      return;
    }
    const root = node.closest(".rail");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "800px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
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
      const task = pdfPage.render({ canvasContext: context, viewport, background: "#ffffff" });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) {
          console.warn("Thumbnail render failed", error);
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, page, pageSize.width, shouldRender]);
  return (
    <button ref={rootRef} className={active ? "thumbnail active" : "thumbnail"} onClick={onClick}>
      <canvas ref={canvasRef} />
      <span>{page}</span>
    </button>
  );
}

function SelectedInspector({ annotation, update, remove }: { annotation: Annotation; update: (patch: Partial<Annotation>) => void; remove: () => void }) {
  const fixed = isFixedFill(annotation);
  const label = (isTextAnnotation(annotation) || isChoiceAnnotation(annotation)) ? annotation.detectedField?.label : undefined;
  return (
    <div className="selectedTools">
      <span className="pill">{label || annotation.type}</span>
      {!fixed && annotation.type !== "draw" && annotation.type !== "watermark" && (
        <>
          <label>Rotation</label>
          <SignedNumberInput value={annotation.rotation ?? 0} min={-180} max={180} onCommit={(rotation) => update({ rotation })} />
        </>
      )}
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
              <SignedNumberInput value={annotation.rotation ?? -35} min={-180} max={180} onCommit={(rotation) => update({ rotation })} />
              <label className="checkRow">
                <input
                  type="checkbox"
                  checked={annotation.repeat ?? false}
                  onChange={(event) => update(event.target.checked ? { repeat: true, x: 0, y: 0, w: 1, h: 1 } : { repeat: false, x: 0.18, y: 0.42, w: 0.64, h: 0.14 })}
                />
                Repeat across page
              </label>
              {annotation.repeat && (
                <>
                  <label>Horizontal spacing</label>
                  <input type="range" min="20" max="360" value={annotation.repeatSpacingX ?? 140} onChange={(event) => update({ repeatSpacingX: Number(event.target.value) })} />
                  <label>Vertical spacing</label>
                  <input type="range" min="30" max="300" value={annotation.repeatSpacingY ?? 130} onChange={(event) => update({ repeatSpacingY: Number(event.target.value) })} />
                </>
              )}
            </>
          )}
        </>
      )}
      {annotation.type === "field" && (
        <>
          <label>Field name</label>
          <input value={annotation.name} readOnly={!!annotation.sourceFieldName} onChange={(event) => update({ name: event.target.value })} />
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
          {annotation.type !== "radio" && !annotation.sourceFieldName && (
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
      <button className="wideButton danger" onClick={remove}><Trash2 size={18} /> {fixed ? "Clear field" : "Delete Item"}</button>
    </div>
  );
}

function SignedNumberInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(clamp(parsed, min, max));
    else setDraft(String(value));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(event) => {
        if (/^-?\d*$/.test(event.target.value)) setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
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

function OcrReviewModal({
  busy,
  progress,
  result,
  error,
  onClose,
  onUseText,
}: {
  busy: boolean;
  progress: number;
  result: OcrResult | null;
  error: string;
  onClose: () => void;
  onUseText: (text: string) => void;
}) {
  const [editableText, setEditableText] = useState(result?.text ?? "");

  useEffect(() => {
    setEditableText(result?.text ?? "");
  }, [result]);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <section className="ocrModal">
        <header>
          <div>
            <h2>Check text</h2>
            <p className="muted">OCR is a best guess, especially for handwriting. Review it before using it.</p>
          </div>
          <button onClick={onClose}>{busy ? "Cancel" : "Close"}</button>
        </header>

        {busy && (
          <>
            <div className="updateProgress" aria-label="OCR progress">
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="muted">Reading the scanned page... {progress}%</p>
          </>
        )}

        {error && <p className="errorText">{error}</p>}

        {result && (
          <>
            <div className="ocrConfidence">
              <span>Page {result.page}</span>
              <strong>{result.confidence}% confidence</strong>
            </div>
            <textarea
              value={editableText}
              onChange={(event) => setEditableText(event.target.value)}
              placeholder="No text was detected."
            />
            <div className="modalActions">
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(editableText);
                }}
              >
                Copy
              </button>
              <button className="primaryAction" disabled={!editableText.trim()} onClick={() => onUseText(editableText)}>
                Use as text box
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MergeModal({ currentFile, onClose, onMerge }: { currentFile: File | null; onClose: () => void; onMerge: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>(() => currentFile ? [currentFile] : []);
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
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            setFiles((current) => {
              const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
              return [...current, ...selected.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))];
            });
            event.currentTarget.value = "";
          }}
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

function ToolPdfThumbnail({
  doc,
  page,
  selected,
  onClick,
  label,
  children,
  className = "",
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  doc: any;
  page: number;
  selected?: boolean;
  onClick?: () => void;
  label?: string;
  children?: React.ReactNode;
  className?: string;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
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

  const classes = ["toolPageThumb", selected ? "selected" : "", className].filter(Boolean).join(" ");

  return (
    <button
      className={classes}
      draggable={draggable}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      type="button"
    >
      <canvas ref={canvasRef} />
      <span>{label ?? `Page ${page}`}</span>
      {children}
    </button>
  );
}

function OrganizePagesModal({
  doc,
  fileName,
  pageCount,
  onClose,
  onApply,
}: {
  doc: any;
  fileName: string;
  pageCount: number;
  onClose: () => void;
  onApply: (order: number[]) => void;
}) {
  const [order, setOrder] = useState(() => Array.from({ length: pageCount }, (_, index) => index + 1));
  const [selectedPage, setSelectedPage] = useState(1);
  const draggedPageRef = useRef<number | null>(null);
  const changed = order.some((page, index) => page !== index + 1);
  const selectedIndex = order.indexOf(selectedPage);

  useEffect(() => {
    setOrder(Array.from({ length: pageCount }, (_, index) => index + 1));
    setSelectedPage(1);
  }, [pageCount]);

  const movePageToIndex = (page: number, nextIndex: number) => {
    setOrder((current) => {
      const fromIndex = current.indexOf(page);
      if (fromIndex < 0) return current;
      const boundedIndex = clamp(nextIndex, 0, current.length - 1);
      if (fromIndex === boundedIndex) return current;
      const next = [...current];
      const [item] = next.splice(fromIndex, 1);
      next.splice(boundedIndex, 0, item);
      return next;
    });
    setSelectedPage(page);
  };

  const moveSelected = (direction: -1 | 1) => {
    if (selectedIndex < 0) return;
    movePageToIndex(selectedPage, selectedIndex + direction);
  };

  const moveDroppedPage = (targetPage: number) => {
    const draggedPage = draggedPageRef.current;
    draggedPageRef.current = null;
    if (!draggedPage || draggedPage === targetPage) return;
    setOrder((current) => {
      const targetIndex = current.indexOf(targetPage);
      if (targetIndex < 0) return current;
      const next = current.filter((page) => page !== draggedPage);
      const insertIndex = next.indexOf(targetPage);
      next.splice(insertIndex, 0, draggedPage);
      return next;
    });
    setSelectedPage(draggedPage);
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="toolWorkflowModal">
        <header>
          <div>
            <h2>Organize Pages</h2>
            <p className="muted">Move pages into the order you need before saving or exporting.</p>
          </div>
          <div className="modalActions">
            <button onClick={onClose}>Cancel</button>
            <button className="primaryAction" disabled={!changed} onClick={() => onApply(order)}>
              Apply order
            </button>
          </div>
        </header>

        <div className="toolWorkflowGrid">
          <section className="toolPreviewArea">
            <div className="workflowTitleRow">
              <strong>{fileName}</strong>
              <button className="wideButton" disabled={!changed} onClick={() => setOrder(Array.from({ length: pageCount }, (_, index) => index + 1))}>
                Reset order
              </button>
            </div>
            <div className="organizePageGrid">
              {order.map((page, index) => (
                <ToolPdfThumbnail
                  key={page}
                  doc={doc}
                  page={page}
                  selected={selectedPage === page}
                  label={`Page ${page}`}
                  className="organizeThumb"
                  draggable
                  onClick={() => setSelectedPage(page)}
                  onDragStart={(event) => {
                    draggedPageRef.current = page;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(page));
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveDroppedPage(page);
                  }}
                  onDragEnd={() => {
                    draggedPageRef.current = null;
                  }}
                >
                  <small>Position {index + 1}</small>
                </ToolPdfThumbnail>
              ))}
            </div>
          </section>

          <aside className="toolSidePanel">
            <h3>Move pages</h3>
            <div className="infoPanel compact">Select a page, use the move buttons, or drag a thumbnail before another page.</div>
            <p className="toolMeta">Selected page: {selectedPage}</p>
            <button className="wideButton" disabled={selectedIndex <= 0} onClick={() => movePageToIndex(selectedPage, 0)}>
              <ChevronsUp size={18} />
              Move to top
            </button>
            <button className="wideButton" disabled={selectedIndex <= 0} onClick={() => moveSelected(-1)}>
              <ArrowUp size={18} />
              Move up
            </button>
            <button className="wideButton" disabled={selectedIndex < 0 || selectedIndex >= order.length - 1} onClick={() => moveSelected(1)}>
              <ArrowDown size={18} />
              Move down
            </button>
            <button className="wideButton" disabled={selectedIndex < 0 || selectedIndex >= order.length - 1} onClick={() => movePageToIndex(selectedPage, order.length - 1)}>
              <ChevronsDown size={18} />
              Move to bottom
            </button>
            <p className="toolMeta">New order: {order.join(", ")}</p>
          </aside>
        </div>
      </div>
    </div>
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
  const [error, setError] = useState("");

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
    setError("");
  };

  const clear = () => {
    const context = canvasRef.current?.getContext("2d");
    if (canvasRef.current && context) context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setError("");
  };

  const signatureDataUrl = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return "";
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return "";
    const padding = 18;
    const left = Math.max(0, minX - padding);
    const top = Math.max(0, minY - padding);
    const width = Math.min(canvas.width - left, maxX - minX + padding * 2);
    const height = Math.min(canvas.height - top, maxY - minY + padding * 2);
    const trimmed = document.createElement("canvas");
    trimmed.width = Math.max(1, width);
    trimmed.height = Math.max(1, height);
    const trimmedContext = trimmed.getContext("2d");
    if (!trimmedContext) return "";
    trimmedContext.drawImage(canvas, left, top, width, height, 0, 0, width, height);
    return trimmed.toDataURL("image/png");
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
            setError("");
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
        {error && <p className="errorText">{error}</p>}
        <footer>
          <button onClick={clear}>Clear</button>
          <button
            className="primaryAction"
            onClick={() => {
              const dataUrl = signatureDataUrl();
              if (!dataUrl) {
                setError(`Type or draw ${kind === "signature" ? "a signature" : "initials"} before saving.`);
                return;
              }
              onSave({ id: uid(kind), kind, label: label.trim() || (kind === "signature" ? "Signature" : "Initials"), dataUrl });
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
