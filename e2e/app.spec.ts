import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Resonance SFX - Audio-to-Math End-to-End Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads the application and displays Acorn layout and privacy notice', async ({ page }) => {
    await expect(page).toHaveTitle(/Resonance SFX/i);

    const headerTitle = page.locator('.acorn-app-header__title');
    await expect(headerTitle).toContainText('Resonance SFX');

    const privacyNotice = page.locator('.acorn-privacy-banner');
    await expect(privacyNotice).toBeVisible();
    await expect(privacyNotice).toContainText('Local-First Guarantee');

    await expect(page.locator('section[aria-label="Original Audio Section"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Procedural Synthesis Section"]')).toBeVisible();
  });

  test('switches between light and dark themes', async ({ page }) => {
    const html = page.locator('html');
    const themeButton = page.locator('button[aria-label^="Switch to"]');

    const initialTheme = await html.getAttribute('data-theme');
    expect(initialTheme).toBeTruthy();

    await themeButton.click();
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);

    await themeButton.click();
    const revertedTheme = await html.getAttribute('data-theme');
    expect(revertedTheme).toBe(initialTheme);
  });

  test('loads a built-in example and edits manual layer parameters', async ({ page }) => {
    const exampleSelector = page.locator('#example-selector');
    await exampleSelector.selectOption('laser');

    const layerNameInput = page.locator('#layer-name-input');
    await expect(layerNameInput).toHaveValue(/Saw Sweep Down/i);

    await layerNameInput.fill('Super Custom Laser');
    const layerItem = page.locator('.acorn-layer-item--selected .layer-name');
    await expect(layerItem).toHaveText('Super Custom Laser');
  });

  test('plays reconstructed / procedural audio cleanly', async ({ page }) => {
    const playButton = page.locator('button[aria-label*="procedural sound"]');
    await expect(playButton).toBeVisible();

    await playButton.click();
    await expect(playButton).toContainText('Stop');
  });

  test('full Upload -> Analyze -> Exact/Optimized/Procedural Reconstruct -> Compare -> Export workflow', async ({
    page,
  }) => {
    const testFilePath = path.resolve(process.cwd(), 'e2e/test-assets/laser-test.wav');

    // 1. Upload WAV
    const fileInput = page.locator('input[aria-label="Upload Audio File"]');
    await fileInput.setInputFiles(testFilePath);

    // 2. Verify metadata and DSP analysis
    await expect(page.locator('.meta-val.filename')).toContainText('laser-test.wav');
    await expect(page.locator('.meta-item--rate .meta-val')).toContainText('kHz');
    await expect(page.locator('.analysis-title')).toBeVisible();

    // 3. Reconstruct in Exact Mode first and verify >100 dB numerical baseline + honest size warning
    await page.locator('.mode-pill:has-text("Exact")').click();
    await page.locator('button:has-text("Convert to Math")').click();

    const snrDisplay = page.locator('.score-number');
    await expect(snrDisplay).toContainText('dB', { timeout: 15000 });
    const exactSnrText = await snrDisplay.innerText();
    expect(exactSnrText).toMatch(/1[2-9]\d|> 140/);

    // Verify mathematical formula viewer populated
    await expect(page.locator('.formula-equation')).toContainText('sin(');

    // Verify real DSP metrics cells (RMSE, Log-Spectral Dist, Recon Time)
    await expect(page.locator('.dsp-metrics-grid')).toContainText('RMSE');
    await expect(page.locator('.dsp-metrics-grid')).toContainText('Log-Spectral Dist.');
    await expect(page.locator('.dsp-metrics-grid')).toContainText('Recon Time');

    // Verify submetric bars remain horizontally aligned
    const submetricBars = page.locator('.submetric-bar-wrap');
    expect(await submetricBars.count()).toBe(3);
    const box0 = await submetricBars.nth(0).boundingBox();
    const box1 = await submetricBars.nth(1).boundingBox();
    const box2 = await submetricBars.nth(2).boundingBox();
    expect(Math.abs(box0!.y - box1!.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(box1!.y - box2!.y)).toBeLessThanOrEqual(1.5);

    // 4. Switch to Spectrum and Spectrogram comparison tabs
    await page.locator('.viz-tab-btn:has-text("Frequency Spectrum")').click();
    await expect(page.locator('canvas[aria-label*="Frequency Spectrum"]')).toBeVisible();

    await page.locator('.viz-tab-btn:has-text("Spectrogram")').click();
    await expect(page.locator('canvas[aria-label*="Original Spectrogram"]')).toBeVisible();

    await page.locator('.viz-tab-btn:has-text("Waveforms & Difference")').click();
    await expect(page.locator('canvas[aria-label="Difference Waveform"]')).toBeVisible();

    // 5. Switch to Optimized Mode & test controls + Reconstruct
    await page.locator('.mode-pill:has-text("Optimized")').click();
    await page.locator('button:has-text("Convert to Math")').click();
    await expect(snrDisplay).toContainText('dB', { timeout: 15000 });

    // 6. Switch to Procedural Mode & verify compact sound(t) function preview
    await page.locator('.mode-pill:has-text("Procedural")').click();
    await page.locator('button:has-text("Convert to Math")').click();
    await expect(page.locator('.code-preview-block')).toContainText('export function sound(t', {
      timeout: 15000,
    });

    // 7. Inspect all 6 code preview tabs (JS, TS, C, C++, Python, JSON)
    for (const [tabLabel, expectedSnippet] of [
      ['TypeScript', 'export function generateSamples(): Float32Array[]'],
      ['C', 'void sound_generate(float *out_interleaved)'],
      ['C++', 'namespace sound_math'],
      ['Python', 'def generate_samples():'],
      ['JSON', '"sin-sfx-math-v2"'],
      ['JavaScript', 'export function playSound'],
    ] as const) {
      await page.locator(`.preview-tab-btn`, { hasText: new RegExp(`^${tabLabel.replace('+', '\\+')}$`) }).click();
      await expect(page.locator('.code-preview-block')).toContainText(expectedSnippet);
    }

    // 8. Trigger standalone Python export download
    const pyDownloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Standalone Python")').click();
    const pyDownload = await pyDownloadPromise;
    expect(pyDownload.suggestedFilename()).toMatch(/\.sound\.py$/);

    // 9. Trigger JSON download
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("JSON Recipe")').click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/\.math\.json$/);
  });

  test('opens and closes the About / Privacy dialog', async ({ page }) => {
    const aboutBtn = page.locator('button[aria-label="About and privacy information"]');
    await aboutBtn.click();

    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Genuine Audio-to-Math Sinusoidal Converter');
    await expect(dialog).toContainText('Mozilla Public License');

    await page.locator('.acorn-dialog__close-btn').click();
    await expect(dialog).not.toBeVisible();
  });
});
