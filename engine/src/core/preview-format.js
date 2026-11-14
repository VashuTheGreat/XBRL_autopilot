// MCA-style format settings of the preview (docs/14 Step 7): CSS layered over pdf-preview.js's base styles.
// Display only. The format object is `PreviewFormat` (basics.ts): { borders, boldHeadings, spacing }.

const SPACING = {
  compact: 'body { line-height: 1.2; } table.st th, table.st td { padding: 0 3px; } .mca p { padding: 6pt 0; }',
  normal: '',
  relaxed: 'body { line-height: 1.6; } table.st th, table.st td { padding: 3px 6px; } section.elr h2 { margin: 16px 0 6px; }',
};

/** CSS for a format; '' when there is none (the base styles, as before) */
export function previewFormatCss(format) {
  if (!format) return '';
  const css = [];
  if (format.borders) css.push('table.st { border-collapse: collapse; } table.st th, table.st td { border: 1px solid #999; }');
  if (format.boldHeadings) css.push('h2, h3, .tblhead, table.st tr.ab td, table.st thead th { font-weight: bold; }');
  css.push(SPACING[format.spacing] || '');
  return css.filter(Boolean).join('\n');
}
