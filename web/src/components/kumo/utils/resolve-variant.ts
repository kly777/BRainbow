/**
 * Resolve a runtime variant value without allowing untyped JavaScript,
 * server data, or stale persisted props to crash a component.
 */
export function resolveVariant<T extends Record<string, unknown>>(
  variants: T,
  key: string,
  fallback: keyof T & string,
): T[keyof T] {
  const config = (variants as Record<string, unknown>)[key] as
    | T[keyof T]
    | undefined;

  if (config !== undefined) return config;

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[kumo] Unknown variant "${key}". Expected one of: ${Object.keys(variants).join(", ")}. Falling back to "${fallback}".`,
    );
  }

  return variants[fallback];
}
