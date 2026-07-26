import { ShellDialogProvider } from "./components/dialogs/ShellDialogProvider";
import { NotificationProvider } from "./components/notifications/NotificationProvider";
import { ApplicationShell } from "./components/shell/ApplicationShell";
import { ThemeProvider } from "./components/theme/ThemeProvider";

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <ShellDialogProvider>
          <ApplicationShell />
        </ShellDialogProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}
