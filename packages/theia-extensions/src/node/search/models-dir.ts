import { resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Directory holding vendored ONNX models: env override, else <package>/resources/models.
 *
 * Two resolution strategies because __dirname differs between dev and webpack:
 * - Source tree: lib/node/search/*.js → ../../../resources/models
 * - Webpack bundle (apps/desktop/lib/backend/main.js): ../../../ lands in apps/desktop/,
 *   so fall back to node_modules/@spexr/theia-extensions (a workspace symlink).
 */
export function resolveModelsDir(): string {
  if (process.env.SPEXR_MODELS_DIR) return process.env.SPEXR_MODELS_DIR;
  const fromSource = resolve(__dirname, "..", "..", "..", "resources", "models");
  if (existsSync(fromSource)) return fromSource;
  return resolve(__dirname, "..", "..", "node_modules", "@spexr", "theia-extensions", "resources", "models");
}
