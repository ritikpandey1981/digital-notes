/** Private bounded LIFO storage used by the generic History manager. */
export class BoundedCommandStack<TEntry> {
  readonly #entries: TEntry[] = [];

  constructor(readonly limit: number) {}

  get depth(): number {
    return this.#entries.length;
  }

  get isEmpty(): boolean {
    return this.#entries.length === 0;
  }

  peek(): TEntry | undefined {
    return this.#entries.at(-1);
  }

  pop(): TEntry | undefined {
    return this.#entries.pop();
  }

  push(entry: TEntry): void {
    this.#entries.push(entry);
    const overflow = this.#entries.length - this.limit;
    if (overflow > 0) this.#entries.splice(0, overflow);
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
