import type { JsonObject } from "@folio/domain";
import {
  EllipseObject,
  InkObject,
  LineObject,
  RectangleObject,
  Transform,
  createEditableStyle,
  isVectorObject,
  serializeVectorObject,
  type EditableColor,
  type EditableShadow,
  type EditableStyle,
  type EditableStyleInput,
  type EllipseGeometry,
  type LineGeometry,
  type PageObject,
  type RectangleGeometry,
} from "@folio/document";
import { decodeStroke, encodeStroke, type SerializedStroke } from "./ink-codec";
import {
  assertExactKeys,
  constructOrFail,
  expectBoolean,
  expectFiniteNumber,
  expectId,
  expectIsoTimestamp,
  expectJsonObject,
  expectRecord,
  expectString,
  fail,
  type ProjectResourceBudget,
} from "./project-validation";

interface SerializedTransform {
  readonly translation: Readonly<{ x: number; y: number }>;
  readonly rotation: number;
  readonly scale: number;
}

interface SerializedInkPayload {
  readonly stroke: SerializedStroke;
  readonly renderingHints: JsonObject;
}

interface SerializedVectorPayload {
  readonly geometry: JsonObject;
  readonly style: JsonObject;
}

export interface SerializedProjectPageObject {
  readonly id: string;
  readonly type: "ink" | "line" | "rectangle" | "ellipse";
  readonly version: 1;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: JsonObject;
  readonly transform: SerializedTransform;
  readonly payload: SerializedInkPayload | SerializedVectorPayload;
}

export function encodePageObject(
  object: PageObject,
  canonicalIndex: number,
  path: string,
  budget: ProjectResourceBudget,
): SerializedProjectPageObject {
  if (object.zIndex !== canonicalIndex) {
    fail(
      "INVALID_OBJECT",
      path,
      "PageObject z-index must agree with canonical ObjectCollection order.",
      { zIndex: object.zIndex, canonicalIndex },
    );
  }
  const common = serializeCommon(object, path, budget);
  if (object.type === "ink") {
    if (!(object instanceof InkObject)) {
      fail("INVALID_OBJECT", path, "Ink PageObject must be an InkObject instance.");
    }
    return {
      ...common,
      type: "ink",
      payload: {
        stroke: encodeStroke(object.stroke, `${path}.payload.stroke`, budget),
        renderingHints: expectJsonObject(
          object.renderingHints,
          `${path}.payload.renderingHints`,
          "INVALID_OBJECT",
          budget,
        ),
      },
    };
  }
  if (!isVectorObject(object)) {
    fail("INVALID_OBJECT", path, "PageObject is not a supported vector instance.");
  }
  const serialized = serializeVectorObject(object);
  return {
    ...common,
    type: serialized.type,
    payload: {
      geometry: serialized.payload.geometry,
      style: serialized.payload.style,
    },
  };
}

export function decodePageObject(
  value: unknown,
  canonicalIndex: number,
  path: string,
  budget: ProjectResourceBudget,
): PageObject {
  const record = expectRecord(value, path, "INVALID_OBJECT", "PageObject must be an object.");
  assertExactKeys(
    record,
    [
      "id",
      "type",
      "version",
      "createdAt",
      "modifiedAt",
      "visible",
      "locked",
      "metadata",
      "transform",
      "payload",
    ],
    [],
    path,
    "INVALID_OBJECT",
  );
  const id = expectId(record.id, `${path}.id`, "INVALID_OBJECT");
  if (record.version !== 1) {
    fail("INVALID_OBJECT", `${path}.version`, "PageObject version must be 1.");
  }
  const createdAt = expectIsoTimestamp(record.createdAt, `${path}.createdAt`, "INVALID_OBJECT");
  const modifiedAt = expectIsoTimestamp(record.modifiedAt, `${path}.modifiedAt`, "INVALID_OBJECT");
  if (modifiedAt < createdAt) {
    fail("INVALID_OBJECT", `${path}.modifiedAt`, "modifiedAt cannot precede createdAt.");
  }
  const common = {
    id,
    createdAt,
    modifiedAt,
    visible: expectBoolean(record.visible, `${path}.visible`, "INVALID_OBJECT"),
    locked: expectBoolean(record.locked, `${path}.locked`, "INVALID_OBJECT"),
    metadata: expectJsonObject(record.metadata, `${path}.metadata`, "INVALID_OBJECT", budget),
    zIndex: canonicalIndex,
    transform: parseTransform(record.transform, `${path}.transform`),
  } as const;
  const payloadPath = `${path}.payload`;
  const payload = expectRecord(record.payload, payloadPath, "INVALID_OBJECT");
  switch (record.type) {
    case "ink": {
      assertExactKeys(payload, ["stroke", "renderingHints"], [], payloadPath, "INVALID_OBJECT");
      const stroke = decodeStroke(payload.stroke, `${payloadPath}.stroke`, budget);
      const renderingHints = expectJsonObject(
        payload.renderingHints,
        `${payloadPath}.renderingHints`,
        "INVALID_OBJECT",
        budget,
      );
      return constructOrFail(
        "INVALID_OBJECT",
        path,
        "InkObject failed document validation.",
        () => new InkObject({ ...common, stroke, renderingHints }),
      );
    }
    case "line": {
      const { geometry, style } = parseVectorPayload(payload, payloadPath, "line", budget);
      return constructOrFail(
        "INVALID_OBJECT",
        path,
        "LineObject failed document validation.",
        () => new LineObject({ ...common, geometry, style }),
      );
    }
    case "rectangle": {
      const { geometry, style } = parseVectorPayload(payload, payloadPath, "rectangle", budget);
      return constructOrFail(
        "INVALID_OBJECT",
        path,
        "RectangleObject failed document validation.",
        () => new RectangleObject({ ...common, geometry, style }),
      );
    }
    case "ellipse": {
      const { geometry, style } = parseVectorPayload(payload, payloadPath, "ellipse", budget);
      return constructOrFail(
        "INVALID_OBJECT",
        path,
        "EllipseObject failed document validation.",
        () => new EllipseObject({ ...common, geometry, style }),
      );
    }
    default:
      fail("INVALID_OBJECT", `${path}.type`, `Unknown PageObject type '${String(record.type)}'.`);
  }
}

function serializeCommon(
  object: PageObject,
  path: string,
  budget: ProjectResourceBudget,
): Omit<SerializedProjectPageObject, "type" | "payload"> {
  if (
    !(object instanceof InkObject) &&
    !(object instanceof LineObject) &&
    !(object instanceof RectangleObject) &&
    !(object instanceof EllipseObject)
  ) {
    fail("INVALID_OBJECT", path, "PageObject instance type is not supported.");
  }
  if (object.version !== 1) {
    fail("INVALID_OBJECT", `${path}.version`, "PageObject version must be 1.");
  }
  const createdAt = expectIsoTimestamp(object.createdAt, `${path}.createdAt`, "INVALID_OBJECT");
  const modifiedAt = expectIsoTimestamp(object.modifiedAt, `${path}.modifiedAt`, "INVALID_OBJECT");
  if (modifiedAt < createdAt) {
    fail("INVALID_OBJECT", `${path}.modifiedAt`, "modifiedAt cannot precede createdAt.");
  }
  if (!(object.transform instanceof Transform)) {
    fail(
      "INVALID_OBJECT",
      `${path}.transform`,
      "PageObject transform must be a Transform instance.",
    );
  }
  const bounds = object.bounds;
  for (const [field, value] of Object.entries(bounds)) {
    const finite = expectFiniteNumber(value, `${path}.bounds.${field}`, "INVALID_OBJECT");
    if ((field === "width" || field === "height") && finite < 0) {
      fail("INVALID_OBJECT", `${path}.bounds.${field}`, "Object bounds cannot be negative.");
    }
  }
  return {
    id: expectId(object.id, `${path}.id`, "INVALID_OBJECT"),
    version: 1,
    createdAt,
    modifiedAt,
    visible: expectBoolean(object.visible, `${path}.visible`, "INVALID_OBJECT"),
    locked: expectBoolean(object.locked, `${path}.locked`, "INVALID_OBJECT"),
    metadata: expectJsonObject(object.metadata, `${path}.metadata`, "INVALID_OBJECT", budget),
    transform: serializeTransform(object.transform),
  };
}

function serializeTransform(transform: Transform): SerializedTransform {
  return {
    translation: { x: transform.translation.x, y: transform.translation.y },
    rotation: transform.rotation,
    scale: transform.scale,
  };
}

function parseTransform(value: unknown, path: string): Transform {
  const record = expectRecord(value, path, "INVALID_OBJECT", "Transform must be an object.");
  assertExactKeys(record, ["translation", "rotation", "scale"], [], path, "INVALID_OBJECT");
  const translationRecord = expectRecord(
    record.translation,
    `${path}.translation`,
    "INVALID_OBJECT",
  );
  assertExactKeys(translationRecord, ["x", "y"], [], `${path}.translation`, "INVALID_OBJECT");
  const scale = expectFiniteNumber(record.scale, `${path}.scale`, "INVALID_OBJECT");
  if (scale <= 0) fail("INVALID_OBJECT", `${path}.scale`, "Transform scale must be positive.");
  return constructOrFail(
    "INVALID_OBJECT",
    path,
    "Transform failed document validation.",
    () =>
      new Transform({
        translation: {
          x: expectFiniteNumber(translationRecord.x, `${path}.translation.x`, "INVALID_OBJECT"),
          y: expectFiniteNumber(translationRecord.y, `${path}.translation.y`, "INVALID_OBJECT"),
        },
        rotation: expectFiniteNumber(record.rotation, `${path}.rotation`, "INVALID_OBJECT"),
        scale,
      }),
  );
}

function parseVectorPayload(
  payload: Record<string, unknown>,
  path: string,
  type: "line",
  budget: ProjectResourceBudget,
): Readonly<{ geometry: LineGeometry; style: EditableStyle }>;
function parseVectorPayload(
  payload: Record<string, unknown>,
  path: string,
  type: "rectangle",
  budget: ProjectResourceBudget,
): Readonly<{ geometry: RectangleGeometry; style: EditableStyle }>;
function parseVectorPayload(
  payload: Record<string, unknown>,
  path: string,
  type: "ellipse",
  budget: ProjectResourceBudget,
): Readonly<{ geometry: EllipseGeometry; style: EditableStyle }>;
function parseVectorPayload(
  payload: Record<string, unknown>,
  path: string,
  type: "line" | "rectangle" | "ellipse",
  budget: ProjectResourceBudget,
): Readonly<{
  geometry: LineGeometry | RectangleGeometry | EllipseGeometry;
  style: EditableStyle;
}> {
  assertExactKeys(payload, ["geometry", "style"], [], path, "INVALID_OBJECT");
  return {
    geometry: parseVectorGeometry(payload.geometry, `${path}.geometry`, type),
    style: parseEditableStyle(payload.style, `${path}.style`, budget),
  };
}

function parseVectorGeometry(
  value: unknown,
  path: string,
  type: "line" | "rectangle" | "ellipse",
): LineGeometry | RectangleGeometry | EllipseGeometry {
  const record = expectRecord(value, path, "INVALID_OBJECT", "Vector geometry must be an object.");
  if (type === "line") {
    assertExactKeys(record, ["start", "end"], [], path, "INVALID_OBJECT");
    const start = parsePosition(record.start, `${path}.start`);
    const end = parsePosition(record.end, `${path}.end`);
    if (start.x === end.x && start.y === end.y) {
      fail("INVALID_OBJECT", path, "Line endpoints must not be identical.");
    }
    return { start, end };
  }
  if (type === "rectangle") {
    assertExactKeys(record, ["x", "y", "width", "height"], [], path, "INVALID_OBJECT");
    const width = expectFiniteNumber(record.width, `${path}.width`, "INVALID_OBJECT");
    const height = expectFiniteNumber(record.height, `${path}.height`, "INVALID_OBJECT");
    if (width <= 0 || height <= 0) {
      fail("INVALID_OBJECT", path, "Rectangle dimensions must be positive.");
    }
    return {
      x: expectFiniteNumber(record.x, `${path}.x`, "INVALID_OBJECT"),
      y: expectFiniteNumber(record.y, `${path}.y`, "INVALID_OBJECT"),
      width,
      height,
    };
  }
  assertExactKeys(record, ["center", "radiusX", "radiusY"], [], path, "INVALID_OBJECT");
  const radiusX = expectFiniteNumber(record.radiusX, `${path}.radiusX`, "INVALID_OBJECT");
  const radiusY = expectFiniteNumber(record.radiusY, `${path}.radiusY`, "INVALID_OBJECT");
  if (radiusX <= 0 || radiusY <= 0) {
    fail("INVALID_OBJECT", path, "Ellipse radii must be positive.");
  }
  return { center: parsePosition(record.center, `${path}.center`), radiusX, radiusY };
}

function parseEditableStyle(
  value: unknown,
  path: string,
  budget: ProjectResourceBudget,
): EditableStyle {
  const record = expectRecord(value, path, "INVALID_OBJECT", "Vector style must be an object.");
  assertExactKeys(
    record,
    ["strokeColor", "strokeWidth"],
    ["fillColor", "fontFamily", "fontSize", "lineStyle", "shadow", "blendMode"],
    path,
    "INVALID_OBJECT",
  );
  const strokeWidth = expectFiniteNumber(
    record.strokeWidth,
    `${path}.strokeWidth`,
    "INVALID_OBJECT",
  );
  if (strokeWidth <= 0) {
    fail("INVALID_OBJECT", `${path}.strokeWidth`, "Vector stroke width must be positive.");
  }
  const input: EditableStyleInput = {
    strokeColor: parseEditableColor(record.strokeColor, `${path}.strokeColor`),
    strokeWidth,
    ...(Object.prototype.hasOwnProperty.call(record, "fillColor")
      ? { fillColor: parseEditableColor(record.fillColor, `${path}.fillColor`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "fontFamily")
      ? { fontFamily: parseNormalizedName(record.fontFamily, `${path}.fontFamily`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "fontSize")
      ? { fontSize: parsePositive(record.fontSize, `${path}.fontSize`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "lineStyle")
      ? { lineStyle: parseLineStyle(record.lineStyle, `${path}.lineStyle`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "shadow")
      ? { shadow: parseShadow(record.shadow, `${path}.shadow`) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "blendMode")
      ? { blendMode: parseBlendMode(record.blendMode, `${path}.blendMode`) }
      : {}),
  };
  expectJsonObject(record, path, "INVALID_OBJECT", budget);
  return constructOrFail("INVALID_OBJECT", path, "Vector style failed document validation.", () =>
    createEditableStyle(input),
  );
}

function parseEditableColor(value: unknown, path: string): EditableColor {
  const record = expectRecord(value, path, "INVALID_OBJECT", "Color must be an object.");
  assertExactKeys(record, ["hex", "rgb", "opacity"], [], path, "INVALID_OBJECT");
  const hex = expectString(record.hex, `${path}.hex`, "INVALID_OBJECT");
  if (!/^#[0-9a-f]{6}$/u.test(hex)) {
    fail("INVALID_OBJECT", `${path}.hex`, "Color must use canonical lowercase six-digit RGB hex.");
  }
  const rgbRecord = expectRecord(record.rgb, `${path}.rgb`, "INVALID_OBJECT");
  assertExactKeys(rgbRecord, ["red", "green", "blue"], [], `${path}.rgb`, "INVALID_OBJECT");
  const red = parseColorChannel(rgbRecord.red, `${path}.rgb.red`);
  const green = parseColorChannel(rgbRecord.green, `${path}.rgb.green`);
  const blue = parseColorChannel(rgbRecord.blue, `${path}.rgb.blue`);
  const derived = `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
  if (hex !== derived) fail("INVALID_OBJECT", path, "Color hex and RGB channels disagree.");
  const opacity = expectFiniteNumber(record.opacity, `${path}.opacity`, "INVALID_OBJECT");
  if (opacity < 0 || opacity > 1) {
    fail("INVALID_OBJECT", `${path}.opacity`, "Color opacity must be between zero and one.");
  }
  return { hex, rgb: { red, green, blue }, opacity };
}

function parseColorChannel(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) {
    fail("INVALID_OBJECT", path, "RGB channels must be integers from zero to 255.");
  }
  return value as number;
}

function parseShadow(value: unknown, path: string): EditableShadow {
  const record = expectRecord(value, path, "INVALID_OBJECT", "Shadow must be an object.");
  assertExactKeys(record, ["color", "offsetX", "offsetY", "blur"], [], path, "INVALID_OBJECT");
  const blur = expectFiniteNumber(record.blur, `${path}.blur`, "INVALID_OBJECT");
  if (blur < 0) fail("INVALID_OBJECT", `${path}.blur`, "Shadow blur cannot be negative.");
  return {
    color: parseEditableColor(record.color, `${path}.color`),
    offsetX: expectFiniteNumber(record.offsetX, `${path}.offsetX`, "INVALID_OBJECT"),
    offsetY: expectFiniteNumber(record.offsetY, `${path}.offsetY`, "INVALID_OBJECT"),
    blur,
  };
}

function parseNormalizedName(value: unknown, path: string): string {
  const name = expectString(value, path, "INVALID_OBJECT", { nonBlank: true });
  if (name.trim() !== name) fail("INVALID_OBJECT", path, "Name must not have outer whitespace.");
  return name;
}

function parsePositive(value: unknown, path: string): number {
  const number = expectFiniteNumber(value, path, "INVALID_OBJECT");
  if (number <= 0) fail("INVALID_OBJECT", path, "Expected a positive number.");
  return number;
}

function parseLineStyle(value: unknown, path: string): "solid" | "dashed" | "dotted" {
  if (value !== "solid" && value !== "dashed" && value !== "dotted") {
    fail("INVALID_OBJECT", path, "Vector line style is not supported.");
  }
  return value;
}

function parseBlendMode(value: unknown, path: string): "normal" | "multiply" {
  if (value !== "normal" && value !== "multiply") {
    fail("INVALID_OBJECT", path, "Vector blend mode is not supported.");
  }
  return value;
}

function parsePosition(value: unknown, path: string): Readonly<{ x: number; y: number }> {
  const record = expectRecord(value, path, "INVALID_OBJECT", "Position must be an object.");
  assertExactKeys(record, ["x", "y"], [], path, "INVALID_OBJECT");
  return {
    x: expectFiniteNumber(record.x, `${path}.x`, "INVALID_OBJECT"),
    y: expectFiniteNumber(record.y, `${path}.y`, "INVALID_OBJECT"),
  };
}
