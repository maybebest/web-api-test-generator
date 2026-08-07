import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { credentials } from '../../config/credentials';

const LOCKS_DIR = join(tmpdir(), 'psychicbook-agent-pool');
/** A lock older than this is considered abandoned (a crashed run). */
const LOCK_MAX_AGE_MS = 15 * 60_000;
const WAIT_STEP_MS = 500;

/**
 * Hands out agent logins so that two tests never use the same agent at the
 * same time.
 *
 * How it works: taking an agent means creating a directory named after that
 * login. Directory creation is atomic on every OS, so two workers can never
 * both think they took the same agent. Releasing means removing the
 * directory. Locks left behind by a crashed run expire after 15 minutes.
 *
 * The pool works across Playwright workers and even across two runs started
 * from different terminals, because the locks live in the OS temp folder.
 */
export class AgentPool {
  constructor(private readonly logins: string[] = credentials.agentPool.logins) {
    if (this.logins.length === 0) {
      throw new Error('Agent pool is empty. Set AGENT_POOL_LOGINS (see docs/environment-variables.md).');
    }
    mkdirSync(LOCKS_DIR, { recursive: true });
  }

  /**
   * Takes a free agent. If every agent is busy, waits until one is released
   * (or until `timeoutMs`, then fails with a clear message).
   *
   * The wait is long on purpose: a booking test can run for several
   * minutes, and a test that waits for its turn should not fail because of
   * that.
   */
  async acquire(holder: string, timeoutMs = 600_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const login of this.logins) {
        if (this.tryLock(login, holder)) {
          return login;
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `No free agent in ${timeoutMs}ms. Pool: ${this.logins.join(', ')}. ` +
            'Add more logins to AGENT_POOL_LOGINS or lower the number of workers.'
        );
      }
      // Not a pause in a test: this waits until another test gives an agent
      // back, and it stops as soon as that happens.
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
  }

  /**
   * Takes several agents at once — either all of them, or none.
   *
   * Taking them one by one would dead-lock: a test could hold one agent
   * while waiting for the second one that another test is holding.
   */
  async acquireMany(count: number, holder: string, timeoutMs = 600_000): Promise<string[]> {
    if (count > this.logins.length) {
      throw new Error(`Asked for ${count} agents, but the pool has only ${this.logins.length}.`);
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const taken: string[] = [];
      for (const login of this.logins) {
        if (this.tryLock(login, holder)) {
          taken.push(login);
        }
        if (taken.length === count) {
          return taken;
        }
      }

      // Not enough free agents: give back what was taken, so other tests are
      // not blocked, and try again.
      taken.forEach((login) => this.release(login));
      if (Date.now() >= deadline) {
        throw new Error(
          `No ${count} free agents in ${timeoutMs}ms. Pool: ${this.logins.join(', ')}. ` +
            'Add more logins to AGENT_POOL_LOGINS or run with fewer workers.'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
  }

  release(login: string): void {
    rmSync(this.lockPath(login), { recursive: true, force: true });
  }

  /**
   * Says "this agent is still in use".
   *
   * A lock is dropped when it looks abandoned, and a long test would
   * otherwise have its own agent taken away mid-run. The holder refreshes
   * the mark while it works, so only a crashed run leaves an old lock.
   */
  touch(login: string, holder: string): void {
    const path = this.lockPath(login);
    if (existsSync(path)) {
      writeFileSync(join(path, 'holder.txt'), `${holder}\n${Date.now()}`);
    }
  }

  private tryLock(login: string, holder: string): boolean {
    const path = this.lockPath(login);
    this.dropIfExpired(path);
    try {
      mkdirSync(path);
    } catch {
      return false;
    }
    writeFileSync(join(path, 'holder.txt'), `${holder}\n${Date.now()}`);
    return true;
  }

  private dropIfExpired(path: string): void {
    if (!existsSync(path)) {
      return;
    }
    const takenAt = Number(readFileSync(join(path, 'holder.txt'), 'utf8').split('\n')[1] ?? 0);
    if (Date.now() - takenAt > LOCK_MAX_AGE_MS) {
      rmSync(path, { recursive: true, force: true });
    }
  }

  private lockPath(login: string): string {
    return join(LOCKS_DIR, login.replace(/[^a-z0-9]+/gi, '_'));
  }
}
