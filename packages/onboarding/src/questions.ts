/**
 * Onboarding question catalog. Each question maps 1:1 to a memory record
 * written on completion. The wizard renders these in order; users can skip
 * any question and revisit later from the memory manager.
 */

import type { MemoryType } from "@spexr/memory";

export interface OnboardingQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly help: string;
  readonly memory: {
    readonly scope: "user" | "project";
    readonly type: MemoryType;
    readonly filename: string;
    readonly name: string;
    readonly description: string;
  };
}

export const DEFAULT_ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    id: "user-role",
    prompt: "What's your role and primary responsibilities on this project?",
    help: "Helps the agent calibrate explanation depth and the kind of help you usually want.",
    memory: {
      scope: "user",
      type: "user",
      filename: "user-role.md",
      name: "User role",
      description: "Role, responsibilities, expertise level — calibrates agent collaboration.",
    },
  },
  {
    id: "project-overview",
    prompt: "In two or three sentences: what does this project do and who uses it?",
    help: "High-level context the agent should ground every suggestion in.",
    memory: {
      scope: "project",
      type: "project",
      filename: "project-overview.md",
      name: "Project overview",
      description: "What this project is, who uses it, why it exists.",
    },
  },
  {
    id: "architecture-doc",
    prompt: "Where does the architecture / system design live? Paste the link or a short summary.",
    help: "Lets the agent route deeper questions to the right doc instead of inventing context.",
    memory: {
      scope: "project",
      type: "reference",
      filename: "architecture-reference.md",
      name: "Architecture reference",
      description: "Pointer to authoritative architecture / system design source.",
    },
  },
  {
    id: "conventions",
    prompt: "Are there coding conventions or patterns you want the agent to follow strictly?",
    help: "Examples: error-handling style, test layering, naming. Keep it concrete.",
    memory: {
      scope: "project",
      type: "feedback",
      filename: "project-conventions.md",
      name: "Project conventions",
      description: "House conventions the agent must follow for code in this repo.",
    },
  },
  {
    id: "glossary",
    prompt: "List 3–10 domain terms that have specific meaning here.",
    help: "Disambiguates words that carry one meaning in this domain and another elsewhere.",
    memory: {
      scope: "project",
      type: "reference",
      filename: "glossary.md",
      name: "Glossary",
      description: "Domain-specific terms and their meaning in this codebase.",
    },
  },
  {
    id: "runbook",
    prompt: "Where do you keep oncall runbooks / incident playbooks?",
    help: "If oncall, the agent will steer toward documented procedures during incidents.",
    memory: {
      scope: "project",
      type: "reference",
      filename: "runbook.md",
      name: "Runbook",
      description: "Pointer to oncall / incident response procedures.",
    },
  },
];
