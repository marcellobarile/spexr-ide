import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { resolve } from "node:path";

export const EMBEDDING_DIM = 384;
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Produces sentence embeddings for a batch of texts. */
export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Directory holding the vendored model: env override, else <package>/resources/models. */
function resolveModelsDir(): string {
  if (process.env.SPEXR_MODELS_DIR) return process.env.SPEXR_MODELS_DIR;
  // this file is compiled to lib/node/search/embedding-model.js → ../../../resources/models
  return resolve(__dirname, "..", "..", "..", "resources", "models");
}

/**
 * In-process ONNX embedder over `all-MiniLM-L6-v2`, configured for offline use.
 * The pipeline is loaded lazily on first `embed` and reused afterwards.
 */
export class TransformersEmbedder implements Embedder {
  private pipelinePromise?: Promise<FeatureExtractionPipeline>;

  private getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      env.allowRemoteModels = false;
      env.localModelPath = resolveModelsDir();
      this.pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
        quantized: true,
      });
    }
    return this.pipelinePromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.getPipeline();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const rows = output.tolist() as number[][];
    return rows.map((row) => Float32Array.from(row));
  }
}
