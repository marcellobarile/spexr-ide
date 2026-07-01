import { describe, expect, it, afterEach } from "vitest";
import { resolveModelsDir } from "./models-dir.js";

describe("resolveModelsDir", () => {
  afterEach(() => { delete process.env.SPEXR_MODELS_DIR; });

  it("honors the SPEXR_MODELS_DIR override", () => {
    process.env.SPEXR_MODELS_DIR = "/custom/models";
    expect(resolveModelsDir()).toBe("/custom/models");
  });

  it("returns an absolute path when no override is set", () => {
    expect(resolveModelsDir().startsWith("/")).toBe(true);
  });
});
