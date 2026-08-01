import type { DomainId, IsoTimestamp, JsonObject, Position } from "@folio/domain";
import type { Stroke, StrokeMetrics, StrokeStatistics, StrokeStyle } from "@folio/ink";
import type { EditableStyle, EditableStyleInput } from "./editable-style";
import type { Transform } from "./transform";

export type VectorObjectType = "line" | "rectangle" | "ellipse";
export type PageObjectType = "ink" | VectorObjectType;
export type ObjectVersion = 1;
export type ObjectMetadata = JsonObject;
export type RenderingHints = JsonObject;

export interface ObjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageObject<TType extends PageObjectType = PageObjectType> {
  readonly id: DomainId;
  readonly type: TType;
  readonly createdAt: IsoTimestamp;
  readonly modifiedAt: IsoTimestamp;
  readonly bounds: ObjectBounds;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: ObjectMetadata;
  readonly zIndex: number;
  readonly transform: Transform;
  readonly version: ObjectVersion;
}

export interface InkObjectData {
  readonly id: DomainId;
  readonly createdAt: IsoTimestamp;
  readonly modifiedAt: IsoTimestamp;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: ObjectMetadata;
  readonly zIndex: number;
  readonly transform: Transform;
  readonly stroke: Stroke;
  readonly renderingHints: RenderingHints;
}

export interface CreateInkObjectInput {
  readonly stroke: Stroke;
  readonly id?: DomainId;
  readonly createdAt?: IsoTimestamp;
  readonly modifiedAt?: IsoTimestamp;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly metadata?: ObjectMetadata;
  readonly zIndex?: number;
  readonly transform?: Transform;
  readonly renderingHints?: RenderingHints;
}

export interface LineGeometry {
  readonly start: Position;
  readonly end: Position;
}

export interface RectangleGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EllipseGeometry {
  readonly center: Position;
  readonly radiusX: number;
  readonly radiusY: number;
}

export type VectorGeometry = LineGeometry | RectangleGeometry | EllipseGeometry;

export interface VectorObjectData<
  TType extends VectorObjectType,
  TGeometry extends VectorGeometry,
> {
  readonly id: DomainId;
  readonly type: TType;
  readonly createdAt: IsoTimestamp;
  readonly modifiedAt: IsoTimestamp;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: ObjectMetadata;
  readonly zIndex: number;
  readonly transform: Transform;
  readonly geometry: TGeometry;
  readonly style: EditableStyle | EditableStyleInput;
}

interface CreateVectorObjectInput<TGeometry extends VectorGeometry> {
  readonly geometry: TGeometry;
  readonly style?: EditableStyle | EditableStyleInput;
  readonly id?: DomainId;
  readonly createdAt?: IsoTimestamp;
  readonly modifiedAt?: IsoTimestamp;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly metadata?: ObjectMetadata;
  readonly zIndex?: number;
  readonly transform?: Transform;
}

export type CreateLineObjectInput = CreateVectorObjectInput<LineGeometry>;
export type CreateRectangleObjectInput = CreateVectorObjectInput<RectangleGeometry>;
export type CreateEllipseObjectInput = CreateVectorObjectInput<EllipseGeometry>;

export interface CloneObjectOptions {
  readonly id?: DomainId;
  readonly metadata?: ObjectMetadata;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly zIndex?: number;
  readonly transform?: Transform;
  readonly renderingHints?: RenderingHints;
  readonly style?: EditableStyle | EditableStyleInput;
}

export interface ObjectFactoryOptions {
  readonly createId?: () => DomainId;
  readonly now?: () => IsoTimestamp;
}

export interface ObjectValidationIssue {
  readonly path: string;
  readonly code:
    | "duplicate_id"
    | "invalid_bounds"
    | "invalid_geometry"
    | "invalid_metadata"
    | "invalid_stroke"
    | "invalid_style"
    | "invalid_timestamp"
    | "invalid_transform"
    | "invalid_type"
    | "invalid_value"
    | "invalid_version"
    | "unknown_type";
  readonly message: string;
}

export interface ObjectValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ObjectValidationIssue[];
}

export interface ObjectCollectionStatistics {
  readonly objectCount: number;
  readonly inkObjectCount: number;
  readonly vectorObjectCount: number;
  readonly visibleObjectCount: number;
  readonly lockedObjectCount: number;
  readonly highestZIndex: number | null;
  readonly bounds: ObjectBounds | null;
}

export interface SerializedPageObject<TPayload extends JsonObject = JsonObject> {
  readonly id: DomainId;
  readonly type: PageObjectType;
  readonly createdAt: IsoTimestamp;
  readonly modifiedAt: IsoTimestamp;
  readonly bounds: ObjectBounds;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: ObjectMetadata;
  readonly zIndex: number;
  readonly transform: Readonly<{
    translation: Position;
    rotation: number;
    scale: number;
  }>;
  readonly version: ObjectVersion;
  readonly payload: TPayload;
}

export interface ObjectSerializationContract<
  TObject extends PageObject = PageObject,
  TSerialized extends SerializedPageObject = SerializedPageObject,
> {
  serialize(object: TObject): TSerialized;
  deserialize(serialized: TSerialized): TObject;
}

export interface InkObjectView extends PageObject<"ink"> {
  readonly stroke: Stroke;
  readonly metrics: StrokeMetrics;
  readonly statistics: StrokeStatistics;
  readonly style: StrokeStyle;
  readonly renderingHints: RenderingHints;
}

interface VectorObjectView<
  TType extends VectorObjectType,
  TGeometry extends VectorGeometry,
> extends PageObject<TType> {
  readonly geometry: TGeometry;
  readonly localBounds: ObjectBounds;
  readonly style: EditableStyle;
}

export type LineObjectView = VectorObjectView<"line", LineGeometry>;
export type RectangleObjectView = VectorObjectView<"rectangle", RectangleGeometry>;
export type EllipseObjectView = VectorObjectView<"ellipse", EllipseGeometry>;
export type VectorPageObject = LineObjectView | RectangleObjectView | EllipseObjectView;
