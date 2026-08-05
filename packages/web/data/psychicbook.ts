export function requirePsychicBookEmail(): string {
  const email = process.env.PSYCHICBOOK_E2E_EMAIL?.trim();

  if (!email) {
    throw new Error('Missing required runtime configuration: PSYCHICBOOK_E2E_EMAIL');
  }

  return email;
}
