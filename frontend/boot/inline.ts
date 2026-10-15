import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Inline the first frame so it never waits for application modules or CSS. */
export function inlineBootScreen(root: string) {
  const read = (file: string) => readFileSync(join(root, 'boot', file), 'utf8');
  return {
    name: 'paper-first-paint',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        return html
          .replace('<!-- paper-boot-style -->', `<style id="paper-boot-style">${read('screen.css')}</style>`)
          .replace('<!-- paper-boot-screen -->', read('screen.html'))
          .replace('<!-- paper-boot-script -->', `<script id="paper-boot-script">${read('screen.js')}</script>`);
      }
    }
  };
}
