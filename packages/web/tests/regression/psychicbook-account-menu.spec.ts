/* spec: specs/psychicbook-account-menu.md version:1.0.0 sha256:659b74e381da4f08e9e9ce4bf30a06d45bf910c2bdec17ead2096c1b15a16606 */
import { test, expect } from '../../fixtures/test';
import { requireStandardUserEmail } from '../../data/users';
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
        const email = requireStandardUserEmail();

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
