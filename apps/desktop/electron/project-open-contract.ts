import type { DesktopProjectBacking } from "./project-save-contract";

export type ProjectOpenErrorCode =
  | "BUSY"
  | "INVALID_REQUEST"
  | "PERMISSION_DENIED"
  | "READ_FAILED"
  | "FILE_TOO_LARGE"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_VERSION"
  | "RESOURCE_LIMIT"
  | "RUNTIME_FAILED"
  | "TARGET_UNAVAILABLE"
  | "UNKNOWN";
export interface ProjectOpenError {
  readonly code: ProjectOpenErrorCode;
  readonly message: string;
}
export type ProjectOpenFailure = Readonly<{ status: "failed"; error: ProjectOpenError }>;
export type ProjectReadResult =
  | Readonly<{ status: "read"; content: string; backing: DesktopProjectBacking }>
  | Readonly<{ status: "cancelled" }>
  | ProjectOpenFailure;
export type ProjectTargetResult =
  Readonly<{ status: "adopted"; backing: DesktopProjectBacking }> | ProjectOpenFailure;
export type ProjectReleaseResult = Readonly<{ status: "released" }> | ProjectOpenFailure;
export interface DesktopProjectOpenPort {
  readonly open: () => Promise<ProjectReadResult>;
  readonly adopt: (targetId: string) => Promise<ProjectTargetResult>;
  readonly release: (targetId?: string) => Promise<ProjectReleaseResult>;
}
export type ProjectOpenResult =
  | Readonly<{ status: "opened"; backing: DesktopProjectBacking }>
  | Readonly<{ status: "cancelled" }>
  | ProjectOpenFailure
  // Activation is irreversible after A is disposed. Never disguise a lost adoption reply as rollback.
  | Readonly<{ status: "activated-unbacked"; error: ProjectOpenError }>;

export function openFailure(code: ProjectOpenErrorCode, message: string): ProjectOpenFailure {
  return { status: "failed", error: { code, message } };
}

export function isProjectTargetId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}
