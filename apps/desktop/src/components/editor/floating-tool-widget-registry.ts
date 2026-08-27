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
  Object.freeze({ tool: "Pencil", widget: "drawing-options" }),
  Object.freeze({ tool: "Pen", widget: "drawing-options" }),
  Object.freeze({ tool: "Marker", widget: "drawing-options" }),
  Object.freeze({ tool: "Highlighter", widget: "drawing-options" }),
  Object.freeze({ tool: "Eraser", widget: "drawing-options" }),
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

/**
 * Resolves the floating widget after a tool is selected from the dock.
 *
 * The two widget classes behave differently on purpose. Settings are a
 * persistent workspace panel: selecting a tool may open them but never closes
 * them, because the dock's options affordance owns closing and a panel that
 * vanished on re-click was the old undiscoverable behaviour. The shape chooser
 * is a transient popover, so its own tool button keeps toggling it.
 */
export function resolveFloatingWidgetAfterToolSelection(
  activeTool: EditorTool,
  selectedTool: EditorTool,
  activeWidget: FloatingToolWidgetId | null,
  registry: FloatingToolWidgetRegistry,
): FloatingToolWidgetId | null {
  const selectedWidget = registry.widgetFor(selectedTool);
  if (selectedWidget === null) return null;
  if (selectedTool !== activeTool) return selectedWidget === "shapes" ? selectedWidget : null;
  if (selectedWidget === "shapes") return activeWidget === "shapes" ? null : "shapes";
  return activeWidget ?? selectedWidget;
}
