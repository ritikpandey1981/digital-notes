import { REQUIRED_PAGE_OBJECT_CAPABILITIES } from "./capabilities";
import type { PageObjectCapabilities } from "./capabilities";
import { resolveFactoryContext } from "./factory-context";
import type { DomainFactoryContextOverrides } from "./factory-context";
import { cloneAndFreeze } from "./internal";
import type {
  Asset,
  AssetKind,
  Notebook,
  NotebookCover,
  NotebookSettings,
  Page,
  PageBackground,
  PageObject,
  PageObjectType,
  Section,
} from "./models";
import type { DomainId, IsoTimestamp, Position } from "./types";
import {
  assertValidAsset,
  assertValidNotebook,
  assertValidPage,
  assertValidPageObject,
  assertValidSection,
} from "./validation";

export interface CreatePageObjectInput<TType extends PageObjectType = PageObjectType> {
  readonly id?: DomainId;
  readonly type: TType;
  readonly position?: Position;
  readonly rotation?: number;
  readonly locked?: boolean;
  readonly visible?: boolean;
  readonly capabilities?: PageObjectCapabilities;
}

export function createPageObject<TType extends PageObjectType>(
  input: CreatePageObjectInput<TType>,
  contextOverrides: DomainFactoryContextOverrides = {},
): PageObject<TType> {
  const context = resolveFactoryContext(contextOverrides);
  const object: PageObject<TType> = {
    id: input.id ?? context.createId(),
    type: input.type,
    position: input.position ?? { x: 0, y: 0 },
    rotation: input.rotation ?? 0,
    locked: input.locked ?? false,
    visible: input.visible ?? true,
    capabilities: {
      ...REQUIRED_PAGE_OBJECT_CAPABILITIES,
      ...input.capabilities,
    },
  };
  assertValidPageObject(object);
  return cloneAndFreeze(object);
}

export interface CreatePageInput {
  readonly id?: DomainId;
  readonly width: number;
  readonly height: number;
  readonly background?: PageBackground;
  readonly objects?: readonly PageObject[];
  readonly createdAt?: IsoTimestamp;
  readonly updatedAt?: IsoTimestamp;
}

export function createPage(
  input: CreatePageInput,
  contextOverrides: DomainFactoryContextOverrides = {},
): Page {
  const context = resolveFactoryContext(contextOverrides);
  const createdAt = input.createdAt ?? context.now();
  const page: Page = {
    id: input.id ?? context.createId(),
    width: input.width,
    height: input.height,
    background: input.background ?? { type: "plain", color: "#ffffff" },
    objects: input.objects ?? [],
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
  assertValidPage(page);
  return cloneAndFreeze(page);
}

export interface DuplicatePageInput {
  readonly id?: DomainId;
}

export function duplicatePage(
  source: Page,
  input: DuplicatePageInput = {},
  contextOverrides: DomainFactoryContextOverrides = {},
): Page {
  assertValidPage(source);
  const context = resolveFactoryContext(contextOverrides);
  const timestamp = context.now();
  const objects = source.objects.map((object) =>
    createPageObject(
      {
        id: context.createId(),
        type: object.type,
        position: object.position,
        rotation: object.rotation,
        locked: object.locked,
        visible: object.visible,
        capabilities: object.capabilities,
      },
      context,
    ),
  );
  return createPage(
    {
      id: input.id ?? context.createId(),
      width: source.width,
      height: source.height,
      background: source.background,
      objects,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    context,
  );
}

export interface CreateSectionInput {
  readonly id?: DomainId;
  readonly title: string;
  readonly pages?: readonly Page[];
  readonly color?: string | null;
  readonly icon?: string | null;
}

export function createSection(
  input: CreateSectionInput,
  contextOverrides: DomainFactoryContextOverrides = {},
): Section {
  const context = resolveFactoryContext(contextOverrides);
  const section: Section = {
    id: input.id ?? context.createId(),
    title: input.title,
    pages: input.pages ?? [],
    color: input.color ?? null,
    icon: input.icon ?? null,
  };
  assertValidSection(section);
  return cloneAndFreeze(section);
}

export interface CreateAssetInput {
  readonly id?: DomainId;
  readonly kind: AssetKind;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly createdAt?: IsoTimestamp;
}

export function createAsset(
  input: CreateAssetInput,
  contextOverrides: DomainFactoryContextOverrides = {},
): Asset {
  const context = resolveFactoryContext(contextOverrides);
  const asset: Asset = {
    id: input.id ?? context.createId(),
    kind: input.kind,
    fileName: input.fileName,
    mediaType: input.mediaType,
    byteLength: input.byteLength,
    createdAt: input.createdAt ?? context.now(),
  };
  assertValidAsset(asset);
  return cloneAndFreeze(asset);
}

export interface CreateNotebookInput {
  readonly id?: DomainId;
  readonly name: string;
  readonly createdAt?: IsoTimestamp;
  readonly updatedAt?: IsoTimestamp;
  readonly cover?: NotebookCover;
  readonly theme?: string;
  readonly sections?: readonly Section[];
  readonly assets?: readonly Asset[];
  readonly settings?: NotebookSettings;
}

export function createNotebook(
  input: CreateNotebookInput,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  const context = resolveFactoryContext(contextOverrides);
  const createdAt = input.createdAt ?? context.now();
  const notebook: Notebook = {
    id: input.id ?? context.createId(),
    name: input.name,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
    cover: input.cover ?? null,
    theme: input.theme ?? "default",
    sections: input.sections ?? [],
    assets: input.assets ?? [],
    settings: input.settings ?? {},
  };
  assertValidNotebook(notebook);
  return cloneAndFreeze(notebook);
}
