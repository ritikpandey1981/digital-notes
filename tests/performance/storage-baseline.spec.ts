import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  projectFileSystem,
  writeProjectAtomically,
  type ProjectFileSystem,
} from "../../apps/desktop/electron/project-atomic-write";
import { readDesktopProject } from "../../apps/desktop/electron/project-read";
import { fixture } from "./fixtures";
import { encodeFolioProject } from "../../packages/persistence/src/project/index";
import { measureAsync, summarize, type Measurement } from "./metrics";

test("production atomic write stages and bounded read", async () => {
  test.skip(process.env.FOLIO_PERFORMANCE_BASELINE !== "1", "Explicit performance mode required");
  const directory = path.resolve(
    "test-results/performance-data",
    process.env.FOLIO_BASELINE_RUN ?? "storage",
  );
  await mkdir(directory, { recursive: true });
  const results: Measurement[] = [];
  for (const size of [100, 500, 1000]) {
    const target = path.join(directory, `storage-${size}.folio`);
    const content = encodeFolioProject(fixture(size));
    const stages: Record<string, number[]> = { write: [], flush: [], rename: [] };
    let recording = false;
    const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      const result = await operation();
      if (recording) stages[name]!.push(performance.now() - start);
      return result;
    };
    // Wrap the existing injected filesystem boundary; production ordering and durability stay intact.
    const fs: ProjectFileSystem = {
      ...projectFileSystem,
      open: async (...args) => {
        const handle = await projectFileSystem.open(...args);
        return new Proxy(handle, {
          get(target, key) {
            if (key === "writeFile")
              return (...args: Parameters<typeof handle.writeFile>) =>
                timed("write", () => handle.writeFile(...args));
            if (key === "sync") return () => timed("flush", () => handle.sync());
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
      rename: (...args) => timed("rename", () => projectFileSystem.rename(...args)),
    };
    let attempt = 0;
    results.push(
      await measureAsync(
        `storage/${size}/atomic-total`,
        async () => {
          recording = attempt++ >= 4;
          await writeProjectAtomically(target, content, fs);
        },
        10,
      ),
    );
    for (const [name, samples] of Object.entries(stages))
      results.push(summarize(`storage/${size}/${name}`, samples));
    results.push(
      await measureAsync(`storage/${size}/bounded-read`, () => readDesktopProject(target), 10),
    );
    expect(await readFile(target, "utf8")).toBe(content);
    await writeFile(path.join(directory, "storage.json"), JSON.stringify(results, null, 2));
  }
});
