import type { EditorTool } from "./editor-types";

export type FloatingToolWidgetId = "drawing-options" | "shapes";

export interface FloatingToolWidgetRegistry {
  readonly widgetFor: (tool: EditorTool) => FloatingToolWidgetId | null;
  readonly registeredTools: () => readonly EditorTool[];
}

interface FloatingToolWidgetRegistration {
  readonly tool: EditorTool;
  readonly widget: FloatingToolWidgetId;
}

const defaultRegistrations: readonly FloatingToolWidgetRegistration[] = Object.freeze([
  Object.freeze({ tool: "Pen", widget: "drawing-options" }),
  Object.freeze({ tool: "Highlighter", widget: "drawing-options" }),
  Object.freeze({ tool: "Shapes", widget: "shapes" }),
]);

export function createFloatingToolWidgetRegistry(
  registrations: readonly FloatingToolWidgetRegistration[] = defaultRegistrations,
): FloatingToolWidgetRegistry {
  const widgets = new Map<EditorTool, FloatingToolWidgetId>();
  for (const registration of registrations) {
    if (widgets.has(registration.tool)) {
      throw new Error(`Floating widget already registered for ${registration.tool}.`);
    }
    widgets.set(registration.tool, registration.widget);
  }
  return Object.freeze({
    widgetFor: (tool: EditorTool): FloatingToolWidgetId | null => widgets.get(tool) ?? null,
    registeredTools: (): readonly EditorTool[] => Object.freeze([...widgets.keys()]),
  });
}

export function resolveFloatingWidgetAfterToolSelection(
  activeTool: EditorTool,
  selectedTool: EditorTool,
  activeWidget: FloatingToolWidgetId | null,
  registry: FloatingToolWidgetRegistry,
): FloatingToolWidgetId | null {
  const selectedWidget = registry.widgetFor(selectedTool);
  if (selectedWidget === null) return null;
  if (selectedTool === "Shapes" && selectedTool !== activeTool) return selectedWidget;
  if (selectedTool !== activeTool) return null;
  return activeWidget === selectedWidget ? null : selectedWidget;
}
