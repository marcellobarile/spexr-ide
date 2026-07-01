import { cosineSimilarity } from "./vector-math.js";
import type { Embedder } from "./embedding-model.js";

export type FileCategory = "frontend" | "backend" | "test" | "config" | "other";

const ANCHOR_PHRASES: [FileCategory, string][] = [
  ["frontend", "React component UI browser frontend HTML CSS visual rendering stylesheet"],
  ["backend",  "Node.js backend server API service handler injectable RPC middleware"],
  ["test",     "unit test specification mock assertion describe it expect vitest jest"],
  ["config",   "configuration settings environment build package JSON YAML Dockerfile"],
  ["other",    "utility helper shared common module library types interfaces constants"],
];

export function classifyByHeuristic(relPath: string, firstLines: string): FileCategory | null {
  const p = relPath.toLowerCase();
  if (/\.(test|spec)\.[jt]sx?$/.test(p) || /\/__tests__\//.test(p)) return "test";
  if (/\.(json|ya?ml|toml)$/.test(p) || /dockerfile$/i.test(p) || /\.config\.[jt]sx?$/.test(p)) return "config";
  if (/\/(browser|frontend|client)\//.test(p) || /\.(tsx|css|scss|less|vue|svelte)$/.test(p)) return "frontend";
  if (/import\s+[{*].*\bReact\b|from\s+['"]react['"]/.test(firstLines)) return "frontend";
  if (/\/(node|backend|server|api)\//.test(p)) return "backend";
  if (/@injectable|from\s+['"]express|from\s+['"]fastify|lib\/node\//.test(firstLines)) return "backend";
  return null;
}

export class FileClassifier {
  private anchors?: [FileCategory, Float32Array][];
  private initPromise?: Promise<void>;

  constructor(private readonly embedder: Embedder) {}

  private ensureAnchors(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.embedder
        .embed(ANCHOR_PHRASES.map(([, phrase]) => phrase))
        .then((vectors) => {
          this.anchors = ANCHOR_PHRASES.map(([cat], i) => [cat, vectors[i]!]);
        });
    }
    return this.initPromise;
  }

  async classify(relPath: string, firstLines: string, vector: Float32Array): Promise<FileCategory> {
    const heuristic = classifyByHeuristic(relPath, firstLines);
    if (heuristic) return heuristic;
    await this.ensureAnchors();
    let best: FileCategory = "other";
    let bestScore = -Infinity;
    for (const [cat, anchor] of this.anchors!) {
      const score = cosineSimilarity(vector, anchor);
      if (score > bestScore) { bestScore = score; best = cat; }
    }
    return best;
  }
}
