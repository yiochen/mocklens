export interface Device {
  name: string;
  width: number;
  height: number;
}

export interface Config {
  configFile: string;
  baseDir: string;
  screensDir: string;
  outDir: string;
  fullPage: boolean;
  devices: Device[];
  allowedExternalHosts: string[];
}

export type Severity = 'error' | 'warning';

export type FindingType =
  | 'document-overflow'
  | 'element-overflow-right'
  | 'element-overflow-left'
  | 'clipped-text'
  | 'broken-image'
  | 'page-error'
  | 'external-request'
  | 'fixed-bottom-cover'
  | 'fixed-overlay-cover';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  rect: Rect;
}

export interface Finding {
  type: FindingType;
  severity: Severity;
  suppressed: boolean;
  message: string;
  suggestion: string;
  element?: ElementInfo;
  coveredElement?: ElementInfo;
  overlap?: { width: number; height: number; area: number; scrollX: number; scrollY: number };
  detail?: string;
}

export interface ScreenReport {
  name: string;
  source: string;
  screenshot: string | null;
  device: string;
  viewport: { width: number; height: number };
  ok: boolean;
  findings: Finding[];
  counts: { error: number; warning: number; suppressed: number };
}

export interface Report {
  version: 2;
  tool: 'mocklens';
  scope: {
    command: 'validate' | 'check';
    coverage: 'FULL' | 'FILTERED';
    config: string;
    requested: { screens: string[]; devices: string[] };
    configured: { uniqueScreens: number; devices: number; combinations: number };
    covered: { uniqueScreens: number; devices: number; combinations: number };
  };
  screens: ScreenReport[];
  summary: {
    uniqueScreens: number;
    devices: number;
    combinations: number;
    errors: number;
    warnings: number;
    suppressed: number;
    ok: boolean;
  };
}

/** Round to 1 decimal place so rects/viewports are stable in JSON output. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
