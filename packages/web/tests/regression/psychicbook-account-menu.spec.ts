/* spec: specs/psychicbook-account-menu.md version:1.0.0 sha256:5f39df84d17a13dba7a741bcf71fe70febb74e812310fda05c1d00103704f9d9 */
import { test, expect } from '../../fixtures/test';
import { requirePsychicBookEmail } from '../../data/psychicbook';
import { PsychicBookLoginPage } from '../../pages/PsychicBookLoginPage';

const dataCases = [
  {
    caseId: 'DC-001',
    verificationCode: '1234',
  },
] as const;

test.describe.serial('PsychicBook account menu after email verification', () => {
  for (const dataCase of dataCases) {
    test(
      `PsychicBook account menu after email verification (${dataCase.caseId})`,
      { tag: ['@generated', '@regression', '@psychicbook'] },
      async ({ page }) => {
        test.info().annotations.push({ type: 'covered-ac-ids', description: 'AC-001 AC-002 AC-003 AC-004' });
        const psychicBookPage = new PsychicBookLoginPage(page);
        const email = requirePsychicBookEmail();

        await test.step('Arrange AC-001: open the PsychicBook landing page', async () => {
          await psychicBookPage.gotoLanding();
        });

        await test.step('Action AC-002, AC-003: authenticate with email and verification code', async () => {
          await psychicBookPage.start();
          await psychicBookPage.submitEmail(email);
          await psychicBookPage.chooseVerificationCode();
          await psychicBookPage.submitVerificationCode(dataCase.verificationCode);
        });

        await test.step('Assert AC-004: account-settings control is visible', async () => {
          await expect(psychicBookPage.accountSettingsControl()).toBeVisible();
        });
      },
    );
  }
});
