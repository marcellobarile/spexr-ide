// Pure helpers + types shared by the description worker (which loads the model)
// and the worker host (which does not). Kept free of @huggingface/transformers
// so the host and its tests never pull the model runtime.

// 0.5B (not 1.5B): ~10x faster on CPU (~33 vs ~3 tok/s) with ample quality for
// one-line descriptions, and a much smaller vendored model (~0.83GB vs ~1.8GB).
export const GEN_MODEL_ID = "onnx-community/Qwen2.5-Coder-0.5B-Instruct";
export const MAX_INPUT_CHARS = 1500;
export const MAX_DESC_CHARS = 120;
export const MAX_NEW_TOKENS = 32;

/** Called with the growing description text as tokens stream in. */
export type OnToken = (partial: string) => void;

/** Produces a one-sentence, whole-file description, or null if unavailable. */
export interface DescriptionGenerator {
  generate(relPath: string, content: string, onToken?: OnToken): Promise<string | null>;
  isAvailable(): boolean;
  dispose?(): void;
}

export const DescriptionGeneratorToken = Symbol("DescriptionGenerator");

/** host → worker */
export interface WorkerRequest {
  id: number;
  relPath: string;
  content: string;
}

/** worker → host */
export type WorkerResponse =
  | { id: number; type: "token"; token: string }
  | { id: number; type: "done"; text: string | null }
  | { id: number; type: "error" };

export function buildPrompt(relPath: string, content: string): string {
  return (
    `File path: ${relPath}\n\n` +
    `Code:\n${content}\n\n` +
    `In one short sentence (max 15 words), describe what this file does. ` +
    `Reply with only the sentence, no preamble.`
  );
}

export function cleanGenerated(raw: string): string {
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const stripped = firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (stripped.length <= MAX_DESC_CHARS) return stripped;
  // Truncate on a word boundary and mark the cut, rather than slicing mid-word.
  const cut = stripped.slice(0, MAX_DESC_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return body.replace(/[.,;:]+$/, "") + "…";
}
