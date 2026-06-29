// Runs the text-generation model in a dedicated worker thread so inference never
// stalls the backend event loop. Receives WorkerRequest messages, runs inference,
// then posts a final cleaned description (or an error). One request at a time:
// the model is single-threaded and the parent serializes anyway.
import { parentPort, workerData } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";
import {
  GEN_MODEL_ID,
  MAX_BATCH_TOKENS,
  MAX_TOKENS_PER_FILE,
  buildBatchPrompt,
  parseBatchOutput,
  type WorkerRequest,
  type WorkerResponse,
} from "./description-format.js";

const port = parentPort;
const modelsDir: string = workerData?.modelsDir;

type TextGenPipeline = (
  messages: unknown,
  options: unknown,
) => Promise<Array<{ generated_text?: Array<{ role: string; content: string }> }>>;

let pipePromise: Promise<TextGenPipeline> | undefined;

function getPipe(): Promise<TextGenPipeline> {
  if (!pipePromise) {
    env.allowRemoteModels = false;
    env.localModelPath = modelsDir;
    pipePromise = pipeline("text-generation", GEN_MODEL_ID, { dtype: "q4" }) as unknown as Promise<TextGenPipeline>;
  }
  return pipePromise;
}

function post(msg: WorkerResponse): void {
  port?.postMessage(msg);
}

async function handle(req: WorkerRequest): Promise<void> {
  const { id, items } = req;
  if (items.length === 0) {
    post({ id, type: "done", texts: [] });
    return;
  }
  try {
    const pipe = await getPipe();
    // +2 lines of headroom: the model re-emits the one-shot example before the
    // real files, and a tight budget otherwise truncates the last file's line.
    const maxTokens = Math.min((items.length + 2) * MAX_TOKENS_PER_FILE, MAX_BATCH_TOKENS);
    const out = await pipe(
      [{ role: "user", content: buildBatchPrompt(items) }],
      { max_new_tokens: maxTokens, do_sample: false },
    );
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    const raw = typeof last?.content === "string" ? last.content : "";
    post({ id, type: "done", texts: parseBatchOutput(raw, items.map((it) => it.relPath)) });
  } catch {
    post({ id, type: "error" });
  }
}

// Serialize requests: chain each onto the previous so only one inference runs.
let chain: Promise<void> = Promise.resolve();
port?.on("message", (req: WorkerRequest) => {
  chain = chain.then(() => handle(req));
});
