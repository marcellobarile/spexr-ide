import type { Logger } from "@spexr/core";
import type { MemoryScopeManager } from "@spexr/memory";
import { DEFAULT_ONBOARDING_QUESTIONS, type OnboardingQuestion } from "./questions.js";
import { OnboardingWizard, type WizardAnswer } from "./wizard.js";

/**
 * Orchestrator for the onboarding flow. Persists answers as memory records
 * once the wizard completes. Skipped questions are not written — empty
 * memory adds noise to the agent prompt with no signal.
 */
export interface OnboardingService {
  startWizard(questions?: readonly OnboardingQuestion[]): OnboardingWizard;
  finalize(wizard: OnboardingWizard): Promise<readonly { questionId: string; written: boolean }[]>;
}

export interface OnboardingServiceOptions {
  readonly memoryManager: MemoryScopeManager;
  readonly logger?: Logger;
}

export class DefaultOnboardingService implements OnboardingService {
  constructor(private readonly opts: OnboardingServiceOptions) {}

  startWizard(questions?: readonly OnboardingQuestion[]): OnboardingWizard {
    return new OnboardingWizard(questions ?? DEFAULT_ONBOARDING_QUESTIONS);
  }

  async finalize(
    wizard: OnboardingWizard,
  ): Promise<readonly { questionId: string; written: boolean }[]> {
    const answers = wizard.collect();
    const lookup = new Map(DEFAULT_ONBOARDING_QUESTIONS.map((q) => [q.id, q]));
    const results: { questionId: string; written: boolean }[] = [];
    for (const answer of answers) {
      const question = lookup.get(answer.questionId);
      if (!question) continue;
      if (answer.skipped || answer.text.trim().length === 0) {
        results.push({ questionId: answer.questionId, written: false });
        continue;
      }
      await this.persist(question, answer);
      results.push({ questionId: answer.questionId, written: true });
    }
    return results;
  }

  private async persist(question: OnboardingQuestion, answer: WizardAnswer): Promise<void> {
    const now = new Date().toISOString();
    await this.opts.memoryManager.write({
      scope: question.memory.scope,
      filename: question.memory.filename,
      frontmatter: {
        name: question.memory.name,
        description: question.memory.description,
        type: question.memory.type,
        createdAt: now,
        updatedAt: now,
      },
      body: answer.text.trim(),
    });
    this.opts.logger?.info("Onboarding answer persisted", {
      questionId: question.id,
      scope: question.memory.scope,
    });
  }
}
