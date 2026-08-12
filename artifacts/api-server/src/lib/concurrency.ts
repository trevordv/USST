/**
 * Map independent work with a fixed worker count.
 *
 * Results retain input order and the worker cap prevents unbounded pressure on
 * external services, the database, and the Railway process.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
