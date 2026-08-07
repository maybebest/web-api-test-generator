import type { GeneratedExpertDto } from '../dto/expert.dto';
import type { ExpertFacade, PublishedExpert } from '../facades/ExpertFacade';

/**
 * Creates experts for a test and remembers them, so the test does not have
 * to clean up by hand. Clean-up never fails a test; every outcome is written
 * into the report instead.
 *
 * A test holds at most one unpublished draft at a time — the generation
 * service is a shared single-batch resource (see GenerationLock).
 */
export class ExpertFactory {
  private draft?: GeneratedExpertDto;
  /**
   * Name of a draft whose publish was started but never confirmed. Publish
   * can succeed on the server while the confirmation steps still fail, so
   * the name is remembered BEFORE the risky window and clean-up hunts the
   * possibly-live expert down by it.
   */
  private pendingPublishName?: string;
  private readonly published: PublishedExpert[] = [];

  constructor(
    private readonly facade: ExpertFacade,
    private readonly holder: string
  ) {}

  /** Generates one draft. It is deleted at the end unless published. */
  async generateDraft(): Promise<GeneratedExpertDto> {
    this.draft = await this.facade.generateDraft(this.holder);
    return this.draft;
  }

  /** Publishes the draft; from now on clean-up deletes the live expert. */
  async publish(draft: GeneratedExpertDto): Promise<PublishedExpert> {
    this.pendingPublishName = draft.first_name;
    const expert = await this.facade.publishDraft(draft);
    this.pendingPublishName = undefined;
    this.draft = undefined;
    this.published.push(expert);
    return expert;
  }

  /** Generate + publish in one go: a live expert ready for a scenario. */
  async createPublished(): Promise<PublishedExpert> {
    return this.publish(await this.generateDraft());
  }

  /** Deletes everything created in this test. Returns one line per expert. */
  async cleanUp(): Promise<string[]> {
    const lines: string[] = [];

    const draftOutcome = await this.facade.discardDraftQuietly(this.draft);
    this.draft = undefined;
    if (draftOutcome) {
      lines.push(draftOutcome);
    }

    if (this.pendingPublishName) {
      const orphanOutcome = await this.facade.deletePublishedByNameQuietly(this.pendingPublishName);
      this.pendingPublishName = undefined;
      if (orphanOutcome) {
        lines.push(orphanOutcome);
      }
    }

    for (const expert of this.published) {
      lines.push(await this.facade.deletePublishedQuietly(expert.uuid));
    }
    return lines;
  }
}
