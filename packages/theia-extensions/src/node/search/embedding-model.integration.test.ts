import { describe, expect, it } from "vitest";
import { TransformersEmbedder, EMBEDDING_DIM } from "./embedding-model.js";

// Loads the real ONNX model; slow and requires the vendored weights.
// Run explicitly: pnpm --filter @spexr/theia-extensions test embedding-model.integration
describe("TransformersEmbedder (integration)", () => {
  it("produces deterministic 384-dim vectors", async () => {
    const embedder = new TransformersEmbedder();
    const [a, b] = await embedder.embed(["refresh the auth token", "refresh the auth token"]);
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  }, 60_000);

  it("places related text closer than unrelated text", async () => {
    const embedder = new TransformersEmbedder();
    const [q, near, far] = await embedder.embed([
      "where auth tokens get refreshed",
      "renew the JWT before it expires",
      "render a pie chart of sales",
    ]);
    const dot = (x: Float32Array, y: Float32Array) =>
      x.reduce((sum, v, i) => sum + v * y[i]!, 0);
    expect(dot(q!, near!)).toBeGreaterThan(dot(q!, far!));
  }, 60_000);
});
