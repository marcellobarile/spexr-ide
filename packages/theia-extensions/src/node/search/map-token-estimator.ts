/** Approximate token budget for a Map run. char/4 is the usual rough heuristic. */
export interface MapEstimate {
  fileCount: number;
  chunkCount: number;
  inputTokens: number;
  outputTokens: number;
}

/** ~60 tokens of fixed instruction text per Claude call. */
const PROMPT_OVERHEAD_CHARS = 240;
/** ~20 output tokens per file description. */
const OUTPUT_TOKENS_PER_FILE = 20;

export function estimateMap(summaries: string[], chunkSize: number): MapEstimate {
  const fileCount = summaries.length;
  const chunkCount = Math.max(1, Math.ceil(fileCount / chunkSize));
  const summaryChars = summaries.reduce((n, s) => n + s.length, 0);
  const inputChars = summaryChars + chunkCount * PROMPT_OVERHEAD_CHARS;
  return {
    fileCount,
    chunkCount,
    inputTokens: Math.ceil(inputChars / 4),
    outputTokens: fileCount * OUTPUT_TOKENS_PER_FILE,
  };
}
