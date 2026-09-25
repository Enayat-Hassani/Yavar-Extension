import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicWebUrl } from '../src/utils/net.js';

test('allows public http(s) pages', () => {
  for (const u of ['https://example.com/a?b=1', 'http://en.wikipedia.org/wiki/X', 'https://8.8.8.8/', 'https://[2606:4700::1111]/']) {
    assert.equal(isPublicWebUrl(u), true, u);
  }
});

test('blocks local, private and non-web targets', () => {
  const blocked = [
    'http://localhost:8722/health', 'http://app.localhost/', 'http://printer.local/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://10.0.0.5/',
    'http://172.20.1.1/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/',
    'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://intranet/', 'http://metadata.google.internal/',
    'http://localhost./', 'http://printer.local./', 'http://metadata.google.internal./',
    'file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'not a url'
  ];
  for (const u of blocked) assert.equal(isPublicWebUrl(u), false, u);
});
