import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_PATH = join(tmpdir(), 'psychicbook-expert-generation');
/**
 * A lock older than this is considered abandoned (a crashed run). The
 * longest honest hold is about five minutes (generation plus the publish
 * waits), so eight minutes means a crash blocks the next run only briefly.
 */
const LOCK_MAX_AGE_MS = 8 * 60_000;
const WAIT_STEP_MS = 1_000;

/**
 * The generation service holds ONE shared batch for everyone: its state and
 * its draft list are not scoped to the caller. Two tests generating at the
 * same time would see each other's drafts and publish each other's experts.
 *
 * This lock makes the whole generate -> publish/delete window exclusive.
 * Same mechanics as the agent pool: an atomically created directory in the
 * OS temp folder, so it works across workers and terminals — but only on
 * ONE machine. Runs started on different machines are not protected;
 * ExpertFacade additionally refuses to continue when it cannot tell its own
 * draft apart from a stranger's.
 */
export class GenerationLock {
  private held = false;

  async acquire(holder: string, timeoutMs = 600_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      this.dropIfExpired();
      try {
        mkdirSync(LOCK_PATH);
        writeFileSync(join(LOCK_PATH, 'holder.txt'), `${holder}\n${Date.now()}`);
        this.held = true;
        return;
      } catch {
        // Someone else is generating right now.
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Expert generation is busy for ${timeoutMs}ms. ` +
            'Another test (or another run) holds the generation service.'
        );
      }
      // Not a pause in a test: this waits until the other test finishes its
      // generation window, and it stops as soon as that happens.
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
  }

  release(): void {
    if (!this.held) {
      return;
    }
    rmSync(LOCK_PATH, { recursive: true, force: true });
    this.held = false;
  }

  private dropIfExpired(): void {
    if (!existsSync(LOCK_PATH)) {
      return;
    }
    try {
      const takenAt = Number(readFileSync(join(LOCK_PATH, 'holder.txt'), 'utf8').split('\n')[1] ?? 0);
      if (Date.now() - takenAt > LOCK_MAX_AGE_MS) {
        rmSync(LOCK_PATH, { recursive: true, force: true });
      }
    } catch {
      // The lock is being created or removed right now — try again later.
    }
  }
}
