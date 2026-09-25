import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableMarkdown, captureLabel, captureMarkdown, hasCaptureText } from '../src/utils/capture.js';

test('tableMarkdown pads short rows and escapes pipes', () => {
  assert.equal(tableMarkdown([['Name', 'Score'], ['A|B', '9'], ['C']]),
    '| Name | Score |\n| --- | --- |\n| A\\|B | 9 |\n| C |  |');
  assert.equal(tableMarkdown([]), '');
});

test('labels say what was captured', () => {
  assert.equal(captureLabel({ rows: [['a', 'b', 'c'], ['d', 'e']] }), 'Table · 2×3');
  assert.equal(captureLabel({ tag: 'p', text: 'one two  three' }), 'Paragraph · 3 words');
  assert.equal(captureLabel({ tag: 'button', text: 'Save changes' }), 'Button: Save changes');
  assert.equal(captureLabel({ tag: 'a', text: 'A very long link text that keeps going on' }), 'Link: A very long link text that…');
  assert.equal(captureLabel({ mode: 'area', text: '' }), 'Screenshot');
  assert.equal(captureLabel({ mode: 'area', text: 'hello world' }), 'Area · 2 words');
  assert.equal(captureLabel({ tag: 'canvas' }), 'Chart or drawing');
  assert.equal(captureLabel(null), 'Screenshot');
});

test('only a picture is not worth a text attachment', () => {
  assert.equal(hasCaptureText({ mode: 'area', text: '  ', rows: [], links: [], images: [{ alt: '', src: 'x' }] }), false);
  assert.equal(hasCaptureText({ images: [{ alt: 'Revenue chart' }] }), true);
  assert.equal(hasCaptureText({ html: '<button>x</button>' }), true);
});

test('markdown carries the source, table instead of its text, links, alts and html', () => {
  const md = captureMarkdown({
    tag: 'table', url: 'https://ex.com/r', title: 'Results', heading: 'Q3',
    text: 'Name Score A 9', rows: [['Name', 'Score'], ['A', '9']],
    links: [{ text: 'More', href: 'https://ex.com/m' }], images: [{ alt: 'Logo' }, { alt: '' }],
    html: '<table>…</table>'
  });
  assert.match(md, /^# Captured from "Results"\n\nhttps:\/\/ex\.com\/r\n\nUnder the heading: Q3/);
  assert.match(md, /## Table\n\n\| Name \| Score \|/);
  assert.doesNotMatch(md, /## Text/);
  assert.match(md, /- \[More\]\(https:\/\/ex\.com\/m\)/);
  assert.match(md, /## Images\n\n- Logo\n\n/);
  assert.match(md, /```html\n<table>…<\/table>\n```/);
});
