// @ts-check
const state = {
  activeTab: 'api',
  apiFiles: [],
  specFiles: [],
  recordingFiles: [],
  specTaskPath: '',
  recordingTaskPath: '',
  webFlowSpecs: [],
  webSpecTasks: [],
  webGeneratedTests: [],
  generatedTests: [],
  testManagement: emptyTestManagement(),
  selectedRunId: '',
  casesSearch: '',
  specsSearch: '',
  webGeneratedTestsSearch: '',
  settings: { ai: {} },
  activeController: null
};

// Safety net slightly longer than the server-side command timeout so a wedged
// request cannot leave the UI disabled forever.
const REQUEST_TIMEOUT_MS = 16 * 60 * 1000;
let specLoadSequence = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

/**
 * House rule: EVERY destructive action (delete/clear) must be confirmed through this dialog —
 * never wire a delete straight to its handler. Returns true only when the user explicitly
 * clicks the danger button; Esc/Cancel/backdrop-close all resolve to false.
 * @param {string} message
 * @param {{ title?: string, confirmLabel?: string }} [options]
 * @returns {Promise<boolean>}
 */
function confirmDestructive(message, options = {}) {
  const dialog = $('#confirm-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(message));
  }
  $('#confirm-title').textContent = options.title || 'Confirm deletion';
  $('#confirm-message').textContent = message;
  $('#confirm-accept').textContent = options.confirmLabel || 'Delete';
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'accept');
    };
    dialog.addEventListener('close', onClose);
    dialog.returnValue = '';
    dialog.showModal();
  });
}

init();

async function init() {
  bindTabs();
  bindUploads();
  bindActions();
  await refreshState();
}

function bindTabs() {
  $$('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab === button));
      $$('.tab-panel').forEach((panel) => panel.classList.toggle('is-active', panel.id === `tab-${state.activeTab}`));
    });
  });
}

function bindUploads() {
  $('#api-upload-button').addEventListener('click', () => uploadFiles('api-har', '#api-upload', '#api-har-inputs', true));
  $('#spec-upload-button').addEventListener('click', () => uploadFiles('web-spec', '#spec-upload', '#spec-path', false));
  $('#recording-upload-button').addEventListener(
    'click',
    () => uploadFiles('web-recording', '#recording-upload', '#recording-path', false)
  );
}

function bindActions() {
  $('#api-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await postJson('/api/api-generate', collectApiPayload(), 'api');
    renderApiResult(result);
    await refreshState();
  });

  $('#api-smoke').addEventListener('click', async () => {
    const result = await postJson('/api/api-tests', { mode: 'smoke' }, 'api');
    renderCommandResult('api', result);
  });

  $('#api-run-all').addEventListener('click', async () => {
    const result = await postJson('/api/api-tests', { mode: 'generated' }, 'api');
    renderCommandResult('api', result);
  });

  $('#spec-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await postJson('/api/web-spec-task', collectSpecTaskPayload(), 'spec');
    applyTaskMetadata('spec', result.metadata);
    renderTaskResult('spec', result);
    await refreshState();
  });

  $('#spec-template-load').addEventListener('click', loadSpecTemplate);
  $('#spec-fit').addEventListener('click', fitSpecToTemplate);
  $('#spec-save').addEventListener('click', saveSpecFile);
  $('#spec-delete').addEventListener('click', deleteSelectedSpec);
  $('#spec-review').addEventListener('click', () => runSpecCheck('review'));
  $('#spec-gate').addEventListener('click', () => runSpecCheck('gate'));
  $('#spec-drift').addEventListener('click', () => runSpecCheck('drift'));
  $('#spec-select').addEventListener('change', async () => {
    $('#spec-path').value = valueOf('#spec-select');
    await loadSelectedSpecIntoEditor();
    renderSavedSpecs();
  });
  $('#tm-cases-search').addEventListener('input', () => {
    state.casesSearch = valueOf('#tm-cases-search');
    renderCasesList();
  });
  $('#tm-specs-search').addEventListener('input', () => {
    state.specsSearch = valueOf('#tm-specs-search');
    renderManagementSpecsList();
  });
  $('#spec-generated-search').addEventListener('input', () => {
    state.webGeneratedTestsSearch = valueOf('#spec-generated-search');
    renderGeneratedWebTests();
  });

  $('#recording-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await postJson('/api/web-recording-task', collectRecordingTaskPayload(), 'recording');
    applyTaskMetadata('recording', result.metadata);
    renderTaskResult('recording', result);
    await refreshState();
  });

  $('#recording-ai').addEventListener('click', async () => {
    let payload;
    try {
      payload = collectRecordingAiPayload();
    } catch (error) {
      setStatus('error', 'Missing task');
      renderLog('recording', error.message);
      return;
    }

    const result = await postJson('/api/web-recording-ai', payload, 'recording');
    renderCommandResult('recording', result);
    await refreshState();
  });

  $('#recording-review').addEventListener('click', () => runRecordingCheck('review'));
  $('#recording-gate').addEventListener('click', () => runRecordingCheck('gate'));
  $('#recording-drift').addEventListener('click', () => runRecordingCheck('drift'));

  $('#brain-doctor').addEventListener('click', async () => {
    const scope = ['api', 'spec', 'recording'].includes(state.activeTab) ? state.activeTab : 'spec';
    const result = await postJson('/api/web-brain-doctor', {}, scope);
    renderCommandResult(scope, result);
    await refreshState();
  });

  $('#settings-open').addEventListener('click', () => $('#settings-dialog').showModal());
  $('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = collectAiSettingsPayload();
    const keysToClear = [
      payload.clearAnthropicApiKey ? 'Anthropic' : '',
      payload.clearOpenaiApiKey ? 'OpenAI' : ''
    ].filter(Boolean);
    if (keysToClear.length > 0) {
      const accepted = await confirmDestructive(
        `Delete the saved ${keysToClear.join(' and ')} API key${keysToClear.length > 1 ? 's' : ''}? The key material is removed from the UI settings store and AI calls fall back to environment variables or CLI brains.`,
        { title: 'Clear saved keys', confirmLabel: 'Delete Keys' }
      );
      if (!accepted) {
        return;
      }
    }
    const result = await postJson('/api/settings/ai', payload, state.activeTab === 'runs' ? 'management' : state.activeTab);
    if (!result.ok) {
      return;
    }
    applySettings(result.settings);
    $('#settings-dialog').close();
  });

  $('#tm-case-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await postJson('/api/test-management/cases', collectCasePayload(), 'management');
    if (!result.ok) {
      return;
    }
    applyTestManagementData(result.data);
    resetCaseForm();
    await refreshState();
    renderLog('management', result.file ? `Saved case spec: ${result.file.label}` : 'Saved case.');
  });

  $('#tm-suite-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await postJson('/api/test-management/suites', collectSuitePayload(), 'management');
    if (!result.ok) {
      return;
    }
    applyTestManagementData(result.data);
    resetSuiteForm();
  });

  $('#tm-run-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await postJson('/api/test-management/runs', collectRunPayload(), 'management');
    if (!result.ok) {
      return;
    }
    state.selectedRunId = result.run?.id || state.selectedRunId;
    applyTestManagementData(result.data);
    resetRunForm();
  });

  $('#refresh-state').addEventListener('click', refreshState);
  $('#cancel-run').addEventListener('click', cancelActiveRun);
  $('#preview-close').addEventListener('click', () => $('#preview-dialog').close());
}

async function runSpecCheck(action) {
  const result = await postJson(
    '/api/web-spec-check',
    {
      action,
      specPath: valueOf('#spec-path'),
      targetTestFile: valueOf('#spec-target'),
      mode: valueOf('#spec-mode')
    },
    'spec'
  );
  renderCommandResult('spec', result);
  await refreshState();
}

async function runRecordingCheck(action) {
  const result = await postJson(
    '/api/web-recording-check',
    {
      action,
      recordingPath: valueOf('#recording-path'),
      targetTestFile: valueOf('#recording-target')
    },
    'recording'
  );
  renderCommandResult('recording', result);
  await refreshState();
}

function collectApiPayload() {
  return {
    harInputs: splitList(valueOf('#api-har-inputs')),
    outDir: valueOf('#api-out-dir'),
    baseUrl: valueOf('#api-base-url'),
    include: linesOf('#api-include'),
    exclude: linesOf('#api-exclude'),
    ignoredDomains: linesOf('#api-ignore-domain'),
    firstPartyDomains: linesOf('#api-first-party'),
    methods: checkedValues('api-method'),
    statuses: splitList(valueOf('#api-statuses')),
    generationModes: checkedValues('api-generation-mode'),
    inferenceLevel: valueOf('#api-inference-level'),
    inferredRunMode: valueOf('#api-inferred-run-mode'),
    negativeStatusPolicy: valueOf('#api-negative-status-policy'),
    mutationPolicy: valueOf('#api-mutation-policy'),
    configPath: valueOf('#api-config'),
    calibrationOverridesPath: valueOf('#api-calibration'),
    ai: $('#api-ai').checked,
    dryRun: $('#api-dry-run').checked
  };
}

function collectSpecTaskPayload() {
  return {
    specPath: valueOf('#spec-path'),
    targetTestFile: valueOf('#spec-target'),
    mode: valueOf('#spec-mode')
  };
}

function collectSpecFilePayload() {
  const content = valueOf('#spec-editor-content');
  const specPath = nextSpecPath(content);
  return {
    specPath,
    content
  };
}

function collectRecordingTaskPayload() {
  return {
    recordingPath: valueOf('#recording-path'),
    targetTestFile: valueOf('#recording-target')
  };
}

function collectRecordingAiPayload() {
  if (!state.recordingTaskPath) {
    throw new Error('Create the recording task before running AI.');
  }

  return {
    taskPath: state.recordingTaskPath,
    targetTestFile: valueOf('#recording-target')
  };
}

function collectCasePayload() {
  return {
    id: valueOf('#tm-case-id'),
    title: valueOf('#tm-case-title'),
    area: valueOf('#tm-case-area'),
    priority: valueOf('#tm-case-priority'),
    status: valueOf('#tm-case-status'),
    automation: valueOf('#tm-case-automation'),
    testPath: valueOf('#tm-case-test-path'),
    specPath: valueOf('#tm-case-spec-path'),
    recordingPath: valueOf('#tm-case-recording-path'),
    tags: splitList(valueOf('#tm-case-tags')),
    preconditions: valueOf('#tm-case-preconditions'),
    steps: valueOf('#tm-case-steps'),
    expectedResult: valueOf('#tm-case-expected')
  };
}

function collectSuitePayload() {
  return {
    id: valueOf('#tm-suite-id'),
    name: valueOf('#tm-suite-name'),
    description: valueOf('#tm-suite-description'),
    caseIds: selectedValues('#tm-suite-cases')
  };
}

function collectRunPayload() {
  return {
    name: valueOf('#tm-run-name'),
    suiteId: valueOf('#tm-run-suite'),
    environment: valueOf('#tm-run-environment'),
    caseIds: selectedValues('#tm-run-cases')
  };
}

function collectAiSettingsPayload() {
  return {
    brain: valueOf('#settings-ai-brain'),
    anthropicApiKey: valueOf('#settings-anthropic-key'),
    openaiApiKey: valueOf('#settings-openai-key'),
    anthropicModel: valueOf('#settings-anthropic-model'),
    openaiModel: valueOf('#settings-openai-model'),
    timeoutMs: valueOf('#settings-timeout'),
    clearAnthropicApiKey: $('#settings-clear-anthropic').checked,
    clearOpenaiApiKey: $('#settings-clear-openai').checked
  };
}

async function uploadFiles(kind, inputSelector, targetSelector, append) {
  const input = $(inputSelector);
  if (!input.files.length) {
    setStatus('error', 'No file selected');
    return;
  }

  const form = new FormData();
  Array.from(input.files).forEach((file) => form.append('files', file));
  setBusy(true);
  setStatus('running', 'Uploading');

  try {
    const response = await fetch(`/api/upload?kind=${encodeURIComponent(kind)}`, {
      method: 'POST',
      body: form
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Upload failed with HTTP ${response.status}`);
    }

    const paths = result.files.map((file) => file.path);
    const target = $(targetSelector);
    const separator = target.tagName === 'TEXTAREA' ? '\n' : ', ';
    target.value = append && target.value.trim() ? `${target.value.trim()}${separator}${paths.join(separator)}` : paths.join(separator);
    if (targetSelector === '#spec-path') {
      renderSpecSelect();
      await loadSelectedSpecIntoEditor();
    }
    setStatus('ok', 'Uploaded');
  } catch (error) {
    setStatus('error', 'Upload failed');
    renderLog(state.activeTab, error.message);
  } finally {
    setBusy(false);
  }
}

async function loadSpecTemplate() {
  setBusy(true);
  setStatus('running', 'Loading template');

  try {
    const response = await fetch('/api/web-spec-template');
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Template request failed with HTTP ${response.status}`);
    }

    $('#spec-editor-content').value = result.content;
    setStatus('ok', 'Template loaded');
    renderLog('spec', `Loaded template: ${result.file.label}`);
  } catch (error) {
    setStatus('error', 'Template failed');
    renderLog('spec', error.message);
  } finally {
    setBusy(false);
  }
}

async function loadSelectedSpecIntoEditor() {
  const specPath = valueOf('#spec-path');
  if (!specPath) {
    return;
  }

  const sequence = ++specLoadSequence;
  try {
    const response = await fetch(`/api/file?scope=web&path=${encodeURIComponent(specPath)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Could not load spec: ${specPath}`);
    }

    // Discard a stale response if a newer load started or the selection moved on,
    // so a slow response for one spec can't overwrite the editor for another.
    if (sequence !== specLoadSequence || valueOf('#spec-path') !== specPath) {
      return;
    }

    $('#spec-editor-content').closest('details').open = true;
    $('#spec-editor-content').value = result.content;
    const target = metadataValue(result.content, 'Target Test File');
    const mode = metadataValue(result.content, 'Generation Mode');
    if (target) {
      $('#spec-target').value = target;
    }
    if (mode && ['single', 'suite'].includes(mode)) {
      $('#spec-mode').value = mode;
    }
    renderSpecSelect();
    renderLog('spec', `Loaded spec into editor: ${result.file.label}`);
  } catch (error) {
    setStatus('error', 'Spec load failed');
    renderLog('spec', error.message);
  }
}

async function fitSpecToTemplate() {
  const content = valueOf('#spec-editor-content');
  if (!content) {
    setStatus('error', 'Missing source');
    renderLog('spec', 'Paste manual QA notes or a rough spec before fitting it to the template.');
    return;
  }

  const result = await postJson('/api/web-spec-fit', { content }, 'spec');
  if (!result.ok) {
    return;
  }

  $('#spec-editor-content').value = result.content;
  const target = metadataValue(result.content, 'Target Test File');
  const mode = metadataValue(result.content, 'Generation Mode');
  if (target) {
    $('#spec-target').value = target;
  }
  if (mode && ['single', 'suite'].includes(mode)) {
    $('#spec-mode').value = mode;
  }

  const brain = result.brain?.model ? `${result.brain.kind} ${result.brain.model}` : result.brain?.kind;
  renderLog('spec', `Spec fitted to template${brain ? ` via ${brain}` : ''}. Review NEEDS_REVIEW fields before Create Task.`);
}

async function saveSpecFile() {
  const result = await postJson('/api/web-spec-file', collectSpecFilePayload(), 'spec');
  if (!result.ok) {
    return;
  }

  $('#spec-path').value = result.file.path;
  renderLog('spec', `Saved spec: ${result.file.label}`);
  await refreshState();
  renderSpecSelect();
}

async function deleteSelectedSpec() {
  const specPath = valueOf('#spec-path');
  if (!specPath) {
    setStatus('error', 'No spec selected');
    renderLog('spec', 'Choose a saved spec before deleting.');
    return;
  }

  const specName = specFileName(specPath);
  const accepted = await confirmDestructive(
    `Delete ${specName}? This removes the Markdown spec file from packages/web/specs.`,
    { title: 'Delete spec', confirmLabel: 'Delete Spec' }
  );
  if (!accepted) {
    return;
  }

  const result = await postJson('/api/web-spec-file/delete', { specPath }, 'spec');
  if (!result.ok) {
    return;
  }

  $('#spec-path').value = '';
  $('#spec-select').value = '';
  $('#spec-editor-content').value = '';
  $('#spec-target').value = '';
  $('#spec-mode').value = '';
  state.specTaskPath = '';
  renderLog('spec', `Deleted spec: ${result.file.label}`);
  await refreshState();
}

async function postJson(url, payload, logScope) {
  setBusy(true);
  setStatus('running', 'Running');
  renderLog(logScope, 'Running command...');

  const controller = new AbortController();
  state.activeController = controller;
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Request failed with HTTP ${response.status}`);
    }
    setStatus(result.ok ? 'ok' : 'error', result.ok ? 'Done' : 'Failed');
    return result;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const message = cancelled ? 'Request cancelled.' : error.message;
    const result = { ok: false, error: message, stdout: '', stderr: message };
    setStatus('error', cancelled ? 'Cancelled' : 'Failed');
    renderCommandResult(logScope, result);
    return result;
  } finally {
    clearTimeout(timeout);
    if (state.activeController === controller) {
      state.activeController = null;
    }
    setBusy(false);
  }
}

async function refreshState() {
  let data;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) {
      throw new Error(`State request failed with HTTP ${response.status}`);
    }
    data = await response.json();
  } catch (error) {
    setStatus('error', 'State refresh failed');
    return;
  }

  if (!data.ok) {
    return;
  }

  fillDatalist('#api-examples', data.examples.api);
  fillDatalist('#spec-examples', data.examples.specs);
  fillDatalist('#recording-examples', data.examples.recordings);
  state.webFlowSpecs = data.examples.webFlowSpecs || [];
  renderSpecSelect();
  renderSavedSpecs();
  state.webSpecTasks = data.examples.webSpecTasks || [];
  renderSpecTasks();
  state.webGeneratedTests = data.examples.webGeneratedTests || [];
  state.generatedTests = data.examples.generatedTests || [];
  fillDatalist('#tm-generated-tests', state.generatedTests);
  renderGeneratedWebTests();
  applyTestManagementData(data.testManagement);
  applySettings(data.settings);
  renderHistory(data.history);

  if (data.activeCommand) {
    setStatus('running', data.activeCommand.script);
  } else if (!$('#active-status').classList.contains('is-ok') && !$('#active-status').classList.contains('is-error')) {
    setStatus('idle', 'Idle');
  }
}

function renderApiResult(result) {
  renderCommandResult('api', result);
  const summary = result.summary;
  const metrics = [];
  if (summary) {
    metrics.push(['Parsed', summary.parsedEntries]);
    metrics.push(['Filtered', summary.filteredEntries]);
    metrics.push(['Tests', summary.generatedTests]);
    metrics.push(['Files', summary.generatedFiles?.length || 0]);
    metrics.push(['Dry run', summary.dryRun ? 'Yes' : 'No']);
  }
  renderMetrics('#api-summary', metrics);
  renderFiles('#api-files', result.files || [], 'api');
}

function renderTaskResult(scope, result) {
  renderCommandResult(scope, result);
  const metadata = result.metadata || {};
  const metrics = [];
  if (metadata.taskPath) {
    metrics.push(['Task', compactPath(metadata.taskPath)]);
  }
  if (metadata.targetTestFile) {
    metrics.push(['Saved as', compactPath(metadata.targetTestFile)]);
  }
  if (metadata.generationMode) {
    metrics.push(['Mode', metadata.generationMode]);
  }
  if (metadata.flowId || metadata.recordingTitle) {
    metrics.push(['Flow', metadata.flowId || metadata.recordingTitle]);
  }
  renderMetrics(`#${scope}-summary`, metrics);
  renderFiles(`#${scope}-files`, result.files || [], 'web');
}

function renderSpecSelect() {
  const select = $('#spec-select');
  if (!select) {
    return;
  }

  const currentPath = valueOf('#spec-path');
  select.innerHTML = '<option value="">Choose saved spec</option>';
  for (const spec of state.webFlowSpecs) {
    const option = document.createElement('option');
    option.value = spec.path;
    option.textContent = specFileName(spec.path);
    select.append(option);
  }

  if (currentPath && !state.webFlowSpecs.some((spec) => spec.path === currentPath)) {
    const option = document.createElement('option');
    option.value = currentPath;
    option.textContent = specFileName(currentPath);
    select.append(option);
  }
  select.value = currentPath;
}

function renderSavedSpecs() {
  const container = $('#spec-saved-list');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'task-list__header';
  header.textContent = 'Saved specs';
  container.append(header);

  if (state.webFlowSpecs.length === 0) {
    container.insertAdjacentHTML('beforeend', '<div class="task-item"><span>No saved Markdown specs yet</span></div>');
    return;
  }

  for (const spec of state.webFlowSpecs) {
    const item = document.createElement('div');
    item.className = `task-item ${valueOf('#spec-path') === spec.path ? 'is-selected' : ''}`;
    const detail = [specDisplayName(spec), spec.flowId, spec.targetTestFile ? `Target: ${spec.targetTestFile}` : 'No target test file']
      .filter(Boolean)
      .join(' | ');
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(specFileName(spec.path))}</strong>
        <small>${escapeHtml(detail)}</small>
      </div>
      <div class="button-row">
        <button class="button button--primary" type="button" data-action="generate">Generate</button>
        <button class="button" type="button" data-action="use">Use</button>
        <button class="button" type="button" data-action="preview">Preview</button>
      </div>
    `;
    item.querySelector('[data-action="generate"]').addEventListener('click', () => generateSavedSpec(spec.path));
    item.querySelector('[data-action="use"]').addEventListener('click', () => selectSavedSpec(spec.path));
    item.querySelector('[data-action="preview"]').addEventListener('click', () => previewFile('web', spec.path));
    container.append(item);
  }
}

function specDisplayName(spec) {
  return spec.title || spec.flowId || titleFromPath(spec.path);
}

function specFileName(filePath) {
  return filePath.split('/').pop() || filePath;
}

async function selectSavedSpec(specPath) {
  const spec = state.webFlowSpecs.find((candidate) => candidate.path === specPath);
  if (!spec) {
    return;
  }

  state.specTaskPath = '';
  $('#spec-path').value = spec.path;
  renderSpecSelect();
  $('#spec-target').value = spec.targetTestFile || suggestedTargetForSpec(spec);
  if (spec.generationMode) {
    $('#spec-mode').value = spec.generationMode;
  }
  await loadSelectedSpecIntoEditor();
  renderSavedSpecs();
  renderSpecTasks();
  renderMetrics('#spec-summary', [
    ['Selected spec', compactPath(spec.path)],
    ['Saved as', compactPath($('#spec-target').value)],
    ['Mode', spec.generationMode || 'from spec']
  ]);
}

async function generateSavedSpec(specPath) {
  const spec = state.webFlowSpecs.find((candidate) => candidate.path === specPath);
  if (!spec) {
    renderLog('spec', 'Saved spec was not found.');
    return;
  }

  await selectSavedSpec(spec.path);
  const targetTestFile = spec.targetTestFile || valueOf('#spec-target') || suggestedTargetForSpec(spec);
  $('#spec-target').value = targetTestFile;

  const result = await postJson(
    '/api/web-spec-ai',
    {
      specPath: spec.path,
      targetTestFile
    },
    'spec'
  );
  renderCommandResult('spec', result);
  await refreshState();
}

function renderSpecTasks() {
  const container = $('#spec-task-list');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (state.webSpecTasks.length === 0) {
    container.innerHTML = '<div class="task-item"><span>No saved spec tasks yet</span></div>';
    return;
  }

  const header = document.createElement('div');
  header.className = 'task-list__header';
  header.textContent = 'Saved spec tasks';
  container.append(header);

  for (const task of state.webSpecTasks) {
    const item = document.createElement('div');
    item.className = `task-item ${state.specTaskPath === task.path ? 'is-selected' : ''}`;
    const title = task.flowId || titleFromPath(task.targetTestFile || task.specPath || task.path);
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(task.targetTestFile || task.specPath || task.path)}</small>
      </div>
      <div class="button-row">
        <button class="button button--primary" type="button" data-action="generate">Generate</button>
        <button class="button" type="button" data-action="use">Use</button>
        <button class="button" type="button" data-action="preview">Preview</button>
      </div>
    `;
    item.querySelector('[data-action="generate"]').addEventListener('click', () => generateSpecTask(task.path));
    item.querySelector('[data-action="use"]').addEventListener('click', () => selectSpecTask(task.path));
    item.querySelector('[data-action="preview"]').addEventListener('click', () => previewFile('web', task.path));
    container.append(item);
  }
}

async function generateSpecTask(taskPath) {
  const task = state.webSpecTasks.find((candidate) => candidate.path === taskPath);
  if (!task) {
    renderLog('spec', 'Generation task was not found.');
    return;
  }
  if (!task.targetTestFile) {
    setStatus('error', 'Missing target');
    renderLog('spec', 'Generation task has no target test file. Open it with Use, set Save generated test as, and create the task again.');
    return;
  }

  selectSpecTask(task.path);
  const result = await postJson(
    '/api/web-spec-ai',
    {
      taskPath: task.path,
      targetTestFile: task.targetTestFile
    },
    'spec'
  );
  renderCommandResult('spec', result);
  await refreshState();
}

function renderGeneratedWebTests() {
  const container = $('#spec-generated-tests');
  if (!container) {
    return;
  }

  const visibleTests = filterItems(state.webGeneratedTests, state.webGeneratedTestsSearch, (file) => [
    file.label,
    file.path,
    file.updatedAt
  ]);
  const count = $('#spec-generated-tests-count');
  if (count) {
    count.textContent =
      visibleTests.length === state.webGeneratedTests.length
        ? `${state.webGeneratedTests.length} files`
        : `${visibleTests.length} of ${state.webGeneratedTests.length} files`;
  }

  if (state.webGeneratedTests.length === 0) {
    container.innerHTML = '<div class="file-item"><code>No generated Playwright tests yet</code></div>';
    return;
  }

  if (visibleTests.length === 0) {
    container.innerHTML = '<div class="file-item"><code>No matching generated tests</code></div>';
    return;
  }

  renderFiles('#spec-generated-tests', visibleTests, 'web');
}

function selectSpecTask(taskPath) {
  const task = state.webSpecTasks.find((candidate) => candidate.path === taskPath);
  if (!task) {
    return;
  }

  state.specTaskPath = task.path;
  if (task.specPath) $('#spec-path').value = task.specPath;
  renderSpecSelect();
  if (task.targetTestFile) $('#spec-target').value = task.targetTestFile;
  if (task.generationMode) $('#spec-mode').value = task.generationMode;
  if (task.specPath) loadSelectedSpecIntoEditor();
  renderSpecTasks();
  renderMetrics('#spec-summary', [
    ['Selected task', compactPath(task.path)],
    ['Saved as', compactPath(task.targetTestFile || '')],
    ['Mode', task.generationMode || 'from spec']
  ]);
}

function renderCommandResult(scope, result) {
  const header = [
    result.command ? `$ ${result.command}` : undefined,
    result.exitCode !== undefined && result.exitCode !== null ? `exit ${result.exitCode}` : undefined,
    result.durationMs ? `${Math.round(result.durationMs / 100) / 10}s` : undefined
  ]
    .filter(Boolean)
    .join(' | ');
  const body = [header, result.stdout, result.stderr, result.error].filter(Boolean).join('\n\n');
  renderLog(scope, body || 'No output');
  if (result.files?.length) {
    renderFiles(`#${scope}-files`, result.files, scope === 'api' ? 'api' : 'web');
  }
}

function renderMetrics(selector, metrics) {
  const container = $(selector);
  container.innerHTML = '';
  for (const [label, value] of metrics) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `<strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span>`;
    container.append(card);
  }
}

function renderFiles(selector, files, scope) {
  const container = $(selector);
  container.innerHTML = '';
  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'file-item';
    const code = document.createElement('code');
    code.textContent = file.label || file.path;
    const button = document.createElement('button');
    button.className = 'button';
    button.type = 'button';
    button.textContent = 'Preview';
    button.addEventListener('click', () => previewFile(file.scope || scope, file.path));
    item.append(code, button);
    if (file.path.endsWith('.ts')) {
      const caseButton = document.createElement('button');
      caseButton.className = 'button';
      caseButton.type = 'button';
      caseButton.textContent = 'Case';
      caseButton.addEventListener('click', () => seedCaseFromGeneratedFile(file, file.scope || scope));
      item.append(caseButton);
    }
    container.append(item);
  }
}

function seedCaseFromGeneratedFile(file, scope) {
  switchTab('management');
  const packagePrefix = scope === 'api' ? 'packages/api' : 'packages/web';
  const pathForCase = file.label || `${packagePrefix}/${file.path}`;
  $('#tm-case-id').value = '';
  $('#tm-case-title').value = titleFromPath(file.path);
  $('#tm-case-test-path').value = pathForCase;
  $('#tm-case-automation').value = 'automated';
  $('#tm-case-status').value = 'ready';
  $('#tm-case-tags').value = scope === 'api' ? 'api, automated' : 'web, automated';
  $('#tm-case-title').focus();
}

function seedCaseFromSpec(specPath) {
  const spec = state.webFlowSpecs.find((candidate) => candidate.path === specPath);
  if (!spec) {
    renderLog('management', 'Spec was not found.');
    return;
  }

  switchTab('management');
  const targetExists = spec.targetTestFile && state.webGeneratedTests.some((file) => file.path === spec.targetTestFile);
  const tags = ['web', 'spec', ...(spec.tags || [])].map((tag) => String(tag).replace(/^@/, '')).filter(Boolean);
  $('#tm-case-id').value = '';
  $('#tm-case-title').value = specDisplayName(spec);
  $('#tm-case-area').value = spec.flowId || 'Web spec';
  $('#tm-case-priority').value = spec.priority || 'medium';
  $('#tm-case-status').value = 'ready';
  $('#tm-case-automation').value = targetExists ? 'automated' : 'candidate';
  $('#tm-case-test-path').value = spec.targetTestFile || '';
  $('#tm-case-spec-path').value = spec.path;
  $('#tm-case-recording-path').value = '';
  $('#tm-case-tags').value = [...new Set(tags)].join(', ');
  $('#tm-case-preconditions').value = '';
  $('#tm-case-steps').value = '';
  $('#tm-case-expected').value = '';
  renderLog('management', `Imported spec into case form: ${specFileName(spec.path)}`);
  $('#tm-case-title').focus();
}

function applyTestManagementData(data) {
  state.testManagement = normalizeTestManagement(data);
  renderCaseOptions();
  renderSuiteOptions();
  renderManagementLists();
  renderSelectedRun();
}

function applySettings(settings) {
  state.settings = settings || { ai: {} };
  const ai = state.settings.ai || {};
  $('#settings-ai-brain').value = ai.brain || 'auto';
  $('#settings-anthropic-model').value = ai.anthropicModel || '';
  $('#settings-openai-model').value = ai.openaiModel || '';
  $('#settings-timeout').value = ai.timeoutMs || '';
  $('#settings-anthropic-key').value = '';
  $('#settings-openai-key').value = '';
  $('#settings-clear-anthropic').checked = false;
  $('#settings-clear-openai').checked = false;
  $('#settings-anthropic-status').textContent = ai.anthropicApiKeyConfigured ? `Configured ${ai.anthropicApiKeyHint}` : 'Not configured';
  $('#settings-openai-status').textContent = ai.openaiApiKeyConfigured ? `Configured ${ai.openaiApiKeyHint}` : 'Not configured';
}

function renderCaseOptions() {
  const cases = state.testManagement.cases;
  fillSelect('#tm-suite-cases', cases.map((testCase) => ({ value: testCase.id, label: `${testCase.id} ${testCase.title}` })));
  fillSelect('#tm-run-cases', cases.map((testCase) => ({ value: testCase.id, label: `${testCase.id} ${testCase.title}` })));
}

function renderSuiteOptions() {
  const options = [{ value: '', label: 'No suite' }].concat(
    state.testManagement.suites.map((suite) => ({ value: suite.id, label: `${suite.id} ${suite.name}` }))
  );
  fillSelect('#tm-run-suite', options);
}

function renderManagementLists() {
  renderCasesList();
  renderManagementSpecsList();
  renderSuitesList();
  renderRunsList();
}

function renderManagementSpecsList() {
  const container = $('#tm-specs-list');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const specs = filterItems(state.webFlowSpecs, state.specsSearch, (spec) => [
    specFileName(spec.path),
    specDisplayName(spec),
    spec.flowId,
    spec.targetTestFile,
    spec.path
  ]);
  if (state.webFlowSpecs.length === 0) {
    container.innerHTML = '<div class="entity-item"><span>No specs yet</span></div>';
    return;
  }
  if (specs.length === 0) {
    container.innerHTML = '<div class="entity-item"><span>No matching specs</span></div>';
    return;
  }

  for (const spec of specs) {
    const item = document.createElement('div');
    item.className = 'entity-item';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(specFileName(spec.path))}</strong>
        <small>${escapeHtml([specDisplayName(spec), spec.flowId, spec.targetTestFile ? `Target: ${spec.targetTestFile}` : 'No target test file'].filter(Boolean).join(' | '))}</small>
      </div>
      <div class="button-row">
        <button class="button button--primary" type="button" data-action="import">Import Case</button>
        <button class="button" type="button" data-action="preview">Preview</button>
      </div>
    `;
    item.querySelector('[data-action="import"]').addEventListener('click', () => seedCaseFromSpec(spec.path));
    item.querySelector('[data-action="preview"]').addEventListener('click', () => previewFile('web', spec.path));
    container.append(item);
  }
}

function renderCasesList() {
  const container = $('#tm-cases-list');
  container.innerHTML = '';
  const cases = filterItems(state.testManagement.cases, state.casesSearch, (testCase) => [
    testCase.id,
    testCase.title,
    testCase.area,
    testCase.priority,
    testCase.status,
    testCase.automation,
    testCase.sourcePath,
    testCase.specPath,
    testCase.testPath,
    ...(testCase.tags || [])
  ]);
  if (state.testManagement.cases.length === 0) {
    container.innerHTML = '<div class="entity-item"><span>No test cases yet</span></div>';
    return;
  }
  if (cases.length === 0) {
    container.innerHTML = '<div class="entity-item"><span>No matching cases</span></div>';
    return;
  }

  for (const testCase of cases) {
    const item = document.createElement('div');
    item.className = 'entity-item';
    const sourceLabel = caseSourceLabel(testCase);
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(testCase.id)} ${escapeHtml(testCase.title)}</strong>
        <small>${escapeHtml([testCase.area, testCase.priority, testCase.status, testCase.automation].filter(Boolean).join(' | '))}</small>
        ${sourceLabel ? `<small>${escapeHtml(sourceLabel)}</small>` : ''}
        ${testCase.specPath ? `<small>Spec: ${escapeHtml(testCase.specPath)}</small>` : ''}
      </div>
      <div class="button-row">
        <button class="button" type="button" data-action="edit">${testCase.readOnly ? 'Copy' : 'Edit'}</button>
        <button class="button" type="button" data-action="suite">Add to Suite</button>
      </div>
    `;
    item.querySelector('[data-action="edit"]').addEventListener('click', () => editCase(testCase.id));
    item.querySelector('[data-action="suite"]').addEventListener('click', () => selectCaseInSuite(testCase.id));
    container.append(item);
  }
}

function caseSourceLabel(testCase) {
  if (testCase.source === 'repository-yaml') {
    return `Repository YAML${testCase.sourcePath ? ` | ${testCase.sourcePath}` : ''}`;
  }
  return testCase.readOnly ? 'Read-only' : 'UI case';
}

function filterItems(items, query, fieldsForItem) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    fieldsForItem(item)
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(normalizedQuery))
  );
}

function renderSuitesList() {
  const container = $('#tm-suites-list');
  container.innerHTML = '';
  if (state.testManagement.suites.length === 0) {
    container.innerHTML = '<div class="entity-item"><span>No test suites yet</span></div>';
    return;
  }

  for (const suite of state.testManagement.suites) {
    const item = document.createElement('div');
    item.className = 'entity-item';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(suite.id)} ${escapeHtml(suite.name)}</strong>
        <small>${suite.caseIds.length} cases</small>
      </div>
      <div class="button-row">
        <button class="button" type="button" data-action="edit">Edit</button>
        <button class="button" type="button" data-action="run">Run</button>
      </div>
    `;
    item.querySelector('[data-action="edit"]').addEventListener('click', () => editSuite(suite.id));
    item.querySelector('[data-action="run"]').addEventListener('click', () => seedRunFromSuite(suite.id));
    container.append(item);
  }
}

function renderRunsList() {
  const container = $('#tm-runs-list');
  container.innerHTML = '';
  if (state.testManagement.runs.length === 0) {
    container.innerHTML = '<div class="entity-item"><span>No test runs yet</span></div>';
    return;
  }

  for (const run of state.testManagement.runs) {
    const item = document.createElement('div');
    item.className = `entity-item ${state.selectedRunId === run.id ? 'is-selected' : ''}`;
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(run.id)} ${escapeHtml(run.name)}</strong>
        <small>${escapeHtml(run.status)} | ${run.caseIds.length} cases${run.environment ? ` | ${escapeHtml(run.environment)}` : ''}</small>
      </div>
      <button class="button" type="button">Open</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      state.selectedRunId = run.id;
      renderRunsList();
      renderSelectedRun();
    });
    container.append(item);
  }
}

function renderSelectedRun() {
  const run = selectedRun();
  const title = $('#tm-selected-run');
  const container = $('#tm-run-results');
  container.innerHTML = '';

  if (!run) {
    title.textContent = 'No run selected';
    return;
  }

  title.textContent = `${run.id} | ${run.status}`;
  for (const caseId of run.caseIds) {
    const testCase = state.testManagement.cases.find((candidate) => candidate.id === caseId);
    const result = run.results[caseId] || { status: 'untested', comment: '' };
    const item = document.createElement('div');
    item.className = 'run-result-item';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(caseId)} ${escapeHtml(testCase?.title || 'Unknown case')}</strong>
        <small>${escapeHtml(testCase?.testPath || testCase?.area || '')}</small>
      </div>
      <select>
        <option value="untested">Untested</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
        <option value="blocked">Blocked</option>
        <option value="skipped">Skipped</option>
      </select>
      <input type="text" placeholder="Comment" value="${escapeAttribute(result.comment || '')}" />
      <button class="button" type="button">Save</button>
    `;
    const select = item.querySelector('select');
    const comment = item.querySelector('input');
    select.value = result.status;
    item.querySelector('button').addEventListener('click', () => saveRunResult(run.id, caseId, select.value, comment.value));
    container.append(item);
  }
}

async function previewFile(scope, filePath) {
  try {
    const response = await fetch(`/api/file?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(filePath)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) {
      renderLog(state.activeTab, result.error || 'Could not preview file');
      return;
    }
    $('#preview-title').textContent = result.file.label;
    $('#preview-content').textContent = result.content;
    $('#preview-dialog').showModal();
  } catch (error) {
    renderLog(state.activeTab, `Preview failed: ${error.message}`);
  }
}

function renderHistory(history) {
  const container = $('#history');
  container.innerHTML = '';
  if (!history.length) {
    container.innerHTML = '<div class="history-item"><code>No runs yet</code></div>';
    return;
  }

  for (const run of history) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const left = document.createElement('div');
    left.innerHTML = `<code>${escapeHtml(run.kind)}</code><br><small>${escapeHtml(run.createdAt)}</small>`;
    const right = document.createElement('div');
    right.innerHTML = `<small>${run.ok ? 'OK' : 'Failed'} | ${Math.round((run.durationMs || 0) / 100) / 10}s</small>`;
    item.append(left, right);
    container.append(item);
  }
}

function renderLog(scope, text) {
  const log = $(`#${scope}-log`);
  if (log) {
    log.textContent = text;
  }
}

function applyTaskMetadata(scope, metadata) {
  if (!metadata) {
    return;
  }

  if (scope === 'spec') {
    if (metadata.taskPath) state.specTaskPath = metadata.taskPath;
    if (metadata.targetTestFile) $('#spec-target').value = metadata.targetTestFile;
    if (metadata.specPath) {
      $('#spec-path').value = metadata.specPath;
      renderSpecSelect();
    }
    if (metadata.generationMode) $('#spec-mode').value = metadata.generationMode;
  }

  if (scope === 'recording') {
    if (metadata.taskPath) state.recordingTaskPath = metadata.taskPath;
    if (metadata.targetTestFile) $('#recording-target').value = metadata.targetTestFile;
    if (metadata.recordingPath) $('#recording-path').value = metadata.recordingPath;
  }
}

function editCase(caseId) {
  const testCase = state.testManagement.cases.find((candidate) => candidate.id === caseId);
  if (!testCase) {
    return;
  }

  $('#tm-case-id').value = testCase.readOnly ? '' : testCase.id;
  $('#tm-case-title').value = testCase.title;
  $('#tm-case-area').value = testCase.area || '';
  $('#tm-case-priority').value = testCase.priority || 'medium';
  $('#tm-case-status').value = testCase.status || 'draft';
  $('#tm-case-automation').value = testCase.automation || 'candidate';
  $('#tm-case-test-path').value = testCase.testPath || '';
  $('#tm-case-spec-path').value = testCase.specPath || '';
  $('#tm-case-recording-path').value = testCase.recordingPath || '';
  $('#tm-case-tags').value = (testCase.tags || []).join(', ');
  $('#tm-case-preconditions').value = testCase.preconditions || '';
  $('#tm-case-steps').value = testCase.steps || '';
  $('#tm-case-expected').value = testCase.expectedResult || '';
  if (testCase.readOnly) {
    renderLog('management', `Copied read-only case ${testCase.id} into the editable form.`);
  }
  $('#tm-case-title').focus();
}

function editSuite(suiteId) {
  const suite = state.testManagement.suites.find((candidate) => candidate.id === suiteId);
  if (!suite) {
    return;
  }

  $('#tm-suite-id').value = suite.id;
  $('#tm-suite-name').value = suite.name;
  $('#tm-suite-description').value = suite.description || '';
  setSelectedValues('#tm-suite-cases', suite.caseIds);
  $('#tm-suite-name').focus();
}

function selectCaseInSuite(caseId) {
  setSelectedValues('#tm-suite-cases', [...selectedValues('#tm-suite-cases'), caseId]);
  $('#tm-suite-name').focus();
}

function seedRunFromSuite(suiteId) {
  const suite = state.testManagement.suites.find((candidate) => candidate.id === suiteId);
  if (!suite) {
    return;
  }

  $('#tm-run-suite').value = suite.id;
  $('#tm-run-name').value = `${suite.name} run`;
  setSelectedValues('#tm-run-cases', []);
  $('#tm-run-name').focus();
}

async function saveRunResult(runId, caseId, status, comment) {
  const result = await postJson(
    '/api/test-management/run-result',
    {
      runId,
      caseId,
      status,
      comment
    },
    'management'
  );
  if (!result.ok) {
    return;
  }
  applyTestManagementData(result.data);
}

function resetCaseForm() {
  $('#tm-case-form').reset();
  $('#tm-case-id').value = '';
}

function resetSuiteForm() {
  $('#tm-suite-form').reset();
  $('#tm-suite-id').value = '';
}

function resetRunForm() {
  $('#tm-run-form').reset();
  setSelectedValues('#tm-run-cases', []);
}

function selectedRun() {
  return state.testManagement.runs.find((run) => run.id === state.selectedRunId);
}

function fillDatalist(selector, files) {
  const datalist = $(selector);
  if (!datalist) {
    return;
  }
  datalist.innerHTML = '';
  for (const file of files) {
    const option = document.createElement('option');
    option.value = selector === '#tm-generated-tests' ? file.label : file.path;
    option.label = file.label;
    datalist.append(option);
  }
}

function fillSelect(selector, options) {
  const select = $(selector);
  if (!select) {
    return;
  }

  const selected = selectedValues(selector);
  select.innerHTML = '';
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    element.selected = selected.includes(option.value);
    select.append(element);
  }
}

function switchTab(tabName) {
  const button = $(`.tab[data-tab="${tabName}"]`);
  if (button) {
    button.click();
  }
}

function setBusy(isBusy) {
  $$('button').forEach((button) => {
    // Leave the escape-hatch controls usable so a long/hung run can be cancelled
    // and the view can still be refreshed.
    if (button.id === 'cancel-run' || button.id === 'refresh-state') {
      return;
    }
    button.disabled = isBusy;
  });
  const cancel = $('#cancel-run');
  if (cancel) {
    cancel.hidden = !isBusy;
  }
}

async function cancelActiveRun() {
  try {
    await fetch('/api/cancel', { method: 'POST' });
  } catch (error) {
    // Still abort the client-side request below even if the cancel call fails.
  }
  if (state.activeController) {
    state.activeController.abort();
  }
}

function setStatus(kind, text) {
  const status = $('#active-status');
  status.textContent = text;
  status.classList.toggle('is-running', kind === 'running');
  status.classList.toggle('is-ok', kind === 'ok');
  status.classList.toggle('is-error', kind === 'error');
}

function valueOf(selector) {
  return $(selector).value.trim();
}

function linesOf(selector) {
  return valueOf(selector)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitList(value) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function checkedValues(name) {
  return $$(`input[name="${name}"]:checked`).map((input) => input.value);
}

function selectedValues(selector) {
  const select = $(selector);
  return select ? Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean) : [];
}

function setSelectedValues(selector, values) {
  const wanted = new Set(values);
  $$(selector.includes(' ') ? selector : `${selector} option`).forEach((option) => {
    option.selected = wanted.has(option.value);
  });
}

function emptyTestManagement() {
  return {
    cases: [],
    suites: [],
    runs: [],
    counters: {
      case: 0,
      suite: 0,
      run: 0
    }
  };
}

function normalizeTestManagement(data) {
  const empty = emptyTestManagement();
  if (!data || typeof data !== 'object') {
    return empty;
  }

  return {
    cases: Array.isArray(data.cases) ? data.cases : [],
    suites: Array.isArray(data.suites) ? data.suites : [],
    runs: Array.isArray(data.runs) ? data.runs : [],
    counters: data.counters || empty.counters
  };
}

function compactPath(value) {
  if (value.length <= 34) {
    return value;
  }
  return `...${value.slice(-31)}`;
}

function titleFromPath(filePath) {
  const name = filePath.split('/').pop()?.replace(/\.spec\.ts$/, '').replace(/[-_]+/g, ' ') || 'Generated test case';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function suggestedTargetForSpec(spec) {
  const baseName = spec.title || spec.flowId || spec.path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'generated-test';
  return `tests/regression/${slugify(baseName)}.spec.ts`;
}

function nextSpecPath(content) {
  const base = slugify(specNameFromContent(content) || 'new-flow');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `specs/ui-created/${base}-${timestamp}.md`;
}

function specNameFromContent(content) {
  const flowTitleMatch = content.match(/^#\s*Flow:\s*(.+)$/im);
  if (flowTitleMatch?.[1]) {
    return flowTitleMatch[1];
  }

  const flowIdMatch = content.match(/\|\s*Flow ID\s*\|\s*([^|\n]+?)\s*\|/i);
  if (flowIdMatch?.[1]) {
    return flowIdMatch[1];
  }

  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch?.[1] || '';
}

function metadataValue(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content).match(new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`, 'i'));
  return match?.[1]?.trim() || '';
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'new-flow';
}

function escapeAttribute(value) {
  return escapeHtml(String(value)).replace(/`/g, '&#096;');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return replacements[char];
  });
}
