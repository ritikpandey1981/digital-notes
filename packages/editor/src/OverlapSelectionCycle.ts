/** Editor-owned candidate cursor for deterministic overlap selection. */
export class OverlapSelectionCycle {
  #signature = "";
  #candidateIds: readonly string[] = Object.freeze([]);
  #index = 0;

  preview(candidateIds: readonly string[], selectedObjectId: string | null): string | null {
    const normalized = Object.freeze([...candidateIds]);
    const signature = normalized.join("\u0000");
    if (signature !== this.#signature) {
      const selectedIndex = selectedObjectId === null ? -1 : normalized.indexOf(selectedObjectId);
      this.#index = selectedIndex < 0 ? 0 : (selectedIndex + 1) % Math.max(normalized.length, 1);
      this.#signature = signature;
      this.#candidateIds = normalized;
    }
    return this.#candidateIds[this.#index] ?? null;
  }

  commit(candidateIds: readonly string[], selectedObjectId: string | null): string | null {
    const candidate = this.preview(candidateIds, selectedObjectId);
    if (candidate === null) return null;
    this.#index = (this.#index + 1) % this.#candidateIds.length;
    return candidate;
  }

  reset(): void {
    this.#signature = "";
    this.#candidateIds = Object.freeze([]);
    this.#index = 0;
  }
}
