// Downloads the quantized all-MiniLM-L6-v2 model into resources/models so the
// app can run feature-extraction fully offline. Run once before packaging:
//   node scripts/fetch-search-model.mjs
import { env, pipeline } from "@xenova/transformers";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = resolve(here, "..", "resources", "models");

env.allowRemoteModels = true;
env.cacheDir = modelsDir; // store the downloaded files here

const id = "Xenova/all-MiniLM-L6-v2";
console.log(`Fetching ${id} into ${modelsDir} ...`);
await pipeline("feature-extraction", id, { quantized: true });
console.log("Done.");
