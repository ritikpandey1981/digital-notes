export interface Measurement {
  name: string;
  samples: number[];
  cold?: number;
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number | null;
  max: number;
  over16_67: number;
  over33_3: number;
}

/** Nearest-rank percentiles; fewer than 100 observations cannot support a p99. */
export function summarize(name: string, samples: number[], cold?: number): Measurement {
  if (!samples.length || samples.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error(`Invalid samples: ${name}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]!;
  return {
    name,
    samples,
    ...(cold === undefined ? {} : { cold }),
    count: samples.length,
    min: sorted[0]!,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: samples.length >= 100 ? percentile(0.99) : null,
    max: sorted.at(-1)!,
    over16_67: samples.filter((value) => value > 16.67).length,
    over33_3: samples.filter((value) => value > 33.3).length,
  };
}

export function measure(
  name: string,
  operation: () => unknown,
  count = 20,
  warmups = 3,
): Measurement {
  const once = () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  };
  const cold = once();
  for (let index = 0; index < warmups; index++) once();
  return summarize(name, Array.from({ length: count }, once), cold);
}

export async function measureAsync(
  name: string,
  operation: () => Promise<unknown>,
  count = 20,
  warmups = 3,
): Promise<Measurement> {
  const once = async () => {
    const start = performance.now();
    await operation();
    return performance.now() - start;
  };
  const cold = await once();
  for (let index = 0; index < warmups; index++) await once();
  const samples = [];
  for (let index = 0; index < count; index++) samples.push(await once());
  return summarize(name, samples, cold);
}
