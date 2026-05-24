import matter from "gray-matter";
import { MemoryError } from "@spexr/core";
import type { MemoryFrontmatter, MemoryType } from "./types.js";

const VALID_TYPES: ReadonlySet<string> = new Set<MemoryType>([
  "user",
  "feedback",
  "project",
  "reference",
]);

function isMemoryType(value: string): value is MemoryType {
  return VALID_TYPES.has(value);
}

export interface ParsedMemoryFile {
  readonly frontmatter: MemoryFrontmatter;
  readonly body: string;
}

export function parseMemoryMarkdown(raw: string): ParsedMemoryFile {
  const parsed = matter(raw);
  const fm = parsed.data;
  assertString(fm.name, "name");
  assertString(fm.description, "description");
  assertString(fm.type, "type");
  if (!isMemoryType(fm.type)) {
    throw new MemoryError(`Invalid memory type "${fm.type}"`);
  }
  const tags = normalizeTags(fm.tags);
  return {
    frontmatter: {
      name: fm.name,
      description: fm.description,
      type: fm.type,
      ...(tags ? { tags } : {}),
      ...(typeof fm.createdAt === "string" ? { createdAt: fm.createdAt } : {}),
      ...(typeof fm.updatedAt === "string" ? { updatedAt: fm.updatedAt } : {}),
    },
    body: parsed.content.trim(),
  };
}

export function serializeMemoryMarkdown(fm: MemoryFrontmatter, body: string): string {
  return matter.stringify(`\n${body.trim()}\n`, fm as unknown as Record<string, unknown>);
}

function assertString(v: unknown, field: string): asserts v is string {
  if (typeof v !== "string" || v.length === 0) {
    throw new MemoryError(`Memory frontmatter field "${field}" must be a non-empty string`);
  }
}

function normalizeTags(tags: unknown): readonly string[] | undefined {
  if (tags === undefined || tags === null) return undefined;
  if (!Array.isArray(tags)) {
    throw new MemoryError(`Memory frontmatter field "tags" must be an array`);
  }
  return tags.map((t) => {
    if (typeof t !== "string") {
      throw new MemoryError(`Memory tag must be a string, got ${typeof t}`);
    }
    return t;
  });
}
