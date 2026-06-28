// Runs the text-generation model in a dedicated worker thread so inference never
// stalls the backend event loop. Receives WorkerRequest messages, streams token
// chunks back, then a final cleaned description (or an error). One request at a
// time: the model is single-threaded and the parent serializes anyway.
import { parentPort, workerData } from "node:worker_threads";
import { env, pipeline, TextStreamer } from "@huggingface/transformers";
import {
  GEN_MODEL_ID,
  MAX_INPUT_CHARS,
  MAX_NEW_TOKENS,
  buildPrompt,
  cleanGenerated,
  type WorkerRequest,
  type WorkerResponse,
} from "./description-format.js";

const port = parentPort;
const modelsDir: string = workerData?.modelsDir;

type TextGenPipeline = {
  tokenizer: unknown;
  (messages: unknown, options: unknown): Promise<
    Array<{ generated_text?: Array<{ role: string; content: string }> }>
  >;
};

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
  const { id, relPath, content } = req;
  try {
    const pipe = await getPipe();
    const streamer = new TextStreamer(pipe.tokenizer as ConstructorParameters<typeof TextStreamer>[0], {
      skip_prompt: true,
      callback_function: (token: string) => post({ id, type: "token", token }),
    });
    const out = await pipe(
      [{ role: "user", content: buildPrompt(relPath, content.slice(0, MAX_INPUT_CHARS)) }],
      { max_new_tokens: MAX_NEW_TOKENS, do_sample: false, streamer },
    );
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    const raw = typeof last?.content === "string" ? last.content : "";
    const text = cleanGenerated(raw);
    post({ id, type: "done", text: text.length > 0 ? text : null });
  } catch {
    post({ id, type: "error" });
  }
}

// Serialize requests: chain each onto the previous so only one inference runs.
let chain: Promise<void> = Promise.resolve();
port?.on("message", (req: WorkerRequest) => {
  chain = chain.then(() => handle(req));
});
