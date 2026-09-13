import * as React from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@folio/ui";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";

export type NotificationTone = "success" | "info" | "error";

export interface NotificationInput {
  title: string;
  description?: string;
  tone?: NotificationTone;
  /** Optional single recovery action, normally Undo for a destructive change. */
  action?: Readonly<{ label: string; onAction: () => void }>;
}

interface NotificationItem extends NotificationInput {
  id: number;
  tone: NotificationTone;
}

interface NotificationContextValue {
  notify: (notification: NotificationInput) => void;
}

const NotificationContext = React.createContext<NotificationContextValue | null>(null);

const toneIcons = {
  success: CheckCircle2,
  info: Info,
  error: AlertTriangle,
} satisfies Record<NotificationTone, React.ComponentType<{ className?: string }>>;

export function NotificationProvider({ children }: React.PropsWithChildren) {
  const reducedMotion = useReducedMotion() === true;
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const nextId = React.useRef(1);
  const timers = React.useRef(new Map<number, number>());

  const dismiss = React.useCallback((id: number) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = React.useCallback(
    ({ title, description, tone = "info", action }: NotificationInput) => {
      const id = nextId.current++;
      setNotifications((current) => [
        ...current,
        {
          id,
          title,
          tone,
          ...(description === undefined ? {} : { description }),
          ...(action === undefined ? {} : { action }),
        },
      ]);
      const timer = window.setTimeout(() => dismiss(id), 4200);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  React.useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const value = React.useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {/*
        Anchored bottom-centre so it never overlaps the bottom-right viewport
        controls, and clear of the left hint pill.
      */}
      <div
        className="pointer-events-none fixed bottom-4 left-1/2 z-[80] flex w-[min(340px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
        data-testid="notification-region"
        aria-live="polite"
        aria-label="Notifications"
      >
        <AnimatePresence initial={false}>
          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              reducedMotion={reducedMotion}
              onDismiss={dismiss}
            />
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
}

/**
 * One notification, and the pointer surface it is allowed to own.
 *
 * `AnimatePresence` keeps a dismissed notification mounted while it plays its
 * exit, which is what makes the fade read as a departure rather than a
 * disappearance. It is no longer a live notification during that time: the user
 * has already dealt with it, and their next press belongs to whatever is
 * underneath -- normally the canvas. Leaving it hit-testable meant a press
 * landing in the vacated bounds was swallowed by something on its way out.
 *
 * `useIsPresent` is false from the moment the exit starts, so the card stops
 * taking pointer input exactly when it stops being current, and goes on
 * animating. The same holds on the reduced-motion path, where the exit is brief
 * rather than absent.
 */
function NotificationCard({
  notification,
  reducedMotion,
  onDismiss,
}: {
  readonly notification: NotificationItem;
  readonly reducedMotion: boolean;
  readonly onDismiss: (id: number) => void;
}) {
  const present = useIsPresent();
  const ToneIcon = toneIcons[notification.tone];
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
          duration: motionSeconds(INTERACTION_MOTION.notificationOpenMilliseconds, reducedMotion),
          ease: PROFESSIONAL_EASE,
        },
      }}
      exit={{
        opacity: 0,
        y: 6,
        scale: 0.99,
        transition: {
          duration: motionSeconds(INTERACTION_MOTION.notificationCloseMilliseconds, reducedMotion),
          ease: PROFESSIONAL_EASE,
        },
      }}
      className={cn(
        "folio-floating-surface flex items-center gap-2.5 px-3 py-2 text-folio-ink",
        present ? "pointer-events-auto" : "pointer-events-none",
      )}
      data-testid="notification"
      data-notification-presence={present ? "live" : "exiting"}
      role="status"
    >
      <ToneIcon
        className={cn(
          "size-3.5 shrink-0",
          notification.tone === "success" && "text-emerald-600 dark:text-emerald-400",
          notification.tone === "info" && "text-folio-accent",
          notification.tone === "error" && "text-red-600 dark:text-red-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold">{notification.title}</p>
        {notification.description === undefined ? null : (
          <p className="truncate text-[10px] leading-4 text-folio-muted">
            {notification.description}
          </p>
        )}
      </div>
      {notification.action === undefined ? null : (
        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-folio-accent transition-colors hover:bg-folio-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          data-testid="notification-action"
          onClick={() => {
            notification.action?.onAction();
            onDismiss(notification.id);
          }}
        >
          {notification.action.label}
        </button>
      )}
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-folio-muted transition-[background-color,color,transform] duration-100 ease-out hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95"
        aria-label={`Dismiss ${notification.title}`}
        data-testid="notification-dismiss"
        onClick={() => onDismiss(notification.id)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = React.useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider.");
  }

  return context;
}
