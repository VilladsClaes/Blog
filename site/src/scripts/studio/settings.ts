// Admin-adgangen i toppen af /studie/. Nøglen bliver kun liggende i denne fane.
import { forgetAdminKey, getAdminKey, saveAdminKey, testConnection } from './api';
import { $, setBusy, setStatus } from './shared';

const keyInput = $('#api-key') as HTMLInputElement;
const status = $('#api-status') as HTMLElement;
const save = $('#api-save') as HTMLButtonElement;
const test = $('#api-test') as HTMLButtonElement;
const forget = $('#api-forget') as HTMLButtonElement;

const key = getAdminKey();
keyInput.value = key;
if (key) setStatus(status, 'Admin-nøgle gemt i denne fane.', 'ok');

// Så virker gem-knappen også, selvom man bare indsætter nøglen og går videre.
keyInput.addEventListener('input', () => saveAdminKey(keyInput.value));

save.addEventListener('click', () => {
  if (!keyInput.value.trim()) {
    setStatus(status, 'Indsæt admin-nøglen, før du gemmer.', 'error');
    return;
  }
  saveAdminKey(keyInput.value);
  setStatus(status, 'Admin-nøglen er gemt i denne fane.', 'ok');
});

test.addEventListener('click', async () => {
  setBusy(test, true);
  setStatus(status, 'Tester forbindelsen …', 'busy');
  try {
    saveAdminKey(keyInput.value);
    setStatus(status, await testConnection(), 'ok');
  } catch (error) {
    setStatus(status, (error as Error).message, 'error');
  } finally {
    setBusy(test, false);
  }
});

forget.addEventListener('click', () => {
  forgetAdminKey();
  keyInput.value = '';
  setStatus(status, 'Admin-nøglen er glemt i denne fane.', 'info');
});
