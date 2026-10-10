import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Shared dialog has viewport-bounded internal scrolling and focus clearance',()=>{
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
 const block=css.match(/\[data-slot="dialog-content"\]\s*\{([^}]+)\}/)?.[1];
 assert.ok(block);assert.match(block,/max-height:\s*calc\(100vh - 2rem\)/);assert.match(block,/max-height:\s*calc\(100dvh - 2rem\)/);
 assert.ok(block.indexOf('100vh')<block.indexOf('100dvh'));assert.match(block,/overflow-y:\s*auto/);assert.match(block,/scroll-padding-block:\s*1rem/);assert.match(block,/overscroll-behavior-y:\s*contain/);
 assert.match(css,/\[data-slot="dialog-content"\] :is\(input, textarea, select, button, a, \[tabindex\]\)\s*\{\s*scroll-margin-block:\s*\.5rem/);
 const component=readFileSync(new URL('../components/ui/dialog.tsx',import.meta.url),'utf8');assert.match(component,/data-slot="dialog-content"/);assert.match(component,/DialogPrimitive.Content/);
});
