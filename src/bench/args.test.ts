import { describe, expect, it } from "vitest";
import { DEFAULT_BENCH_ARGS, parseArgs, parseByteSize } from "./args.js";

describe("parseByteSize", () => {
  it("parses a bare integer as bytes", () => {
    expect(parseByteSize("1024")).toBe(1024);
  });

  it("parses k/m/g suffixes (case-insensitive) as binary multiples", () => {
    expect(parseByteSize("16k")).toBe(16 * 1024);
    expect(parseByteSize("16K")).toBe(16 * 1024);
    expect(parseByteSize("256m")).toBe(256 * 1024 * 1024);
    expect(parseByteSize("256M")).toBe(256 * 1024 * 1024);
    expect(parseByteSize("1g")).toBe(1 * 1024 * 1024 * 1024);
    expect(parseByteSize("1G")).toBe(1 * 1024 * 1024 * 1024);
  });

  it("throws on a non-numeric value", () => {
    expect(() => parseByteSize("banana")).toThrow(/invalid byte size/i);
  });

  it("throws on a zero or negative value", () => {
    expect(() => parseByteSize("0")).toThrow(/positive/i);
    expect(() => parseByteSize("-5")).toThrow(/positive/i);
  });

  it("throws on an unknown suffix", () => {
    expect(() => parseByteSize("5t")).toThrow(/invalid byte size/i);
  });
});

describe("parseArgs", () => {
  it("returns DEFAULT_BENCH_ARGS when given no flags", () => {
    expect(parseArgs([])).toEqual(DEFAULT_BENCH_ARGS);
  });

  it("overrides trials, size, chunk, payload, out, and port from flags", () => {
    const args = parseArgs([
      "--trials=5",
      "--size=64m",
      "--chunk=8m",
      "--payload=smoke",
      "--out=/tmp/result.json",
      "--port=9999",
    ]);
    expect(args).toEqual({
      trials: 5,
      fileSizeBytes: 64 * 1024 * 1024,
      chunkSizeBytes: 8 * 1024 * 1024,
      payload: "smoke",
      outFile: "/tmp/result.json",
      headless: true,
      port: 9999,
    });
  });

  it("sets headless to false when --headed is passed", () => {
    expect(parseArgs(["--headed"]).headless).toBe(false);
  });

  it("throws a clear error for an unrecognized flag", () => {
    expect(() => parseArgs(["--bogus=1"])).toThrow(/unrecognized/i);
  });

  it("throws a clear error when --trials is not a positive integer", () => {
    expect(() => parseArgs(["--trials=0"])).toThrow(/positive integer/i);
    expect(() => parseArgs(["--trials=abc"])).toThrow(/positive integer/i);
    expect(() => parseArgs(["--trials=1.5"])).toThrow(/positive integer/i);
  });

  it("throws a clear error when --port is not a non-negative integer", () => {
    expect(() => parseArgs(["--port=-1"])).toThrow(/non-negative integer/i);
    expect(() => parseArgs(["--port=abc"])).toThrow(/non-negative integer/i);
  });

  it("throws a clear error when a flag has no value", () => {
    expect(() => parseArgs(["--trials"])).toThrow(/expected --trials=/i);
  });

  it("throws a clear error for a bare positional argument (no leading --)", () => {
    expect(() => parseArgs(["bogus"])).toThrow(/expected --bogus=/i);
  });
});
