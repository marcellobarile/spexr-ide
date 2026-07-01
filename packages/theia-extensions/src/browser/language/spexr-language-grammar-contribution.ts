import { injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import * as monaco from "@theia/monaco-editor-core";
import type { LanguageGrammarDefinitionContribution } from "@theia/monaco/lib/browser/textmate/textmate-contribution.js";
import type { TextmateRegistry } from "@theia/monaco/lib/browser/textmate/textmate-registry.js";

interface LangDef {
  readonly id: string;
  readonly extensions: string[];
  readonly aliases: string[];
  readonly scope: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly grammarLoader: () => Promise<any>;
}

// require() avoids ESM interop wrapping — JSON is returned directly as an object.
// Webpack statically analyzes each require("string-literal") and bundles the file.
 
const LANGUAGES: LangDef[] = [
  {
    id: "typescript",
    extensions: [".ts", ".tsx"],
    aliases: ["TypeScript", "ts"],
    scope: "source.ts",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/typescript.json")),
  },
  {
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    aliases: ["JavaScript", "js"],
    scope: "source.js",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/javascript.json")),
  },
  {
    id: "json",
    extensions: [".json", ".jsonc"],
    aliases: ["JSON"],
    scope: "source.json",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/json.json")),
  },
  {
    id: "css",
    extensions: [".css"],
    aliases: ["CSS"],
    scope: "source.css",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/css.json")),
  },
  {
    id: "html",
    extensions: [".html", ".htm"],
    aliases: ["HTML"],
    scope: "text.html.basic",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/html.json")),
  },
  {
    id: "xml",
    extensions: [".xml", ".xsl", ".xslt", ".svg"],
    aliases: ["XML"],
    scope: "text.xml",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/xml.json")),
  },
  {
    id: "c",
    extensions: [".c", ".h"],
    aliases: ["C"],
    scope: "source.c",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/c.json")),
  },
  {
    id: "cpp",
    extensions: [".cpp", ".cc", ".cxx", ".hh", ".hpp", ".hxx"],
    aliases: ["C++", "cpp"],
    scope: "source.cpp",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/cpp.json")),
  },
  {
    id: "java",
    extensions: [".java"],
    aliases: ["Java"],
    scope: "source.java",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/java.json")),
  },
  {
    id: "python",
    extensions: [".py", ".pyw"],
    aliases: ["Python", "py"],
    scope: "source.python",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/python.json")),
  },
  {
    id: "rust",
    extensions: [".rs"],
    aliases: ["Rust"],
    scope: "source.rust",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/rust.json")),
  },
  {
    id: "go",
    extensions: [".go"],
    aliases: ["Go"],
    scope: "source.go",
    grammarLoader: () => Promise.resolve(require("tm-grammars/grammars/go.json")),
  },
];
 

@injectable()
export class SpexrLanguageGrammarContribution
  implements FrontendApplicationContribution, LanguageGrammarDefinitionContribution
{
  initialize(): void {
    for (const lang of LANGUAGES) {
      monaco.languages.register({
        id: lang.id,
        extensions: lang.extensions,
        aliases: lang.aliases,
      });
    }
  }

  registerTextmateLanguage(registry: TextmateRegistry): void {
    for (const lang of LANGUAGES) {
      registry.registerTextmateGrammarScope(lang.scope, {
        getGrammarDefinition: () =>
          lang.grammarLoader().then((content) => ({ format: "json" as const, content })),
      });
      registry.mapLanguageIdToTextmateGrammar(lang.id, lang.scope);
    }
  }
}
