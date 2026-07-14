import { describe, expect, it } from "vitest";
import { parseFrame } from "../src/streaming/sse.js";

describe("parseFrame", () => {
  it("parses event name and JSON data line", () => {
    const frame = 'event: article\ndata: {"id":"a1","title":"Hello"}';
    expect(parseFrame(frame)).toEqual({
      event: "article",
      data: '{"id":"a1","title":"Hello"}',
    });
  });

  it("defaults the event name to message", () => {
    expect(parseFrame("data: {}")).toEqual({ event: "message", data: "{}" });
  });

  it("ignores comment keepalives", () => {
    expect(parseFrame(": keepalive")).toBeUndefined();
  });

  it("joins multi-line data with newlines", () => {
    const frame = "event: article\ndata: line1\ndata: line2";
    expect(parseFrame(frame)?.data).toBe("line1\nline2");
  });
});
