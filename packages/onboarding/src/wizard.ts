/**
 * Wizard state machine. UI-agnostic so the same flow renders in the desktop
 * shell, a CLI, or future surfaces. The shell observes `state()` and drives
 * `next/back/skip/answer` from input.
 */

import type { OnboardingQuestion } from "./questions.js";

export interface WizardAnswer {
  readonly questionId: string;
  readonly text: string;
  readonly skipped: boolean;
}

export interface WizardState {
  readonly index: number;
  readonly total: number;
  readonly current: OnboardingQuestion | undefined;
  readonly answers: ReadonlyMap<string, WizardAnswer>;
  readonly isComplete: boolean;
}

export class OnboardingWizard {
  private readonly answers = new Map<string, WizardAnswer>();
  private cursor = 0;

  constructor(private readonly questions: readonly OnboardingQuestion[]) {
    if (questions.length === 0) {
      throw new Error("OnboardingWizard requires at least one question");
    }
  }

  state(): WizardState {
    return {
      index: this.cursor,
      total: this.questions.length,
      current: this.questions[this.cursor],
      answers: new Map(this.answers),
      isComplete: this.cursor >= this.questions.length,
    };
  }

  answer(text: string): void {
    const q = this.questions[this.cursor];
    if (!q) return;
    this.answers.set(q.id, { questionId: q.id, text, skipped: false });
    this.cursor += 1;
  }

  skip(): void {
    const q = this.questions[this.cursor];
    if (!q) return;
    this.answers.set(q.id, { questionId: q.id, text: "", skipped: true });
    this.cursor += 1;
  }

  back(): void {
    if (this.cursor > 0) this.cursor -= 1;
  }

  reset(): void {
    this.answers.clear();
    this.cursor = 0;
  }

  collect(): readonly WizardAnswer[] {
    return [...this.answers.values()];
  }
}
