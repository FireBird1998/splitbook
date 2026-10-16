// A typed view of the few vendored kit functions the CLI calls. The kit is plain JavaScript whose
// inferred types are narrower than its real contract (defaults like `= []` infer as never[]).
import * as isoKit from '../vendor/anatomy/kit/iso-kit.mjs';
import * as auditKit from '../vendor/anatomy/kit/audit.mjs';

export interface Plate {
  fig: string;
  title: string;
  hint?: string;
  readout?: string;
  caption?: string;
  body: string;
}
export interface Page {
  title: string;
  theme: 'light' | 'dark';
  body: string;
  script?: string;
  width?: number;
}
type AuditResult = { readonly __audit: unique symbol };

export const ISO_CSS = isoKit.ISO_CSS as string;
export const plateHtml = isoKit.plateHtml as unknown as (plate: Plate) => string;
export const pageHtml = isoKit.pageHtml as unknown as (page: Page) => string;
export const audit = auditKit.audit as unknown as (
  recorder: unknown,
  projection: unknown,
) => AuditResult;
export const failures = auditKit.failures as unknown as (result: AuditResult) => number;
export const report = auditKit.report as unknown as (result: AuditResult) => string;
