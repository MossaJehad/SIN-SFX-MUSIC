import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Resonance SFX - End-to-End Application Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads the application and displays Acorn layout and privacy notice', async ({ page }) => {
    // Check title
    await expect(page).toHaveTitle(/Resonance SFX/i);

    // Check header brand
    const headerTitle = page.locator('.acorn-app-header__title');
    await expect(headerTitle).toContainText('Resonance SFX');

    // Check privacy notice is visible
    const privacyNotice = page.locator('.acorn-privacy-banner');
    await expect(privacyNotice).toBeVisible();
    await expect(privacyNotice).toContainText('Local-First Guarantee');

    // Check 3 workspace areas are present in DOM
    await expect(page.locator('section[aria-label="Original Audio Section"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Procedural Synthesis Section"]')).toBeVisible();
  });

  test('switches between light and dark themes', async ({ page }) => {
    const html = page.locator('html');
    const themeButton = page.locator('button[aria-label^="Switch to"]');

    const initialTheme = await html.getAttribute('data-theme');
    expect(initialTheme).toBeTruthy();

    // Click theme toggle
    await themeButton.click();
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);

    // Toggle back
    await themeButton.click();
    const revertedTheme = await html.getAttribute('data-theme');
    expect(revertedTheme).toBe(initialTheme);
  });

  test('loads a built-in example sound effect', async ({ page }) => {
    const exampleSelector = page.locator('#example-selector');

    // Select Laser example
    await exampleSelector.selectOption('laser');

    // Verify recipe title in layer editor
    const layerNameInput = page.locator('#layer-name-input');
    await expect(layerNameInput).toHaveValue(/Saw Sweep Down/i);

    // Verify category badge shows Combat
    await expect(page.locator('.procedural-editor-panel')).toContainText('Combat');
  });

  test('plays a procedural sound effect', async ({ page }) => {
    const playButton = page.locator('button[aria-label*="procedural sound"]');
    await expect(playButton).toBeVisible();

    // Trigger playback
    await playButton.click();

    // Button should show Stop while playing
    await expect(playButton).toContainText('Stop');
  });

  test('edits a synthesis parameter and updates procedural recipe', async ({ page }) => {
    // Select first layer name input
    const layerNameInput = page.locator('#layer-name-input');
    await layerNameInput.fill('Super Custom Laser');

    // Verify the layer list reflects the new name
    const layerItem = page.locator('.acorn-layer-item--selected .layer-name');
    await expect(layerItem).toHaveText('Super Custom Laser');
  });

  test('uploads audio file, analyzes it, and generates procedural approximation', async ({
    page,
  }) => {
    const testFilePath = path.resolve(process.cwd(), 'e2e/test-assets/laser-test.wav');

    // File input
    const fileInput = page.locator('input[aria-label="Upload Audio File"]');
    await fileInput.setInputFiles(testFilePath);

    // Verify original panel displays decoded metadata
    await expect(page.locator('.meta-val.filename')).toContainText('laser-test.wav');
    await expect(page.locator('.analysis-title')).toBeVisible();

    // Click "Generate Procedural Version"
    const generateButton = page.locator('button:has-text("Generate Procedural Version")');
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // Wait for optimization and approximation score to appear
    const scoreBadge = page.locator('.score-number');
    await expect(scoreBadge).toBeVisible({ timeout: 15000 });
    await expect(scoreBadge).not.toHaveText('N/A');

    // Verify approximation score card has metrics
    await expect(page.locator('.approximation-card')).toContainText('Envelope Contour Match');
  });

  test('triggers JSON export download', async ({ page }) => {
    // Setup download listener
    const downloadPromise = page.waitForEvent('download');

    // Click JSON Recipe download button
    const jsonExportBtn = page.locator('button:has-text("JSON Recipe")');
    await jsonExportBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.sfx\.json$/);
  });

  test('opens and closes the About / Privacy dialog', async ({ page }) => {
    const aboutBtn = page.locator('button[aria-label="About and privacy information"]');
    await aboutBtn.click();

    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('What this MVP does');
    await expect(dialog).toContainText('Mozilla Public License');

    // Close via close button
    const closeBtn = page.locator('.acorn-dialog__close-btn');
    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
  });
});
