/** Shared string formatting helpers. */

/** `some_node-name` → `Some Node Name`. */
export const titleCase = (s: string): string =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
