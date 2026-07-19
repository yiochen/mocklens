import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Device } from './types.js';

export interface PageErrorEvent {
  message: string;
  stack: string;
}

export interface ConsoleErrorEvent {
  text: string;
  url: string;
}

export interface RequestEvent {
  method: string;
  url: string;
  resourceType: string;
}

export interface FailedRequestEvent extends RequestEvent {
  failure: string;
}

export interface CollectedEvents {
  pageErrors: PageErrorEvent[];
  consoleErrors: ConsoleErrorEvent[];
  requests: RequestEvent[];
  failedRequests: FailedRequestEvent[];
}

export interface OpenedScreen {
  page: Page;
  context: BrowserContext;
  events: CollectedEvents;
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/**
 * Open a screen in a fresh BrowserContext + Page (deterministic state per
 * screen/device pair). All instrumentation is attached before navigation.
 * deviceScaleFactor: 2 for crisp screenshots, 1 for validation.
 */
export async function openScreenPage(
  browser: Browser,
  htmlFile: string,
  device: Device,
  deviceScaleFactor: number,
): Promise<OpenedScreen> {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor,
  });
  const page = await context.newPage();

  const events: CollectedEvents = { pageErrors: [], consoleErrors: [], requests: [], failedRequests: [] };
  page.on('pageerror', (err: Error) => {
    events.pageErrors.push({ message: err.message, stack: err.stack ?? '' });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      events.consoleErrors.push({ text: msg.text(), url: msg.location().url });
    }
  });
  page.on('request', (req) => {
    events.requests.push({ method: req.method(), url: req.url(), resourceType: req.resourceType() });
  });
  page.on('requestfailed', (req) => {
    events.failedRequests.push({
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      failure: req.failure()?.errorText ?? '',
    });
  });

  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  // Small settle wait; file:// pages finish fast, so cap networkidle hard.
  await page.waitForTimeout(100);
  await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

  return { page, context, events };
}
