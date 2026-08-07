import type { ApiUser, UserFacade } from '../facades/UserFacade';

/**
 * Creates test users and remembers them, so the test does not have to clean
 * up by hand. Deleting never fails a test: the outcome of every delete is
 * written into the report instead.
 */
export class UserFactory {
  private readonly created: ApiUser[] = [];

  constructor(private readonly facade: UserFacade) {}

  /** New user registered by e-mail. */
  async createByEmail(prefix = 'qa'): Promise<ApiUser> {
    return this.remember(await this.facade.createUserByEmail(prefix));
  }

  /** New user registered by phone. */
  async createByPhone(): Promise<ApiUser> {
    return this.remember(await this.facade.createUserByPhone());
  }

  /** New user with a filled profile and a saved card — ready to book. */
  async createReadyToBook(nickname: string): Promise<ApiUser> {
    const user = await this.createByPhone();
    await this.facade.completeProfile(user, nickname);
    await this.facade.attachTestCard(user);
    return user;
  }

  /** Adds a user created elsewhere to the clean-up list. */
  remember(user: ApiUser): ApiUser {
    this.created.push(user);
    return user;
  }

  /** Deletes everything created in this test. Returns one line per user. */
  async deleteAll(): Promise<string[]> {
    const lines: string[] = [];
    for (const user of this.created) {
      const outcome = await this.facade.deleteUserQuietly(user);
      lines.push(`${user.email ?? user.registeredPhone ?? user.userUuid}: ${outcome}`);
    }
    return lines;
  }
}
