import { describe, it, expect } from "vitest";
import { buildShipCommitMessage, buildShipPrBody, SPEC_TRAILER_PREFIX } from "./ship.js";

const SLUG = "0007-ship-to-pr";
const TITLE = "Ship step — branch, commit trailer, open PR";

describe("buildShipCommitMessage", () => {
  it("ends with the correct trailer", () => {
    const msg = buildShipCommitMessage(TITLE, SLUG);
    expect(msg.endsWith(`${SPEC_TRAILER_PREFIX}${SLUG}`)).toBe(true);
  });

  it("uses spec title as subject line", () => {
    const msg = buildShipCommitMessage(TITLE, SLUG);
    expect(msg.startsWith(TITLE)).toBe(true);
  });

  it("separates subject and trailer with blank line", () => {
    const msg = buildShipCommitMessage(TITLE, SLUG);
    expect(msg).toContain(`${TITLE}\n\n${SPEC_TRAILER_PREFIX}${SLUG}`);
  });
});

describe("buildShipPrBody", () => {
  it("references the spec slug", () => {
    const body = buildShipPrBody(SLUG, []);
    expect(body).toContain(SLUG);
  });

  it("includes AC items when present", () => {
    const body = buildShipPrBody(SLUG, ["AC-1 Staged changes committed.", "AC-2 PR opened."]);
    expect(body).toContain("AC-1 Staged changes committed.");
    expect(body).toContain("AC-2 PR opened.");
    expect(body).toContain("## Acceptance Criteria");
  });

  it("omits AC section when no items", () => {
    const body = buildShipPrBody(SLUG, []);
    expect(body).not.toContain("## Acceptance Criteria");
  });

  it("ends with the spec trailer", () => {
    const body = buildShipPrBody(SLUG, []);
    expect(body.endsWith(`${SPEC_TRAILER_PREFIX}${SLUG}`)).toBe(true);
  });
});
