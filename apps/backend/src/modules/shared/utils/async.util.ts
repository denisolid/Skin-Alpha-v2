export async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: readonly TInput[],
  concurrencyLimit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const normalizedConcurrencyLimit = Math.max(
    1,
    Math.min(items.length, Math.floor(concurrencyLimit)),
  );
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;

      nextIndex += 1;
      results[currentIndex] = await mapper(
        items[currentIndex]!,
        currentIndex,
      );
    }
  };

  await Promise.all(
    Array.from({ length: normalizedConcurrencyLimit }, () => worker()),
  );

  return results;
}

export function chunkArray<T>(
  items: readonly T[],
  chunkSize: number,
): T[][] {
  if (items.length === 0) {
    return [];
  }

  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += normalizedChunkSize) {
    chunks.push(items.slice(index, index + normalizedChunkSize));
  }

  return chunks;
}
