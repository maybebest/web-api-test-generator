import './load-dotenv';

/**
 * All environments live here. To switch, set TEST_ENV (see .env.example):
 *
 *   TEST_ENV=stage npx playwright test --project=api
 *
 * Nothing else in the project should hard-code a host name. If a test or a
 * page needs a URL, it takes it from `environment` below.
 */

export type EnvironmentName = 'stage' | 'dev';

export type Environment = {
  name: EnvironmentName;
  /** Site the user works with. */
  webUrl: string;
  /** API gateway behind the site. */
  apiUrl: string;
  /** Agent cabinet (helpdesk). Tests drive agents over the API, not here. */
  helpdeskUrl: string;
  /** Service that generates experts for the admin panel. */
  generationApiUrl: string;
  /** Verification codes the environment accepts. */
  emailCode: string;
  smsCode: string;
};

const environments: Record<EnvironmentName, Environment> = {
  stage: {
    name: 'stage',
    webUrl: 'https://user.stage.psychicbook.net',
    apiUrl: 'https://api.stage.psychicbook.net',
    helpdeskUrl: 'https://helpdesk.stage.psychicbook.net',
    generationApiUrl: 'https://agpt.stage.psychicbook.net/api',
    emailCode: '1234',
    smsCode: '1234'
  },
  dev: {
    name: 'dev',
    webUrl: 'https://user.dev.psychicbook.net',
    apiUrl: 'https://api.dev.psychicbook.net',
    helpdeskUrl: 'https://helpdesk.dev.psychicbook.net',
    generationApiUrl: 'https://agpt.dev.psychicbook.net/api',
    emailCode: '1234',
    smsCode: '1234'
  }
};

function currentEnvironmentName(): EnvironmentName {
  const name = (process.env.TEST_ENV ?? 'stage') as EnvironmentName;
  if (!environments[name]) {
    throw new Error(`Unknown TEST_ENV "${name}". Known environments: ${Object.keys(environments).join(', ')}`);
  }
  return name;
}

/** The environment the current run works against. */
export const environment: Environment = environments[currentEnvironmentName()];
