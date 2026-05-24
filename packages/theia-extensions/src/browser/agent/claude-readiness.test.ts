import { describe, it, expect } from "vitest";
import { stripAnsi, isClaudeReady } from "./claude-readiness.js";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("stripAnsi", () => {
  it("removes CSI color and cursor sequences", () => {
    expect(stripAnsi(`${ESC}[2J${ESC}[1;32mhello${ESC}[0m`)).toBe("hello");
  });

  it("removes OSC window-title sequences", () => {
    expect(stripAnsi(`${ESC}]0;claude${BEL}prompt`)).toBe("prompt");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("? for shortcuts")).toBe("? for shortcuts");
  });
});

describe("isClaudeReady", () => {
  it("matches the footer marker even when wrapped in ANSI", () => {
    expect(isClaudeReady(`${ESC}[2m? for shortcuts${ESC}[0m`)).toBe(true);
  });

  it("is case- and spacing-insensitive", () => {
    expect(isClaudeReady("?   FOR   shortcuts")).toBe(true);
  });

  it("is false for boot output before the prompt renders", () => {
    expect(isClaudeReady(`${ESC}[1mStarting Claude...${ESC}[0m`)).toBe(false);
  });
});
