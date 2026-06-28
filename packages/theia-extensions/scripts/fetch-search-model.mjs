// Downloads the models into resources/models so the app runs fully offline:
// all-MiniLM-L6-v2 (embeddings, q8) and Qwen2.5-Coder-1.5B-Instruct
// (file descriptions, q4). Run once before packaging:
//   node scripts/fetch-search-model.mjs
import { env, pipeline } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "..", "resources", "models");

env.allowRemoteModels = true;
env.cacheDir = modelsDir; // store the downloaded files here

const embedId = "Xenova/all-MiniLM-L6-v2";
console.log(`Fetching ${embedId} into ${modelsDir} ...`);
await pipeline("feature-extraction", embedId, { dtype: "q8" });

const genId = "onnx-community/Qwen2.5-Coder-1.5B-Instruct";
console.log(`Fetching ${genId} into ${modelsDir} ...`);
await pipeline("text-generation", genId, { dtype: "q4" });

console.log("Done.");
