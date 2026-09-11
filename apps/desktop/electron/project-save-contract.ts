/** Serializable desktop capability contract. It contains no filesystem primitives. */
export interface DesktopProjectBacking {
  readonly id: string;
  readonly displayName: string;
}

export type ProjectSaveErrorCode =
  | "ENCODE_FAILED"
  | "BUSY"
  | "INVALID_REQUEST"
  | "PERMISSION_DENIED"
  | "READ_ONLY"
  | "WRITE_FAILED"
  | "REPLACE_FAILED"
  | "TARGET_UNAVAILABLE"
  | "UNKNOWN";

export type ProjectSaveResult =
  | Readonly<{ status: "saved"; backing: DesktopProjectBacking }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      status: "failed";
      error: Readonly<{ code: ProjectSaveErrorCode; message: string }>;
    }>;

export type ProjectSaveRequest =
  | Readonly<{ kind: "saveAs"; title: string; content: string }>
  | Readonly<{ kind: "save"; targetId: string; content: string }>;

export interface DesktopProjectSavePort {
  readonly save: (request: ProjectSaveRequest) => Promise<ProjectSaveResult>;
}

export function saveFailure(code: ProjectSaveErrorCode, message: string): ProjectSaveResult {
  return { status: "failed", error: { code, message } };
}
