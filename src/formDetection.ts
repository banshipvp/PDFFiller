import { OPS, Util } from "pdfjs-dist";
import type { PDFOperatorList } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/display_utils";

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Segment = { at: number; from: number; to: number };
type Border = { at: number; spans: Segment[] };

export type FormTextRun = Bounds & {
  text: string;
  baseline: Point;
  direction: Point;
  ascent: Point;
  advance: number;
  fontSize: number;
};

export type DetectedFillZone = {
  id: string;
  page: number;
  kind: "text" | "checkbox";
  source: "box" | "line" | "symbol";
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const tolerance = 1.15;
const identity = [1, 0, 0, 1, 0, 0];
const boxSymbols = /[☐□⬜❏❑❒\uf0a3\uf0a8]/gu;
const fills = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const strokes = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const closes = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

function readBorders(operators: PDFOperatorList, viewport: PageViewport) {
  const horizontal: Segment[] = [];
  const vertical: Segment[] = [];
  const stack: number[][] = [];
  let matrix = identity;
  let paths: { points: Point[]; closed: boolean; curved: boolean }[] = [];
  let current: (typeof paths)[number] | undefined;
  let paintingAnnotation = false;

  const project = (x: number, y: number) => {
    const [px, py] = Util.applyTransform([x, y], matrix);
    const [vx, vy] = viewport.convertToViewportPoint(px, py);
    return { x: vx, y: vy };
  };
  const addSegment = (a: Point, b: Point) => {
    if (Math.abs(a.y - b.y) <= tolerance && Math.abs(a.x - b.x) >= 4) {
      horizontal.push({ at: (a.y + b.y) / 2, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) });
    }
    if (Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) >= 4) {
      vertical.push({ at: (a.x + b.x) / 2, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) });
    }
  };

  for (let i = 0; i < operators.fnArray.length; i += 1) {
    const op = operators.fnArray[i];
    const args = operators.argsArray[i];
    if (op === OPS.beginAnnotation) {
      paintingAnnotation = true;
      continue;
    }
    if (op === OPS.endAnnotation) {
      paintingAnnotation = false;
      continue;
    }
    if (paintingAnnotation) continue;
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      stack.push(matrix);
      if (op === OPS.paintFormXObjectBegin && args?.[0]) matrix = Util.transform(matrix, args[0]);
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
      matrix = stack.pop() ?? identity;
    } else if (op === OPS.transform) {
      matrix = Util.transform(matrix, args);
    } else if (op === OPS.constructPath) {
      const [commands, values] = args;
      let offset = 0;
      for (const command of commands) {
        if (command === OPS.rectangle) {
          const [x, y, w, h] = values.slice(offset, offset + 4);
          paths.push({ points: [project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)], closed: true, curved: false });
          current = undefined;
          offset += 4;
        } else if (command === OPS.moveTo || command === OPS.lineTo) {
          const point = project(values[offset], values[offset + 1]);
          offset += 2;
          if (command === OPS.moveTo || !current) {
            current = { points: [point], closed: false, curved: false };
            paths.push(current);
          } else current.points.push(point);
        } else if (command === OPS.closePath) {
          if (current) current.closed = true;
        } else {
          if (current) current.curved = true;
          offset += command === OPS.curveTo ? 6 : 4;
        }
      }
    } else if (op === OPS.endPath || fills.has(op) || strokes.has(op)) {
      for (const path of paths) {
        if (path.curved || path.points.length < 2) continue;
        const xs = path.points.map(({ x }) => x);
        const ys = path.points.map(({ y }) => y);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        const right = Math.max(...xs);
        const bottom = Math.max(...ys);
        if (fills.has(op) && right - left <= 2.5) {
          const center = (left + right) / 2;
          addSegment({ x: center, y: top }, { x: center, y: bottom });
        } else if (fills.has(op) && bottom - top <= 2.5) {
          const center = (top + bottom) / 2;
          addSegment({ x: left, y: center }, { x: right, y: center });
        } else if (strokes.has(op)) {
          for (let j = 1; j < path.points.length; j += 1) addSegment(path.points[j - 1], path.points[j]);
          if (path.closed || (closes.has(op) && path === current)) addSegment(path.points[path.points.length - 1], path.points[0]);
        }
      }
      paths = [];
      current = undefined;
    }
  }
  return { horizontal: joinBorders(horizontal), vertical: joinBorders(vertical) };
}

function joinBorders(segments: Segment[]) {
  const borders: Border[] = [];
  for (const segment of segments.sort((a, b) => a.at - b.at)) {
    const last = borders[borders.length - 1];
    if (last && segment.at - last.at <= tolerance) last.spans.push(segment);
    else borders.push({ at: segment.at, spans: [segment] });
  }
  for (const border of borders) {
    const joined: Segment[] = [];
    for (const segment of border.spans.sort((a, b) => a.from - b.from)) {
      const previous = joined[joined.length - 1];
      if (previous && segment.from <= previous.to + 1.65) previous.to = Math.max(previous.to, segment.to);
      else joined.push({ ...segment });
    }
    border.spans = joined;
  }
  return borders;
}

function spans(border: Border, from: number, to: number) {
  return border.spans.some((segment) => segment.from <= from + 1.65 && segment.to >= to - 1.65);
}

function findBoxes(horizontal: Border[], vertical: Border[], height: number) {
  const boxes: Bounds[] = [];
  // Dense drawings can contain thousands of unrelated strokes.
  if (horizontal.length > 350 || vertical.length > 350) return boxes;
  for (let i = 0; i < horizontal.length; i += 1) {
    const top = horizontal[i];
    const topColumns = vertical.filter((column) => spans(top, column.at, column.at) && spans(column, top.at, top.at + 5));
    if (topColumns.length < 2) continue;
    for (let j = i + 1; j < horizontal.length; j += 1) {
      const bottom = horizontal[j];
      if (bottom.at - top.at < 5) continue;
      if (bottom.at - top.at > height * 0.52) break;
      const columns = topColumns.filter((column) => spans(column, top.at, bottom.at) && spans(bottom, column.at, column.at));
      for (let k = 1; k < columns.length; k += 1) {
        const left = columns[k - 1].at;
        const right = columns[k].at;
        if (right - left < 5 || !spans(top, left, right) || !spans(bottom, left, right)) continue;
        if (horizontal.slice(i + 1, j).some((row) => spans(row, left, right))) continue;
        boxes.push({ left, right, top: top.at, bottom: bottom.at });
      }
    }
  }
  return boxes;
}

function contains(box: Bounds, run: Bounds) {
  const x = (run.left + run.right) / 2;
  const y = (run.top + run.bottom) / 2;
  return x > box.left + 1 && x < box.right - 1 && y > box.top + 1 && y < box.bottom - 1;
}

function sameCheckbox(a: Bounds, b: Bounds) {
  return Math.abs((a.left + a.right - b.left - b.right) / 2) < 5 &&
    Math.abs((a.top + a.bottom - b.top - b.bottom) / 2) < 5;
}

export function nearbyCheckboxLabel(box: Bounds, text: FormTextRun[], nextBox?: Bounds) {
  const center = (box.top + box.bottom) / 2;
  return text
    .filter((run) => run.left >= box.right - 2 && run.left < box.right + 65 &&
      Math.abs((run.top + run.bottom) / 2 - center) < 6 && (!nextBox || run.left < nextBox.left))
    .filter((run) => ![...run.text.matchAll(boxSymbols)].length)
    .sort((a, b) => a.left - b.left)
    .map((run) => run.text.trim()).join(" ").slice(0, 85);
}

export function detectFillZones(operators: PDFOperatorList, viewport: PageViewport, text: FormTextRun[], page: number): DetectedFillZone[] {
  const { width, height } = viewport;
  const { horizontal, vertical } = readBorders(operators, viewport);
  const boxes = findBoxes(horizontal, vertical, height);
  const results: DetectedFillZone[] = [];
  const add = (box: Bounds, kind: DetectedFillZone["kind"], source: DetectedFillZone["source"], label: string) => {
    if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) return;
    const [x1, y1] = viewport.convertToPdfPoint(box.left, box.top);
    const [x2, y2] = viewport.convertToPdfPoint(box.right, box.bottom);
    const bounds = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    results.push({
      id: `fill-${kind}-${bounds.map((value) => Math.round(value * 10)).join("-")}`, page, kind, source, label,
      x: box.left / width, y: box.top / height, w: (box.right - box.left) / width, h: (box.bottom - box.top) / height,
    });
  };

  const symbols: Array<{ box: Bounds; label: string }> = [];
  for (const run of text) {
    const matches = [...run.text.matchAll(boxSymbols)];
    for (const [index, match] of matches.entries()) {
      const before = Array.from(run.text.slice(0, match.index)).length;
      const characterWidth = run.advance / Array.from(run.text).length;
      const size = Math.max(6, Math.min(run.fontSize, matches.length === 1 && run.text.trim() === match[0] ? run.advance : run.fontSize));
      if (size > 21) continue;
      const offset = before * characterWidth + (run.text.trim() === match[0] ? run.advance / 2 : size / 2);
      const x = run.baseline.x + run.direction.x * offset + run.ascent.x * size * 0.39;
      const y = run.baseline.y + run.direction.y * offset + run.ascent.y * size * 0.39;
      const label = run.text.slice(match.index + match[0].length, matches[index + 1]?.index).trim();
      symbols.push({ box: { left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2 }, label });
    }
  }

  const contents = new Map(boxes.map((box) => [box, text.filter((run) => contains(box, run))]));
  for (const box of boxes) {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const runs = contents.get(box) ?? [];
    if (w >= 5 && w <= 22 && h <= 22 && w / h >= 0.72 && w / h <= 1.38 && !runs.length) {
      if (!symbols.some((symbol) => sameCheckbox(symbol.box, box))) symbols.push({ box, label: "" });
      continue;
    }
    if (w < 29 || h < 13) continue;
    if (runs.length) {
      // A checkbox row can also end with a short write-in field.
      const lastRun = [...runs].sort((a, b) => b.right - a.right)[0];
      if (/:\s*$/.test(lastRun.text) && symbols.some((symbol) => contains(box, symbol.box)) && box.right - lastRun.right >= 42) {
        add({ ...box, left: lastRun.right + 4 }, "text", "box", lastRun.text.trim().replace(/:$/, ""));
      }
      continue;
    }
    const neighbor = boxes.find((candidate) => Math.abs(candidate.right - box.left) < 2 &&
      candidate.top < box.bottom - 3 && candidate.bottom > box.top + 3 && contents.get(candidate)?.length);
    const label = neighbor ? contents.get(neighbor)?.map((run) => run.text.trim()).join(" ") : "";
    add(box, "text", "box", label || "Text box");
  }

  for (const { box, label } of symbols) {
    const next = symbols.filter((other) => other.box.left > box.right && Math.abs(other.box.top - box.top) < 5)
      .sort((a, b) => a.box.left - b.box.left)[0];
    add(box, "checkbox", "symbol", label || nearbyCheckboxLabel(box, text, next?.box) || "Checkbox");
  }

  for (const row of horizontal) {
    for (const segment of row.spans) {
      if (segment.to - segment.from < 36 || row.at < 30 || row.at > height - 36) continue;
      if (vertical.some((column) => column.at >= segment.from - 2 && column.at <= segment.to + 2 &&
        (spans(column, row.at - 6, row.at) || spans(column, row.at, row.at + 6)))) continue;
      const box = { left: segment.from, right: segment.to, top: row.at - 17, bottom: row.at };
      if (text.some((run) => run.right > box.left + 2 && run.left < box.right - 2 && run.bottom > box.top + 2 && run.top < box.bottom + 4)) continue;
      add(box, "text", "line", "Write on line");
    }
  }
  return results;
}
