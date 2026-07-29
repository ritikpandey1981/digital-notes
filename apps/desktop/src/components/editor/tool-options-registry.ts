import type { EditablePropertyDescriptor, PenPreset } from "@folio/editor";
import type { EditorTool } from "./editor-types";
import { MAX_HIGHLIGHTER_OPACITY, MIN_DRAWING_OPACITY } from "./drawing-style-policy";

export type ToolOptionControl = "color" | "continuous-number";

export interface ToolOptionPropertyDescriptor extends EditablePropertyDescriptor<string | number> {
  readonly key: "strokeColor" | "strokeWidth" | "opacity";
  readonly control: ToolOptionControl;
  readonly defaultValue: string | number;
  readonly largeStep?: number;
  readonly displayScale?: number;
  readonly precision?: number;
  readonly unit?: string;
}

export interface ToolOptionsDescriptor {
  readonly id: string;
  readonly tool: EditorTool;
  readonly displayName: string;
  readonly properties: readonly ToolOptionPropertyDescriptor[];
  readonly preview: Readonly<{
    color: string;
    width: number;
    opacity: number;
    pressureEnabled: boolean;
  }>;
}

interface ToolOptionsProvider {
  readonly tool: EditorTool;
  readonly describe: (preset: PenPreset) => ToolOptionsDescriptor;
}

export interface ToolOptionsDescriptorRegistry {
  readonly describe: (tool: EditorTool, preset: PenPreset) => ToolOptionsDescriptor | null;
  readonly registeredTools: () => readonly EditorTool[];
}

interface DrawingToolOptionsConfiguration {
  readonly tool: "Pen" | "Highlighter";
  readonly defaultWidth: number;
  readonly defaultOpacity: number;
  readonly maximumOpacity: number;
}

class ToolOptionsDescriptorRegistryImplementation implements ToolOptionsDescriptorRegistry {
  readonly #providers: ReadonlyMap<EditorTool, ToolOptionsProvider>;

  constructor(providers: readonly ToolOptionsProvider[]) {
    if (new Set(providers.map(({ tool }) => tool)).size !== providers.length) {
      throw new TypeError("Tool option provider identities must be unique.");
    }
    this.#providers = new Map(providers.map((provider) => [provider.tool, provider]));
  }

  describe(tool: EditorTool, preset: PenPreset): ToolOptionsDescriptor | null {
    return this.#providers.get(tool)?.describe(preset) ?? null;
  }

  registeredTools(): readonly EditorTool[] {
    return Object.freeze([...this.#providers.keys()]);
  }
}

export function createDefaultToolOptionsDescriptorRegistry(): ToolOptionsDescriptorRegistry {
  return new ToolOptionsDescriptorRegistryImplementation([
    createDrawingToolOptionsProvider({
      tool: "Pen",
      defaultWidth: 2,
      defaultOpacity: 1,
      maximumOpacity: 1,
    }),
    createDrawingToolOptionsProvider({
      tool: "Highlighter",
      defaultWidth: 12,
      defaultOpacity: 0.34,
      maximumOpacity: MAX_HIGHLIGHTER_OPACITY,
    }),
  ]);
}

function createDrawingToolOptionsProvider(
  configuration: DrawingToolOptionsConfiguration,
): ToolOptionsProvider {
  return Object.freeze({
    tool: configuration.tool,
    describe: (preset: PenPreset): ToolOptionsDescriptor => {
      if (preset.kind !== configuration.tool.toLowerCase()) {
        throw new TypeError(`${configuration.tool} options require a matching drawing preset.`);
      }
      const color = preset.style.strokeColor.hex;
      const width = preset.style.strokeWidth;
      const opacity = preset.style.strokeColor.opacity;
      return Object.freeze({
        id: `${configuration.tool.toLowerCase()}-options`,
        tool: configuration.tool,
        displayName: configuration.tool,
        properties: Object.freeze([
          colorProperty(color),
          numberProperty({
            key: "strokeWidth",
            displayName: "Width",
            value: width,
            minimum: 0.5,
            maximum: 30,
            step: 0.1,
            largeStep: 1,
            defaultValue: configuration.defaultWidth,
            precision: 1,
            unit: "px",
          }),
          numberProperty({
            key: "opacity",
            displayName: "Opacity",
            value: opacity,
            minimum: MIN_DRAWING_OPACITY,
            maximum: configuration.maximumOpacity,
            step: 0.01,
            largeStep: 0.05,
            defaultValue: configuration.defaultOpacity,
            displayScale: 100,
            precision: 0,
            unit: "%",
          }),
        ]),
        preview: Object.freeze({
          color,
          width,
          opacity,
          pressureEnabled: preset.pressure.enabled,
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
  readonly key: "strokeWidth" | "opacity";
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
    validate: (candidate: unknown): boolean =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= input.minimum &&
      candidate <= input.maximum,
  });
}
