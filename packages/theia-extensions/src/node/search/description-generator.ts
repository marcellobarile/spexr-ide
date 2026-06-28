import { injectable } from "@theia/core/shared/inversify";
import { env, pipeline } from "@xenova/transformers";
import { resolveModelsDir } from "./models-dir.js";

export const GEN_MODEL_ID = "onnx-community/Qwen2.5-Coder-1.5B-Instruct";
const MAX_INPUT_CHARS = 1500;
const MAX_DESC_CHARS = 120;
const MAX_NEW_TOKENS = 40;

/** Produces a one-sentence, whole-file description, or null if unavailable. */
export interface DescriptionGenerator {
  generate(relPath: string, content: string): Promise<string | null>;
  isAvailable(): boolean;
}

export const DescriptionGeneratorToken = Symbol("DescriptionGenerator");

/** Low-level text generation: prompt in, raw completion out. */
export type TextGenerateFn = (prompt: string) => Promise<string>;

export function buildPrompt(relPath: string, content: string): string {
  return (
    `File path: ${relPath}\n\n` +
    `Code:\n${content}\n\n` +
    `In one short sentence, describe what this file does. ` +
    `Reply with only the sentence, no preamble.`
  );
}

export function cleanGenerated(raw: string): string {
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return firstLine.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, MAX_DESC_CHARS);
}

/** Default loader: an offline Qwen2.5-Coder ONNX text-generation pipeline. */
async function defaultLoader(): Promise<TextGenerateFn> {
  env.allowRemoteModels = false;
  env.localModelPath = resolveModelsDir();
  const pipe = await pipeline("text-generation", GEN_MODEL_ID, { quantized: true });
  return async (prompt: string): Promise<string> => {
    const out = (await pipe([{ role: "user", content: prompt }], {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
    })) as Array<{ generated_text?: Array<{ role: string; content: string }> }>;
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    return typeof last?.content === "string" ? last.content : "";
  };
}

/**
 * In-process generator over a small instruct model. Loads lazily on first use,
 * serializes inference (one at a time), de-duplicates concurrent requests per
 * path, and degrades to null permanently if the model cannot load.
 */
@injectable()
export class TransformersDescriptionGenerator implements DescriptionGenerator {
  private loadPromise?: Promise<TextGenerateFn | null>;
  private loadFailed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly loader: () => Promise<TextGenerateFn> = defaultLoader) {}

  isAvailable(): boolean {
    return !this.loadFailed;
  }

  generate(relPath: string, content: string): Promise<string | null> {
    if (this.loadFailed) return Promise.resolve(null);
    const existing = this.inflight.get(relPath);
    if (existing) return existing;
    const run = this.enqueue(relPath, content.slice(0, MAX_INPUT_CHARS));
    this.inflight.set(relPath, run);
    void run.finally(() => this.inflight.delete(relPath));
    return run;
  }

  private enqueue(relPath: string, content: string): Promise<string | null> {
    const run = this.queue.then(() => this.runOne(relPath, content));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runOne(relPath: string, content: string): Promise<string | null> {
    const fn = await this.ensureLoaded();
    if (!fn) return null;
    try {
      const text = cleanGenerated(await fn(buildPrompt(relPath, content)));
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  private ensureLoaded(): Promise<TextGenerateFn | null> {
    if (!this.loadPromise) {
      this.loadPromise = this.loader().catch(() => {
        this.loadFailed = true;
        return null;
      });
    }
    return this.loadPromise;
  }
}
