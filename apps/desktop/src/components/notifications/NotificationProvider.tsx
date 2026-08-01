import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  description: string;
  tone?: NotificationTone;
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
    ({ title, description, tone = "info" }: NotificationInput) => {
      const id = nextId.current++;
      setNotifications((current) => [...current, { id, title, description, tone }]);
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
      <div
        className="pointer-events-none fixed bottom-11 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
        aria-label="Notifications"
      >
        <AnimatePresence initial={false}>
          {notifications.map((notification) => {
            const ToneIcon = toneIcons[notification.tone];
            return (
              <motion.div
                key={notification.id}
                layout="position"
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: {
                    duration: motionSeconds(
                      INTERACTION_MOTION.notificationOpenMilliseconds,
                      reducedMotion,
                    ),
                    ease: PROFESSIONAL_EASE,
                  },
                }}
                exit={{
                  opacity: 0,
                  y: 6,
                  scale: 0.99,
                  transition: {
                    duration: motionSeconds(
                      INTERACTION_MOTION.notificationCloseMilliseconds,
                      reducedMotion,
                    ),
                    ease: PROFESSIONAL_EASE,
                  },
                }}
                className="pointer-events-auto flex gap-3 rounded-[16px] border border-folio-border bg-folio-glass p-3.5 text-folio-ink shadow-xl backdrop-blur-xl"
                role="status"
              >
                <ToneIcon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    notification.tone === "success" && "text-emerald-600 dark:text-emerald-400",
                    notification.tone === "info" && "text-folio-accent",
                    notification.tone === "error" && "text-red-600 dark:text-red-400",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{notification.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-folio-muted">
                    {notification.description}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-folio-muted transition-[background-color,color,transform,box-shadow] duration-100 ease-out hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95"
                  aria-label={`Dismiss ${notification.title}`}
                  onClick={() => dismiss(notification.id)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = React.useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider.");
  }

  return context;
}
