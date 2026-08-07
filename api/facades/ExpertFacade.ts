import { expect, test } from '@playwright/test';

import type { ApiClient } from '../http/ApiClient';
import { AdminAuthApi } from '../services/AdminAuthApi';
import { AdminExpertApi } from '../services/AdminExpertApi';
import { ExpertGenerationApi } from '../services/ExpertGenerationApi';
import {
  GENERATED_STATE_PUBLISHING,
  GENERATED_STATE_READY_TO_PUBLISH,
  TherapistStatus,
  type AdminTherapistDetailDto,
  type AdminTherapistListItemDto,
  type AdminTherapistUpdateDto,
  type GeneratedExpertDto,
  type GenerateExpertsRequestDto
} from '../dto/expert.dto';
import { GenerationLock } from '../support/generation-lock';
import { rnd } from '../support/crypto';
import { credentials } from '../../config/credentials';

/**
 * Every generated expert gets this name prefix, so a person looking at the
 * stage always knows where the profile came from, and leftovers of a crashed
 * run are easy to find and remove by hand.
 */
export const EXPERT_NAME_PREFIX = 'AQA';

export type PublishedExpert = {
  uuid: string;
  profile: AdminTherapistDetailDto;
};

/** One expert is generated in about a minute; leave room for slow days. */
const GENERATION_TIMEOUT_MS = 240_000;
/** How long the published expert may take to appear in the admin list. */
const PUBLISH_TIMEOUT_MS = 60_000;
/** Publishing is a background job: the profile is born NEW and only turns
 * ACTIVE when the job is done, which under load takes a while. */
const PUBLISH_ACTIVATION_TIMEOUT_MS = 120_000;
/** The public catalog rebuild can race the write it should pick up. */
const CATALOG_TIMEOUT_MS = 60_000;
/**
 * A sibling expert test may hold the lock through its whole
 * generate-and-publish cycle, so the wait covers one full cycle and still
 * fails inside the test budget with this message instead of an opaque
 * test timeout.
 */
const LOCK_TIMEOUT_MS = 300_000;

/**
 * The administrator side of the expert lifecycle: generate a draft, publish
 * it, edit and delete the published profile.
 *
 * Checks that prove the mechanics (a token was issued, the draft appeared)
 * live here; checks that belong to a scenario stay in the test.
 *
 * Every expect.poll callback here is written not to throw: a thrown error
 * aborts the poll on the spot instead of retrying, so transient transport
 * errors are converted into "keep polling" answers.
 */
export class ExpertFacade {
  private readonly lock = new GenerationLock();
  private adminApi?: AdminExpertApi;
  private generationApi?: ExpertGenerationApi;
  /** Draft ids seen before our generation started — see generateDraft. */
  private idsBeforeGeneration?: Set<string>;

  constructor(private readonly client: ApiClient) {}

  /**
   * Signs the administrator in once per test. The token endpoint does not
   * take an e-mail, so the e-mail is exchanged for the uuid first.
   */
  private async signedIn(): Promise<{ admin: AdminExpertApi; generation: ExpertGenerationApi }> {
    if (!this.adminApi || !this.generationApi) {
      await test.step('administrator sign-in', async () => {
        const auth = new AdminAuthApi(this.client);

        const who = await auth.uuidByEmail(credentials.admin.email);
        expect(who.status, 'administrator lookup should answer 200').toBe(200);
        expect(who.body?.uuid, 'administrator lookup must return a uuid').toBeTruthy();

        const token = await auth.token(who.body!.uuid, credentials.admin.password);
        expect(token.status, 'password grant should answer 200').toBe(200);
        // Same trap as the user login: only the token itself proves the
        // sign-in, a 200 alone does not.
        expect(token.body?.access_token, 'sign-in must issue an access token').toBeTruthy();

        const bound = this.client.withToken(token.body!.access_token);
        this.adminApi = new AdminExpertApi(bound);
        this.generationApi = new ExpertGenerationApi(bound);
      });
    }
    return { admin: this.adminApi!, generation: this.generationApi! };
  }

  /**
   * Generates exactly one expert and renames it to a unique prefixed name.
   *
   * Holds the generation lock afterwards: the generation service keeps one
   * shared draft list for everyone, and the lock is only given back when the
   * draft leaves that list — through publishDraft, discardDraft or the
   * factory clean-up.
   */
  async generateDraft(holder: string): Promise<GeneratedExpertDto> {
    return test.step('generate one expert', async () => {
      const { admin, generation } = await this.signedIn();
      await this.lock.acquire(holder, LOCK_TIMEOUT_MS);

      // Someone may be generating outside our lock (a human in the admin
      // panel). Wait the batch out instead of failing. A transport error
      // reads as "still busy" so the poll keeps trying.
      await expect
        .poll(
          async () => {
            try {
              return (await generation.state(true)).body?.state ?? 'in_process';
            } catch {
              return 'in_process';
            }
          },
          {
            message: 'the generation service must not be busy with another batch',
            timeout: GENERATION_TIMEOUT_MS
          }
        )
        .not.toBe('in_process');

      const before = await generation.list();
      expect(before.status, 'draft list should answer 200').toBe(200);
      this.idsBeforeGeneration = new Set((before.body?.results ?? []).map((draft) => String(draft.id)));

      const reference = await admin.dataForGenerate('PB');
      expect(reference.status, 'generation reference data should answer 200').toBe(200);
      expect(reference.body, 'generation reference data must not be empty').toBeTruthy();

      const started = await generation.generate(this.buildGenerationRequest(reference.body!));
      expect(started.status, 'generation start should answer 201').toBe(201);

      // The service gives no job id back; the new draft is found by
      // comparing the list with the snapshot taken above. Drafts that are
      // being published right now (state 7) and drafts already carrying the
      // test prefix are another run's work in transit, not candidates.
      let fresh: GeneratedExpertDto[] = [];
      await expect
        .poll(
          async () => {
            try {
              const page = await generation.list(true);
              if (page.status !== 200) {
                return false;
              }
              fresh = (page.body?.results ?? []).filter(
                (candidate) =>
                  !this.idsBeforeGeneration!.has(String(candidate.id)) &&
                  candidate.state !== GENERATED_STATE_PUBLISHING &&
                  !candidate.first_name.startsWith(`${EXPERT_NAME_PREFIX}-`)
              );
              return fresh.some((candidate) => candidate.state === GENERATED_STATE_READY_TO_PUBLISH);
            } catch {
              return false;
            }
          },
          {
            message: 'the generated expert must appear in the draft list with state 2 (avatar included)',
            timeout: GENERATION_TIMEOUT_MS
          }
        )
        .toBe(true);

      // One was requested. Seeing more means someone generated in parallel
      // and the drafts cannot be told apart — publishing a guess could take
      // a stranger's expert live, so stop instead.
      expect(
        fresh,
        'exactly one new draft must appear; more means a parallel generation ran and the drafts are indistinguishable'
      ).toHaveLength(1);

      return this.renameDraft(fresh[0]);
    });
  }

  /** Gives the draft a unique searchable name: "AQA-1a2b3c4d <LastName>". */
  private async renameDraft(draft: GeneratedExpertDto): Promise<GeneratedExpertDto> {
    const { generation } = await this.signedIn();
    // Eight hex characters: deletion on this stage is soft and the search
    // corpus only ever grows, so short names would collide sooner or later.
    const firstName = `${EXPERT_NAME_PREFIX}-${rnd(8)}`;

    // The service wants all seven fields on every edit.
    const updated = await generation.update(draft.id, {
      first_name: firstName,
      last_name: draft.last_name,
      description: draft.description,
      greeting_message: draft.greeting_message,
      topics: draft.topics,
      category: draft.category,
      additional_categories: draft.additional_categories
    });
    expect(updated.status, 'draft rename should answer 200').toBe(200);
    expect(updated.body?.first_name, 'rename echo carries the new name').toBe(firstName);

    return { ...draft, ...updated.body };
  }

  /**
   * Publishes the draft and waits until it exists as a live ACTIVE expert.
   *
   * Publishing is a background job: right after the call the draft briefly
   * leaves the shared list, COMES BACK with state 7 while the job runs, and
   * only leaves for good when the profile — born with status NEW — turns
   * ACTIVE. The generation lock is therefore held until that terminal
   * state; releasing it on the first disappearance would let a parallel
   * test mistake the returning draft for a stranger's generation.
   */
  async publishDraft(draft: GeneratedExpertDto): Promise<PublishedExpert> {
    return test.step(`publish expert ${draft.first_name}`, async () => {
      const { admin, generation } = await this.signedIn();

      const published = await generation.publish([draft.id]);
      expect(published.status, 'publish should answer 200').toBe(200);

      // The live profile appears a moment later. The admin search matches
      // substrings, so the row is pinned by the exact unique name.
      let match: AdminTherapistListItemDto | undefined;
      await expect
        .poll(
          async () => {
            try {
              const found = await admin.search(draft.first_name, true);
              match = (found.body?.content ?? []).find((row) => row.firstName === draft.first_name);
              return match !== undefined;
            } catch {
              return false;
            }
          },
          {
            message: 'the published expert must appear in the admin expert list',
            timeout: PUBLISH_TIMEOUT_MS
          }
        )
        .toBe(true);

      // NEW means the publish job is still working; ACTIVE means it is done.
      await expect
        .poll(
          async () => {
            try {
              return (await admin.getTherapist(match!.uuid)).body?.status;
            } catch {
              return undefined;
            }
          },
          {
            message: 'the publish job must finish and make the expert ACTIVE',
            timeout: PUBLISH_ACTIVATION_TIMEOUT_MS
          }
        )
        .toBe(TherapistStatus.ACTIVE);

      // Terminal state of the shared list: the draft is gone for good.
      // "Still in the list" is the answer on any doubtful read, so a
      // transport error can not pass for a successful departure.
      await expect
        .poll(
          async () => {
            try {
              const page = await generation.list(true);
              if (page.status !== 200) {
                return true;
              }
              return (page.body?.results ?? []).some((row) => String(row.id) === String(draft.id));
            } catch {
              return true;
            }
          },
          { message: 'the published draft must leave the draft list', timeout: PUBLISH_TIMEOUT_MS }
        )
        .toBe(false);
      this.lock.release();

      const profile = await admin.getTherapist(match!.uuid);
      expect(profile.status, 'reading the published profile should answer 200').toBe(200);

      return { uuid: match!.uuid, profile: profile.body! };
    });
  }

  /** Deletes a draft that will not be published, and frees the lock. */
  async discardDraft(draft: GeneratedExpertDto): Promise<void> {
    await test.step(`discard draft ${draft.first_name}`, async () => {
      const { generation } = await this.signedIn();
      const removed = await generation.remove(draft.id);
      expect(removed.status, 'draft delete should answer 204').toBe(204);
      this.lock.release();
    });
  }

  /** Admin text search over live experts. */
  async findPublished(text: string): Promise<AdminTherapistListItemDto[]> {
    const { admin } = await this.signedIn();
    const found = await admin.search(text);
    expect(found.status, 'expert search should answer 200').toBe(200);
    return found.body?.content ?? [];
  }

  /** The full profile of a live expert. */
  async getPublished(uuid: string): Promise<AdminTherapistDetailDto> {
    const { admin } = await this.signedIn();
    const profile = await admin.getTherapist(uuid);
    expect(profile.status, 'reading the expert profile should answer 200').toBe(200);
    return profile.body!;
  }

  /**
   * Edits a live expert and returns the freshly re-read profile. The PATCH
   * answers 200 with an empty body, so re-reading is the only proof.
   */
  async updatePublished(uuid: string, changes: Partial<AdminTherapistUpdateDto>): Promise<AdminTherapistDetailDto> {
    return test.step('edit the published expert', async () => {
      const { admin } = await this.signedIn();
      const current = await this.getPublished(uuid);

      const body: AdminTherapistUpdateDto = {
        about: current.about,
        email: current.email,
        expectedPricePerMin: current.expectedPricePerMin,
        firstName: current.firstName,
        lastName: current.lastName,
        phoneNumber: current.phoneNumber,
        pricePerMin: current.pricePerMin,
        rateBoost: current.rateBoost,
        individual: current.individual,
        ...changes
      };
      const updated = await admin.updateTherapist(uuid, body);
      expect(updated.status, 'expert edit should answer 200').toBe(200);

      return this.getPublished(uuid);
    });
  }

  /** Soft-deletes a live expert. The caller verifies the outcome. */
  async deletePublished(uuid: string, cause = 'autotest cleanup'): Promise<void> {
    const { admin } = await this.signedIn();
    const deleted = await admin.deleteTherapists([uuid], cause);
    expect(deleted.status, 'expert delete should answer 200').toBe(200);
  }

  /**
   * Waits until the public (user-facing) catalog lists the expert. The
   * catalog is a cache over the search tables: a fresh expert first needs
   * its row copied there (sync), then the cache rebuilt (refresh), and
   * either step can race the data it reads — hence sync-refresh-check
   * until the expert shows up.
   *
   * There is no counterpart for removal: nothing callable (refresh, sync
   * by uuid, sync all) pushes a DELETED expert out of the catalog — only a
   * background prune on its own schedule does, minutes later. Tests
   * therefore must not assert the disappearance.
   */
  async waitUntilPubliclyListed(uuid: string): Promise<void> {
    await test.step('wait until the public catalog lists the expert', async () => {
      const { admin } = await this.signedIn();
      await expect
        .poll(
          async () => {
            try {
              await admin.syncExpertDetail([uuid], true);
              const refreshed = await admin.refreshPublicCatalog(true);
              if (refreshed.status !== 200) {
                return undefined;
              }
              const catalog = await admin.publicCatalog(true);
              if (catalog.status !== 200) {
                return undefined;
              }
              return (catalog.body ?? []).some((card) => card.uuid === uuid);
            } catch {
              return undefined;
            }
          },
          {
            message: 'the public catalog must list the expert after a refresh',
            // Sync and rebuild are heavier than a plain read — no hammering.
            intervals: [1_000, 3_000, 5_000],
            timeout: CATALOG_TIMEOUT_MS
          }
        )
        .toBe(true);
    });
  }

  /**
   * Waits until the public catalog stops listing the expert.
   *
   * Today this FAILS by design: deleting an expert does not invalidate
   * the catalog cache, and no admin call (refresh, sync by uuid, sync of
   * everything) removes the entry — only a background prune does, minutes
   * later. Until then users still see the deleted profile and can start a
   * chat with it. The red test documents that product bug; it turns green
   * the day deletion starts reaching the catalog.
   */
  async waitUntilPubliclyDropped(uuid: string): Promise<void> {
    await test.step('wait until the public catalog drops the expert', async () => {
      const { admin } = await this.signedIn();
      await expect
        .poll(
          async () => {
            try {
              const refreshed = await admin.refreshPublicCatalog(true);
              if (refreshed.status !== 200) {
                return undefined;
              }
              const catalog = await admin.publicCatalog(true);
              if (catalog.status !== 200) {
                return undefined;
              }
              return (catalog.body ?? []).some((card) => card.uuid === uuid);
            } catch {
              return undefined;
            }
          },
          {
            message:
              'Product bug: deleting an expert does not invalidate the public catalog cache. ' +
              'The deleted expert stays visible to users — they can open the profile and start ' +
              'a chat with it — until a background prune runs minutes later.',
            intervals: [1_000, 3_000, 5_000],
            timeout: CATALOG_TIMEOUT_MS / 2
          }
        )
        .toBe(false);
    });
  }

  /**
   * Clean-up path for drafts: never throws, always frees the lock.
   *
   * When the test died between the generation start and the draft
   * detection, no draft object exists yet — then the pre-generation
   * snapshot finds the orphan. A single new draft is provably ours (the
   * lock was held); seeing several means a parallel generation, and
   * guessing could delete a stranger's work, so they are only reported.
   */
  async discardDraftQuietly(draft?: GeneratedExpertDto): Promise<string | undefined> {
    try {
      if (draft) {
        const { generation } = await this.signedIn();
        const removed = await generation.remove(draft.id);
        return removed.status === 204 ? 'draft deleted' : `draft already gone (HTTP ${removed.status})`;
      }
      return await this.discardUntrackedDraft();
    } catch (error) {
      return `draft cleanup failed (${error instanceof Error ? error.message : String(error)})`;
    } finally {
      this.idsBeforeGeneration = undefined;
      this.lock.release();
    }
  }

  private async discardUntrackedDraft(): Promise<string | undefined> {
    if (!this.idsBeforeGeneration) {
      return undefined;
    }
    const { generation } = await this.signedIn();
    const page = await generation.list();
    if (page.status !== 200) {
      return `orphan draft check failed (HTTP ${page.status})`;
    }
    // A state-7 draft is another run's publish in transit — never ours to
    // delete (our own publishes are hunted down by name, see the factory).
    const fresh = (page.body?.results ?? []).filter(
      (row) => !this.idsBeforeGeneration!.has(String(row.id)) && row.state !== GENERATED_STATE_PUBLISHING
    );
    if (fresh.length === 0) {
      return undefined;
    }
    if (fresh.length > 1) {
      return `left ${fresh.length} drafts behind: a parallel generation ran and they cannot be told apart`;
    }
    const removed = await generation.remove(fresh[0].id);
    return removed.status === 204
      ? `orphan draft ${fresh[0].id} deleted`
      : `orphan draft ${fresh[0].id} not deleted (HTTP ${removed.status})`;
  }

  /** Clean-up path for published experts: never throws. */
  async deletePublishedQuietly(uuid: string): Promise<string> {
    try {
      const { admin } = await this.signedIn();
      const current = await admin.getTherapist(uuid);
      if (current.body?.status === TherapistStatus.DELETED) {
        return `${uuid}: already deleted`;
      }
      const deleted = await admin.deleteTherapists([uuid], 'autotest cleanup');
      if (deleted.status !== 200) {
        return `${uuid}: failed (HTTP ${deleted.status})`;
      }
      // Push the deletion into the public catalog as well.
      await admin.refreshPublicCatalog();
      return `${uuid}: deleted`;
    } catch (error) {
      return `${uuid}: failed (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  /**
   * Clean-up for an expert that may have gone live although publishDraft
   * never returned its uuid (the confirmation steps failed mid-way). The
   * unique generated name pins both sides: the draft still sitting on the
   * generation service (deleting it stops the background publish job from
   * re-creating the profile after this sweep) and the live profile rows.
   * Never throws.
   */
  async deletePublishedByNameQuietly(firstName: string): Promise<string | undefined> {
    try {
      const { admin, generation } = await this.signedIn();
      const outcomes: string[] = [];

      const page = await generation.list(true);
      for (const row of page.body?.results ?? []) {
        if (row.first_name === firstName) {
          const removed = await generation.remove(row.id);
          outcomes.push(`draft ${row.id} ${removed.status === 204 ? 'deleted' : `not deleted (HTTP ${removed.status})`}`);
        }
      }

      const found = await admin.search(firstName, true);
      const alive = (found.body?.content ?? []).filter(
        (row) => row.firstName === firstName && row.status !== TherapistStatus.DELETED
      );
      if (alive.length > 0) {
        const deleted = await admin.deleteTherapists(
          alive.map((row) => row.uuid),
          'autotest cleanup'
        );
        if (deleted.status !== 200) {
          outcomes.push(`profile not deleted (HTTP ${deleted.status})`);
        } else {
          await admin.refreshPublicCatalog();
          outcomes.push('profile deleted');
        }
      }

      return outcomes.length > 0 ? `${firstName}: publish leftover — ${outcomes.join(', ')}` : undefined;
    } catch (error) {
      return `${firstName}: publish leftover cleanup failed (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  /** One-expert generation request assembled from the brand reference data. */
  private buildGenerationRequest(reference: {
    genders: Record<string, string>;
    mainSpecializations: Record<string, string>;
    additionalSpecializations: Record<string, string>;
    topics: Record<string, string>;
    languages: Record<string, string>;
  }): GenerateExpertsRequestDto {
    const toFields = (map: Record<string, string>) =>
      Object.entries(map).map(([key, name]) => ({ psychicbook_id: key, name }));

    const english =
      toFields(reference.languages).find((language) => language.name === 'English') ??
      toFields(reference.languages)[0];

    return {
      brand: 'PB',
      number_of_experts: 1,
      gender: toFields(reference.genders).slice(0, 1),
      ethnicity: 'white',
      category: toFields(reference.mainSpecializations).slice(0, 1),
      // The admin panel always sends the complete brand lists for these two.
      additional_categories: toFields(reference.additionalSpecializations),
      topics: toFields(reference.topics),
      language: english,
      photo_style: 'Regular Amateur'
    };
  }
}
