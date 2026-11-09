// GitHub-forbindelsen i toppen af /studie/. Token'et bliver liggende i browseren.
import { forgetToken, getSettings, normalizeRepo, saveSettings, testConnection } from './github';
import { $, setBusy, setStatus } from './shared';

const token = $('#gh-token') as HTMLInputElement;
const repo = $('#gh-repo') as HTMLInputElement;
const branch = $('#gh-branch') as HTMLInputElement;
const status = $('#gh-status') as HTMLElement;
const save = $('#gh-save') as HTMLButtonElement;
const test = $('#gh-test') as HTMLButtonElement;
const forget = $('#gh-forget') as HTMLButtonElement;

const settings = getSettings();
token.value = settings.token;
repo.value = settings.repo;
branch.value = settings.branch;
if (settings.token) setStatus(status, `Token gemt i denne browser · ${settings.repo} (${settings.branch})`, 'ok');

save.addEventListener('click', () => {
  if (!token.value.trim()) {
    setStatus(status, 'Indsæt et GitHub-token, før du gemmer.', 'error');
    return;
  }
  saveSettings({ token: token.value, repo: repo.value, branch: branch.value });
  repo.value = normalizeRepo(repo.value);
  branch.value = branch.value.trim() || 'main';
  setStatus(status, `Gemt i denne browser · ${repo.value} (${branch.value})`, 'ok');
});

test.addEventListener('click', async () => {
  setBusy(test, true);
  setStatus(status, 'Tester forbindelsen …', 'busy');
  try {
    saveSettings({ token: token.value, repo: repo.value, branch: branch.value });
    setStatus(status, await testConnection(), 'ok');
  } catch (error) {
    setStatus(status, (error as Error).message, 'error');
  } finally {
    setBusy(test, false);
  }
});

forget.addEventListener('click', () => {
  forgetToken();
  token.value = '';
  setStatus(status, 'Token er glemt i denne browser.', 'info');
});
