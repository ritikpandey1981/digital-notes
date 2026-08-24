import type { EditablePropertyDescriptor, ResolvedDrawingBrush } from "@folio/editor";
import type { EditorTool } from "./editor-types";
import {
  displayOpacityForTool,
  MIN_DRAWING_OPACITY,
  modelOpacityForTool,
} from "./drawing-style-policy";

export type ToolOptionControl = "color" | "continuous-number";

export interface ToolOptionPropertyDescriptor extends EditablePropertyDescriptor<string | number> {
  readonly key: "strokeColor" | "strokeWidth" | "opacity" | "smoothing";
  readonly control: ToolOptionControl;
  readonly defaultValue: string | number;
  readonly largeStep?: number;
  readonly displayScale?: number;
  readonly precision?: number;
  readonly unit?: string;
  readonly toModelValue?: (value: number) => number;
}

export interface ToolOptionsDescriptor {
  readonly id: string;
  readonly tool: EditorTool;
  readonly displayName: string;
  readonly preset: ToolPresetSelection | null;
  readonly properties: readonly ToolOptionPropertyDescriptor[];
  readonly preview: Readonly<{
    color: string;
    width: number;
    opacity: number;
    pressureEnabled: boolean;
  }>;
}

export interface ToolPresetOption {
  readonly id: string;
  readonly name: string;
  readonly defaultSize: number;
  readonly defaultOpacity: number;
  readonly defaultSmoothing: number;
}

export interface ToolPresetSelection {
  readonly activeId: string;
  readonly options: readonly ToolPresetOption[];
}

interface ToolOptionsProvider {
  readonly tool: EditorTool;
  readonly describe: (
    brush: ResolvedDrawingBrush,
    presetSelection: ToolPresetSelection,
  ) => ToolOptionsDescriptor;
}

export interface ToolOptionsDescriptorRegistry {
  readonly describe: (
    tool: EditorTool,
    brush: ResolvedDrawingBrush,
    presetSelection?: ToolPresetSelection,
  ) => ToolOptionsDescriptor | null;
  readonly registeredTools: () => readonly EditorTool[];
}

interface DrawingToolOptionsConfiguration {
  readonly tool: "Pencil" | "Pen" | "Marker" | "Highlighter";
  readonly presetKind: "pencil" | "pen" | "marker" | "highlighter";
  readonly widthConstraints: Readonly<{
    minimum: number;
    maximum: number;
    step: number;
    largeStep: number;
  }>;
}

const DRAWING_WIDTH_CONSTRAINTS = Object.freeze({
  minimum: 0.5,
  maximum: 40,
  step: 0.1,
  largeStep: 1,
});

class ToolOptionsDescriptorRegistryImplementation implements ToolOptionsDescriptorRegistry {
  readonly #providers: ReadonlyMap<EditorTool, ToolOptionsProvider>;

  constructor(providers: readonly ToolOptionsProvider[]) {
    if (new Set(providers.map(({ tool }) => tool)).size !== providers.length) {
      throw new TypeError("Tool option provider identities must be unique.");
    }
    this.#providers = new Map(providers.map((provider) => [provider.tool, provider]));
  }

  describe(
    tool: EditorTool,
    brush: ResolvedDrawingBrush,
    presetSelection?: ToolPresetSelection,
  ): ToolOptionsDescriptor | null {
    const selection =
      presetSelection ??
      Object.freeze({
        activeId: brush.presetId,
        options: Object.freeze([
          Object.freeze({
            id: brush.presetId,
            name: brush.presetId,
            defaultSize: brush.size,
            defaultOpacity: brush.opacity,
            defaultSmoothing: brush.smoothing.amount,
          }),
        ]),
      });
    return this.#providers.get(tool)?.describe(brush, selection) ?? null;
  }

  registeredTools(): readonly EditorTool[] {
    return Object.freeze([...this.#providers.keys()]);
  }
}

export function createDefaultToolOptionsDescriptorRegistry(): ToolOptionsDescriptorRegistry {
  return new ToolOptionsDescriptorRegistryImplementation([
    createDrawingToolOptionsProvider({
      tool: "Pencil",
      presetKind: "pencil",
      widthConstraints: DRAWING_WIDTH_CONSTRAINTS,
    }),
    createDrawingToolOptionsProvider({
      tool: "Pen",
      presetKind: "pen",
      widthConstraints: DRAWING_WIDTH_CONSTRAINTS,
    }),
    createDrawingToolOptionsProvider({
      tool: "Marker",
      presetKind: "marker",
      widthConstraints: DRAWING_WIDTH_CONSTRAINTS,
    }),
    createDrawingToolOptionsProvider({
      tool: "Highlighter",
      presetKind: "highlighter",
      widthConstraints: DRAWING_WIDTH_CONSTRAINTS,
    }),
  ]);
}

function createDrawingToolOptionsProvider(
  configuration: DrawingToolOptionsConfiguration,
): ToolOptionsProvider {
  return Object.freeze({
    tool: configuration.tool,
    describe: (
      brush: ResolvedDrawingBrush,
      presetSelection: ToolPresetSelection,
    ): ToolOptionsDescriptor => {
      if (brush.family !== configuration.presetKind) {
        throw new TypeError(`${configuration.tool} options require a matching drawing preset.`);
      }
      const color = brush.color;
      const width = brush.size;
      const opacity = brush.opacity;
      const activePreset = presetSelection.options.find(
        ({ id }) => id === presetSelection.activeId,
      );
      if (activePreset === undefined) {
        throw new TypeError(`${configuration.tool} options require the active preset definition.`);
      }
      const properties: ToolOptionPropertyDescriptor[] = [
        colorProperty(color),
        numberProperty({
          key: "strokeWidth",
          displayName: "Size",
          value: width,
          ...configuration.widthConstraints,
          defaultValue: activePreset.defaultSize,
          precision: 1,
          unit: "px",
        }),
        numberProperty({
          key: "opacity",
          displayName: "Opacity",
          value: displayOpacityForTool(configuration.tool, opacity),
          minimum: MIN_DRAWING_OPACITY,
          maximum: 1,
          step: 0.01,
          largeStep: 0.05,
          defaultValue: displayOpacityForTool(configuration.tool, activePreset.defaultOpacity),
          displayScale: 100,
          precision: 0,
          unit: "%",
          toModelValue: (value) => modelOpacityForTool(configuration.tool, value),
        }),
      ];
      if (configuration.tool !== "Highlighter") {
        properties.push(
          numberProperty({
            key: "smoothing",
            displayName: "Smoothing",
            value: brush.smoothing.amount,
            minimum: 0,
            maximum: 1,
            step: 0.01,
            largeStep: 0.05,
            defaultValue: activePreset.defaultSmoothing,
            displayScale: 100,
            precision: 0,
            unit: "%",
          }),
        );
      }
      return Object.freeze({
        id: `${configuration.tool.toLowerCase()}-options`,
        tool: configuration.tool,
        displayName: configuration.tool,
        preset: presetSelection.options.length > 1 ? presetSelection : null,
        properties: Object.freeze(properties),
        preview: Object.freeze({
          color,
          width,
          opacity,
          pressureEnabled: brush.dynamics.pressureSize.enabled,
        }),
      });
    },
  });
}

function colorProperty(value: string): ToolOptionPropertyDescriptor {
  return Object.freeze({
    key: "strokeColor",
    control: "color",
    type: "color",
    displayName: "Color",
    value,
    defaultValue: value,
    constraints: Object.freeze({}),
    validate: (candidate: unknown): boolean =>
      typeof candidate === "string" && /^#[0-9a-f]{6}$/iu.test(candidate),
  });
}

function numberProperty(input: {
  readonly key: "strokeWidth" | "opacity" | "smoothing";
  readonly displayName: string;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly largeStep: number;
  readonly defaultValue: number;
  readonly displayScale?: number;
  readonly precision: number;
  readonly unit: string;
  readonly toModelValue?: (value: number) => number;
}): ToolOptionPropertyDescriptor {
  return Object.freeze({
    key: input.key,
    control: "continuous-number",
    type: "number",
    displayName: input.displayName,
    value: input.value,
    defaultValue: input.defaultValue,
    constraints: Object.freeze({
      minimum: input.minimum,
      maximum: input.maximum,
      step: input.step,
    }),
    largeStep: input.largeStep,
    ...(input.displayScale === undefined ? {} : { displayScale: input.displayScale }),
    precision: input.precision,
    unit: input.unit,
    ...(input.toModelValue === undefined ? {} : { toModelValue: input.toModelValue }),
    validate: (candidate: unknown): boolean =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= input.minimum &&
      candidate <= input.maximum,
  });
}
