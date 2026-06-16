import path from "node:path";

export function isPathInsideAllowed(targetPath: string, allowedPaths: string[]): boolean {
  const target = normalize(targetPath);
  return allowedPaths.some((allowed) => {
    const base = normalize(allowed);
    return target === base || target.startsWith(`${base}${path.sep}`);
  });
}

export function normalize(input: string): string {
  return path.resolve(input);
}
