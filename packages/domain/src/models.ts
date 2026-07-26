import type { PageObjectCapabilities } from "./capabilities";
import type { DomainId, IsoTimestamp, JsonObject, Position } from "./types";

export const PAGE_OBJECT_TYPES = [
  "pen-stroke",
  "highlighter-stroke",
  "rich-text",
  "heading",
  "image",
  "table",
  "sticky-note",
  "rectangle",
  "circle",
  "line",
  "arrow",
] as const;

export type PageObjectType = (typeof PAGE_OBJECT_TYPES)[number];

type PageObjectIdentity<TType extends PageObjectType> = Readonly<{
  id: DomainId;
  type: TType;
}>;

type PageObjectTransform = Readonly<{
  position: Position;
  rotation: number;
}>;

type PageObjectState = Readonly<{
  locked: boolean;
  visible: boolean;
  capabilities: PageObjectCapabilities;
}>;

export type PageObject<TType extends PageObjectType = PageObjectType> = PageObjectIdentity<TType> &
  PageObjectTransform &
  PageObjectState;

export interface PlainPageBackground {
  readonly type: "plain";
  readonly color: string;
}

export interface PatternedPageBackground {
  readonly type: "grid" | "ruled";
  readonly color: string;
  readonly lineColor: string;
  readonly spacing: number;
}

export type PageBackground = PlainPageBackground | PatternedPageBackground;

export interface Page {
  readonly id: DomainId;
  readonly width: number;
  readonly height: number;
  readonly background: PageBackground;
  readonly objects: readonly PageObject[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface Section {
  readonly id: DomainId;
  readonly title: string;
  readonly pages: readonly Page[];
  readonly color: string | null;
  readonly icon: string | null;
}

export const ASSET_KINDS = ["image", "attachment", "audio", "video"] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export interface Asset {
  readonly id: DomainId;
  readonly kind: AssetKind;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly createdAt: IsoTimestamp;
}

export interface ColorNotebookCover {
  readonly kind: "color";
  readonly value: string;
}

export interface AssetNotebookCover {
  readonly kind: "asset";
  readonly assetId: DomainId;
}

export type NotebookCover = AssetNotebookCover | ColorNotebookCover | null;

export type NotebookSettings = JsonObject;

export interface Notebook {
  readonly id: DomainId;
  readonly name: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly cover: NotebookCover;
  readonly theme: string;
  readonly sections: readonly Section[];
  readonly assets: readonly Asset[];
  readonly settings: NotebookSettings;
}
