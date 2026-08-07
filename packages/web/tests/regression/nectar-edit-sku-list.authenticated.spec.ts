// Spec-bound header: sha256 is the behavioral hash of the spec.
/* spec: specs/skus/edit-sku-list-button-and-modal.md version:2.3.1 sha256:ac06daf29ae657b2b9a82695094c33346f144354051da86d6c85c9e890b3f998 */
import { test, expect } from '../../fixtures/test';
import { PlanningPage } from '../../pages/PlanningPage';
import { buildToSkusConfirmed } from '../../pages/NectarFlow';

type EditorName = 'Measurement' | 'Hero';

function editorControls(planningPage: PlanningPage, editor: EditorName): {
  open: () => Promise<void>;
} {
  if (editor === 'Measurement') {
    return {
      open: () => planningPage.openMeasurementEditModal()
    };
  }
  return {
    open: () => planningPage.openHeroEditModal()
  };
}

function requireTentativeSelectionChange(
  initial: { count: string; rows: string[] },
  tentative: { count: string; rows: string[] },
  label: string
): void {
  if (JSON.stringify(tentative) === JSON.stringify(initial)) {
    throw new Error(`${label} modal did not change after the tentative remove action`);
  }
}

const openModalCases = [
  { caseId: 'DC-001', sourceId: 'TC-ESL-002', editor: 'Measurement', expectedCopy: 'Edit Measurement SKUs' },
  { caseId: 'DC-002', sourceId: 'TC-ESL-007', editor: 'Hero', expectedCopy: 'Hero' }
] as const;

const cancelCases = [
  { caseId: 'DC-004', sourceId: 'TC-ESL-005', editor: 'Measurement' },
  { caseId: 'DC-005', sourceId: 'TC-ESL-011', editor: 'Hero' }
] as const;

const keyboardCases = [
  { caseId: 'DC-007', editor: 'Measurement', dialogName: /Measurement/i },
  { caseId: 'DC-007', editor: 'Hero', dialogName: /Hero/i }
] as const;

async function openEditorWithKeyboard(planningPage: PlanningPage, editor: EditorName): Promise<void> {
  if (editor === 'Measurement') {
    await planningPage.openMeasurementEditModalWithKeyboard();
    return;
  }
  await planningPage.openHeroEditModalWithKeyboard();
}

test.describe.serial(
  'Nectar AI — Edit SKU list controls and modal identity',
  {
    tag: [
      '@generated',
      '@regression',
      '@media-planner',
      '@authenticated',
      '@nectar-sku',
      '@edit-sku-list-button-and-modal'
    ]
  },
  () => {
    for (const dataCase of openModalCases) {
      test(`${dataCase.caseId} ${dataCase.sourceId} opens the correct editor`, async ({ page }) => {
        test.setTimeout(360_000);
        const planningPage = new PlanningPage(page);
        const editor = editorControls(planningPage, dataCase.editor);

        await test.step('Complete the SKU stage and open this data-case editor', async () => {
          await buildToSkusConfirmed(planningPage);
          await editor.open();
        });

        await test.step('Assert AC-001: the requested editor opens with its expected identity', async () => {
          await expect(planningPage.editSkuModal()).toBeVisible();
          await expect(planningPage.editSkuModal()).toContainText(dataCase.expectedCopy);
        });
      });
    }

    test('DC-003 TC-ESL-020 the Measurement and Hero controls open distinct modals', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      let measurementModalCopy = '';

      await test.step('Open both editors in sequence', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
        measurementModalCopy = (await planningPage.editSkuModal().textContent()) ?? '';
        await planningPage.editModalCancel().click();
        await planningPage.editSkuModal().waitFor({ state: 'hidden' });
        await planningPage.openHeroEditModal();
      });

      await test.step('Assert AC-002: the controls resolve to distinct modal identities', async () => {
        await expect.poll(() => measurementModalCopy).toContain('Edit Measurement SKUs');
        await expect(planningPage.editSkuModal()).toContainText('Hero');
        await expect(planningPage.editSkuModal()).not.toContainText('Edit Measurement SKUs');
      });
    });

    for (const dataCase of cancelCases) {
      test(`${dataCase.caseId} AC-003 ${dataCase.sourceId} cancel restores the exact selection`, async ({ page }) => {
        test.setTimeout(360_000);
        const planningPage = new PlanningPage(page);
        const editor = editorControls(planningPage, dataCase.editor);
        let initialCount = '';
        let initialSelection: { count: string; rows: string[] } = { count: '', rows: [] };

        await test.step('Open the editor and capture its committed state', async () => {
          await buildToSkusConfirmed(planningPage);
          initialCount = (await planningPage.summarySkuCount(dataCase.editor).textContent()) ?? '';
          await editor.open();
          initialSelection = await planningPage.modalSelectionSnapshot();
        });

        await test.step('Tentatively remove a selected SKU, then cancel', async () => {
          const tentativeRemove = planningPage.modalFirstRemoveSkuButton();
          await tentativeRemove.click();
          await tentativeRemove.waitFor({ state: 'detached' });
          const tentativeSelection = await planningPage.modalSelectionSnapshot();
          requireTentativeSelectionChange(initialSelection, tentativeSelection, dataCase.editor);
          await planningPage.editModalCancel().click();
        });

        await test.step('Assert AC-003: cancel restores the exact editor selection and summary count', async () => {
          await expect(planningPage.editSkuModal()).toBeHidden();
          await expect(planningPage.summarySkuCount(dataCase.editor)).toHaveText(initialCount);
          await editor.open();
          await expect.poll(() => planningPage.modalSelectionSnapshot()).toEqual(initialSelection);
          await planningPage.editModalCancel().click();
          await expect(planningPage.editSkuModal()).toBeHidden();
        });
      });
    }

    test('DC-006 TC-ESL-004 the Measurement editor exposes a per-row remove control', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);

      await test.step('Open the Measurement edit modal', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
      });

      await test.step('Assert AC-001: at least one removable selected row is present', async () => {
        await expect(planningPage.editSkuModal().getByTestId(/^selectedSku-/)).not.toHaveCount(0);
        await expect(planningPage.editSkuModal().getByTestId(/^remove-selectedSku-/)).not.toHaveCount(0);
      });
    });

    for (const dataCase of keyboardCases) {
      test(`${dataCase.caseId} AC-004 ${dataCase.editor} editor is keyboard and focus accessible`, async ({ page }) => {
        test.setTimeout(360_000);
        const planningPage = new PlanningPage(page);

        await test.step('Build the confirmed SKU summary and keyboard-activate this editor', async () => {
          await buildToSkusConfirmed(planningPage);
          await openEditorWithKeyboard(planningPage, dataCase.editor);
        });

        await test.step('Assert AC-004: the named dialog owns focus and returns it to its invoking control', async () => {
          await expect(planningPage.summaryEditSkuButton(dataCase.editor)).toHaveAccessibleName(/.+/);
          await expect(planningPage.editSkuModal()).toHaveAccessibleName(dataCase.dialogName);
          await expect(planningPage.editDialogFocusedElement()).toHaveCount(1);
          await planningPage.editModalCancel().click();
          await expect(planningPage.editSkuModal()).toBeHidden();
          await expect(planningPage.summaryEditSkuButton(dataCase.editor)).toBeFocused();
        });
      });
    }

    test('DC-003 NEG-001 edit controls never resolve to crossed or shared dialog identities', async ({ page }) => {
      test.setTimeout(360_000);
      const planningPage = new PlanningPage(page);
      let measurementIdentity = '';

      await test.step('Arrange NEG-001: open each editor independently from the confirmed summary', async () => {
        await buildToSkusConfirmed(planningPage);
        await planningPage.openMeasurementEditModal();
        measurementIdentity = (await planningPage.editSkuModal().textContent()) ?? '';
        await planningPage.editModalCancel().click();
        await planningPage.editSkuModal().waitFor({ state: 'hidden' });
        await planningPage.openHeroEditModal();
      });

      await test.step('Assert NEG-001: Measurement and Hero identities are exclusive to their controls', async () => {
        await expect.poll(() => measurementIdentity).toContain('Edit Measurement SKUs');
        await expect(planningPage.editSkuModal()).toHaveAccessibleName(/Hero/i);
        await expect(planningPage.editSkuModal()).not.toContainText('Edit Measurement SKUs');
      });
    });
  }
);
