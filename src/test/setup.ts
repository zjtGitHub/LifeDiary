import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";

// Node's structuredClone drops jsdom Blob internals. Blobs are immutable, so keep
// their identity while cloning plain records in fake-indexeddb, as a browser does.
const nativeClone = globalThis.structuredClone;
function cloneWithBlobs<T>(value: T): T {
  if (value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map(cloneWithBlobs) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneWithBlobs(item)])) as T;
  }
  return nativeClone(value);
}
globalThis.structuredClone = cloneWithBlobs;

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:test-url");
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}
