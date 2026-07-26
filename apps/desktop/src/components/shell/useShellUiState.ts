import * as React from "react";
import type { ShellSection } from "./shell-types";

export function useShellUiState() {
  const [sidebarExpanded, setSidebarExpanded] = React.useState(true);
  const [activeSection, setActiveSection] = React.useState<ShellSection>("Library");

  return {
    activeSection,
    selectSection: setActiveSection,
    sidebarExpanded,
    toggleSidebar: () => setSidebarExpanded((expanded) => !expanded),
  };
}
