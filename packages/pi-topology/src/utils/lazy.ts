export function lazy<T>(loader: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => {
    value ??= loader();
    return value;
  };
}
