import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { collectAssetRefs, extensionFor, groupByUrl, joinPath, localize, targetsFor } from '../lib/assets.js';

describe('collectAssetRefs', () => {
  test('finds a URL nested in objects', () => {
    const data = { settings: { background: { img: 'http://example.com/bg.png' } } };
    const refs = collectAssetRefs(data, ['settings.background.img']);

    assert.equal(refs.length, 1);
    assert.equal(refs[0].url, 'http://example.com/bg.png');
    assert.equal(refs[0].name, 'settings-background-img');
  });

  test('names assets in an array of objects by 1-based index', () => {
    const data = {
      stories: [{ img: 'http://example.com/1.jpg' }, { img: 'http://example.com/2.jpg' }]
    };
    const refs = collectAssetRefs(data, ['stories.img']);

    assert.deepEqual(
      refs.map((r) => r.name),
      ['stories-1-img', 'stories-2-img']
    );
  });

  test('walks a JSON document that is itself an array', () => {
    const data = [{ imagePath: 'http://example.com/1.jpg' }, { imagePath: 'http://example.com/2.jpg' }];
    const refs = collectAssetRefs(data, ['imagePath']); // no field name sits above the list

    assert.deepEqual(
      refs.map((r) => r.name),
      ['1-imagePath', '2-imagePath']
    );
  });

  test('finds URLs in an array of strings at the leaf', () => {
    const data = { otherImgs: ['http://example.com/a.jpg', 'http://example.com/b.jpg'] };
    const refs = collectAssetRefs(data, ['otherImgs']);

    assert.deepEqual(
      refs.map((r) => r.name),
      ['otherImgs-1', 'otherImgs-2']
    );
  });

  test('skips missing, null, and empty fields', () => {
    const data = { a: null, b: '', stories: [{ img: 'http://example.com/1.jpg' }, { title: 'no img' }] };
    const refs = collectAssetRefs(data, ['a', 'b', 'missing.deeply.nested', 'stories.img']);

    assert.equal(refs.length, 1);
    assert.equal(refs[0].url, 'http://example.com/1.jpg');
  });

  test('skips values that are not URLs, leaving them untouched', () => {
    const data = { title: 'Not a URL', img: 'http://example.com/1.jpg' };
    const refs = collectAssetRefs(data, ['title', 'img']);

    assert.deepEqual(
      refs.map((r) => r.url),
      ['http://example.com/1.jpg']
    );
  });
});

describe('groupByUrl', () => {
  test('fetches a repeated URL once, keeping every reference to it', () => {
    const refs = [
      { url: 'http://example.com/a.jpg', name: 'one' },
      { url: 'http://example.com/b.jpg', name: 'two' },
      { url: 'http://example.com/a.jpg', name: 'three' }
    ];
    const jobs = groupByUrl(refs);

    assert.equal(jobs.length, 2);
    assert.deepEqual(
      jobs[0].refs.map((r) => r.name),
      ['one', 'three']
    );
  });
});

describe('targetsFor', () => {
  test('names one file per ref, without touching the JSON', () => {
    const data = { stories: [{ img: 'http://example.com/1.jpg' }], hero: 'http://example.com/1.jpg' };
    const [job] = groupByUrl(collectAssetRefs(data, ['stories.img', 'hero']));

    const targets = targetsFor(job, 'jpg');

    assert.deepEqual(
      targets.map((t) => t.file),
      ['stories-1-img.jpg', 'hero.jpg']
    );
    assert.equal(data.hero, 'http://example.com/1.jpg', 'naming alone must not rewrite the JSON');
  });

  test('sanitizes names that would escape the assets folder', () => {
    const job = { refs: [{ container: {}, key: 'x', name: '../../etc/passwd' }] };
    const [target] = targetsFor(job, 'jpg');

    assert.equal(target.file, '.._.._etc_passwd.jpg');
  });
});

describe('localize', () => {
  test('points every ref at its local copy, relative to the JSON file', () => {
    const data = { stories: [{ img: 'http://example.com/1.jpg' }], hero: 'http://example.com/1.jpg' };
    const [job] = groupByUrl(collectAssetRefs(data, ['stories.img', 'hero']));

    for (const ref of job.refs) ref.pathDir = 'assets';
    localize(targetsFor(job, 'jpg'));

    assert.equal(data.stories[0].img, 'assets/stories-1-img.jpg');
    assert.equal(data.hero, 'assets/hero.jpg');
  });

  test('a download that is never localized keeps its remote URL', () => {
    const data = { hero: 'http://example.com/1.jpg' };
    const [job] = groupByUrl(collectAssetRefs(data, ['hero']));

    targetsFor(job, 'jpg'); // named, but the bytes never landed, so no localize()

    assert.equal(data.hero, 'http://example.com/1.jpg');
  });
});

describe('joinPath', () => {
  test('joins with / and drops empty segments', () => {
    assert.equal(joinPath('assets', 'hero.jpg'), 'assets/hero.jpg');
    assert.equal(joinPath('', 'hero.jpg'), 'hero.jpg');
  });
});

describe('extensionFor', () => {
  test('reads the extension from the URL path', () => {
    assert.equal(extensionFor('http://example.com/a/photo.JPG'), 'jpg');
  });

  test('ignores the query string', () => {
    assert.equal(extensionFor('http://example.com/photo.png?w=200&signature=abc'), 'png');
  });

  test('falls back to the content type when the URL has no extension', () => {
    assert.equal(extensionFor('http://example.com/asset/12345', 'image/webp; charset=binary'), 'webp');
  });

  test('falls back to .bin when nothing identifies the file', () => {
    assert.equal(extensionFor('http://example.com/asset/12345', 'application/octet-stream'), 'bin');
    assert.equal(extensionFor('http://example.com/asset/12345'), 'bin');
  });
});
