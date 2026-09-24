/*
 * Bundle the exhibit into one self-contained HTML file (CSS and scripts inlined),
 * so it can be emailed, dropped on a USB stick, or opened straight from disk.
 *
 *   node tools/build-single.mjs [out=dist/black-hole-exhibit.html] [--artifact]
 *
 * --artifact writes a fragment for hosts that supply their own <html>/<head>/<body> shell.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fragment = args.includes('--artifact');
const out = resolve(root, args.find((a) => !a.startsWith('--')) || 'dist/black-hole-exhibit.html');

let html = await readFile(join(root, 'index.html'), 'utf8');

html = await replaceAsync(html, /<link rel="stylesheet" href="(css\/[^"]+)">/g, async (_, href) => {
  const css = await readFile(join(root, href), 'utf8');
  return `<style>\n${css}\n</style>`;
});
html = await replaceAsync(html, /<script src="(js\/[^"]+)"><\/script>/g, async (_, src) => {
  const js = await readFile(join(root, src), 'utf8');
  // keep a closing script tag inside a string from ending the inline block early
  return `<script>\n/* ${src} */\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
});

if (fragment) {
  html = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/gi, '')
    .replace(/<\/?head>\s*/gi, '')
    .replace(/<\/?body>\s*/gi, '')
    .replace(/<meta charset[^>]*>\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  // the title must lead the file
  const title = html.match(/<title>[^<]*<\/title>\s*/)[0];
  html = title + html.replace(title, '');
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);

async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}
