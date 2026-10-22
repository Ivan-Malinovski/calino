import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = pathToFileURL(resolve('artifacts/category-styling.html')).href;

test('category rules combine, can be configured, saved, and restored', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const calendar = page.getByRole('region', { name: 'Live calendar preview' });
  const review = calendar.locator('.event').filter({ hasText: 'Review with Alex?' });
  await expect(review).toHaveClass(/handwriting/);
  await expect(review).toHaveClass(/sketch/);
  await expect(review.locator('svg.pen-loop')).toBeVisible();
  await expect(review.locator('svg.pen-loop path')).toHaveCount(2);
  await page.getByLabel('Use standard lettering everywhere').check();
  await expect(review).not.toHaveClass(/handwriting/);
  await page.getByLabel('Use standard lettering everywhere').uncheck();
  await page.getByLabel('Match any category').fill('NOT CONFIRMED');
  await expect(review).not.toHaveClass(/handwriting/);
  await expect(calendar.locator('.event').filter({ hasText: 'Studio visit' })).toHaveClass(/handwriting/);
  await page.getByLabel('Match any category').fill('maybe, not confirmed');
  await page.getByLabel('Enabled', { exact: true }).uncheck();
  await expect(review).not.toHaveClass(/handwriting/);
  await expect(review).toHaveClass(/sketch/);
  await page.getByLabel('Enabled', { exact: true }).check();
  await page.getByRole('button', { name: 'Move rule later' }).click();
  await expect(page.locator('#rules .rule').last()).toContainText('Tentative');
  await page.getByRole('article').filter({ hasText: 'Focus time' }).getByRole('button').click();
  await expect(calendar.locator('.event').filter({ hasText: 'Deep work' })).toHaveCSS('border-top-style', 'dashed');
  await page.getByRole('button', { name: 'Save preview', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved in this browser');
  await page.reload();
  await expect(page.locator('#rules')).toContainText('Focus time');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(calendar.locator('.agenda-row')).toHaveCount(12);
  // Wide agenda rows keep a compact loop around the event text.
  const cardBounds = await review.boundingBox();
  const loopBounds = await review.locator('.pen-loop').boundingBox();
  expect(loopBounds!.width).toBeLessThan(cardBounds!.width * 0.7);
  const titleBounds = await review.locator('.event-title').boundingBox();
  const timeBounds = await review.locator('.event-time').boundingBox();
  const categoryBounds = await review.locator('.category').boundingBox();
  expect(loopBounds!.y).toBeGreaterThan(timeBounds!.y + timeBounds!.height);
  expect(loopBounds!.y + loopBounds!.height).toBeLessThan(categoryBounds!.y);
  expect(loopBounds!.x).toBeLessThan(titleBounds!.x);
  expect(loopBounds!.x + loopBounds!.width).toBeGreaterThan(titleBounds!.x + titleBounds!.width);
  await expect(review).toHaveClass(/sketch/);
  await page.getByRole('button', { name: 'Dark preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Light preview' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#rules .rule')).toHaveCount(2);
  await expect(review).toHaveClass(/handwriting/);
  await expect(review).toHaveClass(/sketch/);
  expect(errors).toEqual([]);
});

test('mobile layout contains its wide calendar and keeps editor usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Plans have a personality.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByLabel('Match any category').fill('maybe');
  await expect(page.getByLabel('Match any category')).toHaveValue('maybe');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('.agenda-row')).toHaveCount(12);
});
