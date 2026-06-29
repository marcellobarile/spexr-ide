// Pure helpers + types shared by the description worker (which loads the model)
// and the worker host (which does not). Kept free of @huggingface/transformers
// so the host and its tests never pull the model runtime.

// 0.5B (not 1.5B): ~10x faster on CPU (~33 vs ~3 tok/s) with ample quality for
// one-line descriptions, and a much smaller vendored model (~0.83GB vs ~1.8GB).
export const GEN_MODEL_ID = "onnx-community/Qwen2.5-Coder-0.5B-Instruct";
export const MAX_DESC_CHARS = 120;
export const MAX_NEW_TOKENS = 32;

/** Produces a one-sentence, whole-file description, or null if unavailable. */
export interface DescriptionGenerator {
  generate(relPath: string, content: string): Promise<string | null>;
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
  | { id: number; type: "done"; text: string | null }
  | { id: number; type: "error" };

const NOISE_RE = /copyright|license|eslint|prettier|@ts-|use strict/i;

// Common keywords that are not meaningful symbol names across JS/TS/Python/Go/Rust/Java/C#/etc.
const SKIP_NAMES = new Set([
  "if", "for", "while", "switch", "return", "throw", "const", "let", "var",
  "new", "typeof", "instanceof", "void", "await", "yield", "super",
  "this", "true", "false", "null", "undefined", "nil", "none", "None", "True", "False",
  "import", "export", "default", "package", "use", "from", "as",
  "class", "struct", "interface", "enum", "trait", "impl", "type", "module",
  "function", "fn", "func", "fun", "def", "sub", "async", "pub", "public",
  "private", "protected", "static", "abstract", "sealed", "final", "override",
  "readonly", "virtual", "extern", "inline", "unsafe", "open", "suspend",
  "try", "catch", "finally", "else", "in", "of", "is",
  "break", "continue", "do", "pass", "self", "cls",
  "object", "namespace",
]);

function extractHeaderComment(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  if (lines[0]?.startsWith("#!")) i++;
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i >= lines.length) break;
    const line = lines[i]!.trim();

    if (line.startsWith("/*")) {
      const block: string[] = [];
      while (i < lines.length) {
        block.push(lines[i]!);
        if (lines[i]!.includes("*/")) { i++; break; }
        i++;
      }
      if (NOISE_RE.test(block.join(" "))) continue;
      const text = block.join("\n")
        .replace(/^[ \t]*\/\*+/, "").replace(/\*+\/[ \t]*$/, "")
        .split("\n").map((l) => l.replace(/^[ \t]*\*\s?/, "").trim())
        .filter((l) => l && !l.startsWith("@") && !NOISE_RE.test(l))
        .slice(0, 2).join(" ").trim();
      if (text.length > 10) return text;
      continue;
    }

    if (line.startsWith("//")) {
      const block: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("//")) block.push(lines[i++]!);
      if (NOISE_RE.test(block.join(" "))) continue;
      const text = block.map((l) => l.replace(/^[ \t]*\/\/\s?/, "").trim())
        .filter((l) => l && !NOISE_RE.test(l)).slice(0, 2).join(" ").trim();
      if (text.length > 10) return text;
      continue;
    }

    break;
  }
  return "";
}

// Markup/config/data formats where raw content is more descriptive than symbol extraction.
const PROSE_LIKE_EXTS = new Set([
  "md", "mdx", "markdown", "rst", "adoc", "txt",
  "html", "htm", "xhtml",
  "css", "scss", "less", "sass",
  "xml", "xsd", "xslt", "svg",
  "json", "jsonc", "json5",
  "yaml", "yml", "toml",
  "graphql", "gql",
  "sql",
]);

/**
 * Extract meaningful symbol names from source code across common languages:
 * JS/TS, Python, Go, Rust, Java, Kotlin, C#, Swift, Ruby, PHP, Elixir, etc.
 * Returns declaration names only — no values, no bodies, no imports.
 */
function extractSymbolNames(content: string): string[] {
  const names: string[] = [];
  const keep = (n: string | undefined): n is string =>
    !!n && n.length >= 2 && !SKIP_NAMES.has(n);

  // Type-like declarations: class, struct, interface, enum, trait, impl, module, object
  // Covers: JS/TS, Python, Go, Rust, Java, Kotlin, Swift, C#, Ruby, PHP, Scala, Elixir…
  for (const m of content.matchAll(
    /^[ \t]*(?:(?:export|pub|public|private|protected|internal|abstract|sealed|final|open|data|companion)\s+)*(?:class|struct|interface|enum|trait|impl|module|namespace|object)\s+(\w+)/gm,
  )) {
    if (keep(m[1])) names.push(m[1]!);
  }

  // Function/method declarations with an explicit keyword.
  // Covers: JS/TS (function), Go (func + optional receiver), Rust (fn), Python (def),
  //         Kotlin (fun), Swift (func), Ruby (def), PHP (function), VB/PL (sub/proc).
  // The optional `(?:\([^)]*\)\s+)?` absorbs Go-style method receivers: func (r *T) Name(
  for (const m of content.matchAll(
    /^[ \t]*(?:(?:export|pub|public|private|protected|internal|abstract|sealed|static|final|async|override|virtual|extern|inline|unsafe|open|suspend)\s+)*(?:fn|func|fun|def|function|sub|proc)\s+(?:\([^)]*\)\s+)?(\w+)/gm,
  )) {
    if (keep(m[1])) names.push(m[1]!);
  }

  // Type aliases: TS `type Foo`, Go `type Foo struct|interface`, Rust `type Foo = …`
  for (const m of content.matchAll(/^[ \t]*(?:export\s+)?type\s+(\w+)/gm)) {
    if (keep(m[1])) names.push(m[1]!);
  }

  // Named top-level constants/variables: JS/TS (const/let/var), Go (var), Swift/Kotlin (val)
  for (const m of content.matchAll(/^(?:export\s+)?(?:const|let|var|val|auto)\s+(\w+)/gm)) {
    if (keep(m[1])) names.push(m[1]!);
  }

  // Class/object members at exactly 1 indent (2 spaces OR 1 tab).
  // Catches undecorated TS/JS/Java bare methods that have no function keyword:
  //   e.g. `  generate(…)`, `  isAvailable(): boolean`, `  get token()`
  for (const m of content.matchAll(
    /^(?:  |\t)(?:(?:public|private|protected|static|abstract|override|readonly|async|virtual|final|synchronized|native|open|suspend|inline|extern)\s+)*(?:get |set )?(\w+)\s*[<(]/gm,
  )) {
    if (keep(m[1])) names.push(m[1]!);
  }

  // Java/C#-style methods: modifier(s) + return-type + name + ( — no function keyword.
  //   e.g. `    public String findById(`, `    private void delete(`
  for (const m of content.matchAll(
    /^[ \t]+(?:(?:public|private|protected|static|abstract|override|virtual|final|synchronized|native|async)\s+)+\w+\s+(\w+)\s*\(/gm,
  )) {
    if (keep(m[1])) names.push(m[1]!);
  }

  return [...new Set(names)].slice(0, 25);
}

/**
 * Compact file summary sent to the model.
 * Code files: header comment + all symbol names (no bodies).
 * Markup/config/data files: raw content slice (self-descriptive, no symbols to extract).
 */
export function buildSymbolSummary(relPath: string, content: string): string {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const scan = content.slice(0, 3000);
  const comment = extractHeaderComment(scan);
  const parts: string[] = [];

  if (PROSE_LIKE_EXTS.has(ext)) {
    // Raw slice — headings/selectors/keys ARE the description for these formats.
    if (comment) parts.push(`Comment: ${comment}`);
    parts.push(`Content:\n${content.slice(0, 800)}`);
    return parts.join("\n");
  }

  const symbols = extractSymbolNames(scan);
  if (comment) parts.push(`Comment: ${comment}`);
  if (symbols.length) parts.push(`Symbols: ${symbols.join(", ")}`);
  return parts.join("\n");
}

export function buildPrompt(relPath: string, content: string): string {
  const summary = buildSymbolSummary(relPath, content);
  return (
    `File: ${relPath}\n${summary}\n\n` +
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
