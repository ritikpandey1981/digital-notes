import { CURRENT_NOTEBOOK_FORMAT_VERSION, CURRENT_RECOVERY_FORMAT_VERSION } from "./constants";
import { PersistenceError } from "./errors";

export function validateNotebookFormatVersion(value: unknown, filePath?: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new PersistenceError(
      "UNSUPPORTED_VERSION",
      "Notebook format version is missing or invalid.",
      {
        path: filePath,
        details: { received: value },
      },
    );
  }
  if (value !== CURRENT_NOTEBOOK_FORMAT_VERSION) {
    throw new PersistenceError(
      "UNSUPPORTED_VERSION",
      `Notebook format version ${String(value)} is not supported; expected ${CURRENT_NOTEBOOK_FORMAT_VERSION}.`,
      { path: filePath, details: { received: value, supported: CURRENT_NOTEBOOK_FORMAT_VERSION } },
    );
  }
  return value as number;
}

export function validateRecoveryFormatVersion(value: unknown, filePath?: string): number {
  if (value !== CURRENT_RECOVERY_FORMAT_VERSION) {
    throw new PersistenceError(
      "UNSUPPORTED_VERSION",
      `Recovery format version ${String(value)} is not supported; expected ${CURRENT_RECOVERY_FORMAT_VERSION}.`,
      { path: filePath, details: { received: value, supported: CURRENT_RECOVERY_FORMAT_VERSION } },
    );
  }
  return value as number;
}
