/**
 * Persistence-neutral compatibility boundary used only by the legacy Phase 5
 * notebook history manager.
 *
 * The existing persistence DirtyTracker satisfies this contract structurally,
 * allowing callers to keep the current `dirtyTracker` option without making
 * History depend on the Persistence package.
 */
export interface LegacyHistoryDirtySink {
  clear(): void;
  markMetadata(): void;
  markSection(sectionId: string): void;
  markPage(pageId: string, sectionId?: string): void;
}
