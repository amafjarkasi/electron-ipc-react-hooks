import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.join(__dirname, '..', 'example');
const electronPath = require('electron') as string;

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    executablePath: electronPath,
    cwd: exampleDir,
    args: ['.'],
    env: {
      ...process.env,
      E2E: '1',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('loads system info and greeting via nested IPC query', async () => {
  await expect(page.getByTestId('sys-platform')).not.toHaveText('', { timeout: 30_000 });
  await expect(page.getByTestId('hello-msg')).toContainText('Hello', { timeout: 30_000 });
});

test('shared store toggles theme', async () => {
  const theme = page.getByTestId('store-theme');
  await expect(theme).toContainText(/system|dark|light/);
  await page.getByTestId('toggle-theme').click();
  await expect(theme).toContainText(/dark|light/);
});

test('clock subscription streams data', async () => {
  await expect(page.getByTestId('clock-data')).not.toHaveText('Waiting for clock...', { timeout: 15_000 });
});

test('echo mutation reverses text', async () => {
  await page.getByTestId('echo-input').fill('abc');
  await page.getByTestId('echo-send').click();
  await expect(page.getByTestId('echo-result')).toContainText('cba', { timeout: 10_000 });
});

test('structured error and zod validation', async () => {
  await page.getByTestId('trigger-error').click();
  await expect(page.getByTestId('error-caught')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('profile-name').fill('ab');
  await page.getByTestId('save-profile').click();
  await expect(page.getByTestId('zod-error')).toContainText('BAD_REQUEST', { timeout: 10_000 });
});

test('batching returns three squares', async () => {
  await page.getByTestId('batch-trigger').click();
  await expect(page.getByTestId('batch-q1')).toContainText('4', { timeout: 10_000 });
  await expect(page.getByTestId('batch-q2')).toContainText('25');
  await expect(page.getByTestId('batch-q3')).toContainText('100');
});

test('infinite query loads more pages', async () => {
  await expect(page.getByTestId('infinite-list')).toBeVisible({ timeout: 15_000 });
  const before = await page.getByTestId('infinite-list').locator('div').count();
  await page.getByTestId('infinite-load-more').click();
  await expect.poll(async () => page.getByTestId('infinite-list').locator('div').count()).toBeGreaterThan(before);
});

test('channel stream completes', async () => {
  await page.getByTestId('channel-start').click();
  await expect(page.getByTestId('channel-logs')).toContainText('complete', { timeout: 30_000 });
});

test('abort cancels slow query UI', async () => {
  await page.getByTestId('slow-start').click();
  await expect(page.getByTestId('slow-result')).toBeVisible();
  await page.getByTestId('slow-cancel').click();
  await expect(page.getByTestId('slow-result')).toHaveCount(0);
});
