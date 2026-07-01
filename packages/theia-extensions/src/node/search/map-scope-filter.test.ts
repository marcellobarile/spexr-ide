import { describe, expect, it } from "vitest";
import { isWorthMapping } from "./map-scope-filter.js";

describe("isWorthMapping", () => {
  it("keeps ordinary source files", () => {
    expect(isWorthMapping("src/browser/widget.tsx")).toBe(true);
    expect(isWorthMapping("packages/core/index.ts")).toBe(true);
    expect(isWorthMapping("README.md")).toBe(true);
  });

  it("keeps test sources but skips their fixtures/mocks/snapshots", () => {
    expect(isWorthMapping("src/foo.test.ts")).toBe(true);
    expect(isWorthMapping("test/service.spec.ts")).toBe(true);
    expect(isWorthMapping("src/__fixtures__/sample.json")).toBe(false);
    expect(isWorthMapping("test/fixtures/data.xml")).toBe(false);
    expect(isWorthMapping("src/__mocks__/fs.ts")).toBe(false);
    expect(isWorthMapping("src/__snapshots__/a.snap")).toBe(false);
    expect(isWorthMapping("api/testdata/response.json")).toBe(false);
  });

  it("skips vendored library trees across languages", () => {
    expect(isWorthMapping("node_modules/react/index.js")).toBe(false);
    expect(isWorthMapping("frontend/node_modules/x/y.js")).toBe(false);
    expect(isWorthMapping("vendor/github.com/pkg/a.go")).toBe(false);
    expect(isWorthMapping(".venv/lib/site-packages/x.py")).toBe(false);
    expect(isWorthMapping("target/classes/App.class")).toBe(false);
    expect(isWorthMapping("third_party/lib/a.c")).toBe(false);
  });

  it("skips generated and minified files", () => {
    expect(isWorthMapping("public/app.min.js")).toBe(false);
    expect(isWorthMapping("src/schema.generated.ts")).toBe(false);
    expect(isWorthMapping("proto/user.pb.go")).toBe(false);
    expect(isWorthMapping("gen/user_pb2.py")).toBe(false);
    expect(isWorthMapping("types/api.d.ts")).toBe(false);
  });

  it("matches segments whole, not as substrings", () => {
    expect(isWorthMapping("src/vendored-utils.ts")).toBe(true);
    expect(isWorthMapping("src/mockup-renderer.ts")).toBe(true);
  });
});
