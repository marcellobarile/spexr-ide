import { describe, expect, it } from "vitest";
import { buildBatchPrompt, buildSymbolSummary, cleanGenerated, parseBatchOutput } from "./description-format.js";

describe("cleanGenerated", () => {
  it("keeps one line and caps at 120 chars", () => {
    expect(cleanGenerated("Handles auth.\nExtra.")).toBe("Handles auth.");
    expect(cleanGenerated("x".repeat(200))).toHaveLength(120);
  });
  it("trims surrounding whitespace and quotes", () => {
    expect(cleanGenerated('  "Does X."  ')).toBe("Does X.");
  });
  it("truncates over-long text on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(40).trim();
    const out = cleanGenerated(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("buildSymbolSummary", () => {
  describe("code files", () => {
    it("extracts exported top-level names (JS/TS)", () => {
      const s = buildSymbolSummary("src/a.ts", "export const TOKEN = 'x';\nexport function foo() {}");
      expect(s).toContain("TOKEN");
      expect(s).toContain("foo");
    });

    it("extracts non-exported class and methods (TS bare methods)", () => {
      const s = buildSymbolSummary("src/b.ts", "class AuthService {\n  login() {}\n  private helper() {}\n}");
      expect(s).toContain("AuthService");
      expect(s).toContain("login");
      expect(s).toContain("helper");
    });

    it("extracts Python def declarations", () => {
      const s = buildSymbolSummary("auth.py", "class Manager:\n    def login(self):\n        pass\n    def logout(self):\n        pass");
      expect(s).toContain("Manager");
      expect(s).toContain("login");
      expect(s).toContain("logout");
    });

    it("extracts Go func and type declarations", () => {
      const s = buildSymbolSummary("service.go", "type UserService struct{}\nfunc (s *UserService) FindById(id int) {}\nfunc NewService() *UserService {}");
      expect(s).toContain("UserService");
      expect(s).toContain("FindById");
      expect(s).toContain("NewService");
    });

    it("extracts Rust fn and struct", () => {
      const s = buildSymbolSummary("lib.rs", "pub struct AuthManager;\nimpl AuthManager {\n    pub fn login(&self) {}\n    fn internal(&self) {}\n}");
      expect(s).toContain("AuthManager");
      expect(s).toContain("login");
      expect(s).toContain("internal");
    });

    it("extracts Java-style methods with modifiers and return type", () => {
      const s = buildSymbolSummary("Service.java", "public class UserService {\n    public String findById(Long id) {}\n    private void delete(Long id) {}\n}");
      expect(s).toContain("UserService");
      expect(s).toContain("findById");
      expect(s).toContain("delete");
    });

    it("includes file header comment", () => {
      const s = buildSymbolSummary("src/b.ts", "// Handles auth flows.\nexport class AuthService {}");
      expect(s).toContain("Handles auth flows");
      expect(s).toContain("AuthService");
    });

    it("skips noise comments (license/eslint)", () => {
      const s = buildSymbolSummary("src/c.ts", "// eslint-disable\nexport function go() {}");
      expect(s).not.toContain("eslint");
      expect(s).toContain("go");
    });

    it("returns empty string when no symbols and no comment", () => {
      expect(buildSymbolSummary("src/d.ts", "const x = 1;")).toBe("");
    });
  });

  describe("prose/config files fall back to raw content", () => {
    it("sends raw content for markdown", () => {
      const s = buildSymbolSummary("README.md", "# My Project\n\nHandles authentication.");
      expect(s).toContain("Content:");
      expect(s).toContain("# My Project");
    });

    it("sends raw content for YAML", () => {
      const s = buildSymbolSummary("config.yml", "name: my-service\nversion: 1.0");
      expect(s).toContain("Content:");
      expect(s).toContain("name: my-service");
    });

    it("sends raw content for CSS", () => {
      const s = buildSymbolSummary("styles.css", ".btn { color: red; }");
      expect(s).toContain("Content:");
    });
  });
});

describe("buildBatchPrompt", () => {
  it("lists each file path with its extracted names and a format example", () => {
    const p = buildBatchPrompt([
      { relPath: "src/a.ts", content: "export const x = 1;" },
      { relPath: "src/b.ts", content: "export function foo() {}" },
    ]);
    expect(p).toContain("src/a.ts");
    expect(p).toContain("src/b.ts");
    expect(p).toContain("foo");
    expect(p).toContain("<path>: <sentence>");
  });
});

describe("parseBatchOutput", () => {
  const paths = ["src/auth.ts", "src/list.tsx"];

  it("maps each path-keyed line to its requested path, in input order", () => {
    const out = parseBatchOutput("src/auth.ts: Handles auth.\nsrc/list.tsx: Renders the list.", paths);
    expect(out).toEqual(["Handles auth.", "Renders the list."]);
  });

  it("matches regardless of output order (no positional misattribution)", () => {
    const out = parseBatchOutput("src/list.tsx: Renders the list.\nsrc/auth.ts: Handles auth.", paths);
    expect(out).toEqual(["Handles auth.", "Renders the list."]);
  });

  it("strips leading bullets/backticks before the path", () => {
    const out = parseBatchOutput("- src/auth.ts: Handles auth.\n* src/list.tsx: Renders list.", paths);
    expect(out).toEqual(["Handles auth.", "Renders list."]);
  });

  it("ignores lines for unrequested paths (e.g. the prompt example) and yields null for missing", () => {
    const out = parseBatchOutput("src/db/pool.ts: Example bleed.\nsrc/auth.ts: Handles auth.", paths);
    expect(out).toEqual(["Handles auth.", null]);
  });

  it("cleans and caps each parsed sentence", () => {
    const out = parseBatchOutput(`src/auth.ts: "Quoted desc."`, ["src/auth.ts"]);
    expect(out).toEqual(["Quoted desc."]);
  });
});
