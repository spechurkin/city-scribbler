import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

test('standalone CLI generates an arbitrary city while fixture and download directories are unreadable', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url)), temporary = path.join(root, 'tmp');
    await mkdir(temporary, {recursive: true});
    const output = await mkdtemp(path.join(temporary, 'standalone-test-')), prefix = path.join(output, 'city');
    const args = [
        '--permission',
        `--allow-fs-read=${path.join(root, 'src')}`,
        `--allow-fs-read=${path.join(root, 'node_modules')}`,
        `--allow-fs-read=${path.join(root, 'package.json')}`,
        `--allow-fs-write=${output}`,
        '--url=https://watabou.github.io/city-generator/?size=39&seed=3438976512349&coast=0&citadel=1&plaza=1&walls=1',
        '--housing=offset', '--forests=1', `--out=${prefix}`
    ];
    const result = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', timeout: 45000});
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const geometry = JSON.parse(await readFile(`${prefix}.json`, 'utf8')),
        svg = await readFile(`${prefix}.svg`, 'utf8');
    assert.equal(geometry.recipe.seed, '3438976512349');
    assert.equal(geometry.recipe.size, 39);
    assert.ok(geometry.experimental.housing.length > 100);
    assert.ok(geometry.experimental.fields.length > 0);
    assert.ok(geometry.experimental.specialBuildings.length > 0);
    assert.ok(geometry.experimental.forests.length > 0);
    assert.ok(geometry.experimental.treeCrowns.length > 0);
    assert.equal(geometry.completeness.fullySeedCompatible, false);
    assert.ok(svg.includes('layer-housing'));
    assert.ok(svg.includes('layer-fields'));
    assert.ok(svg.includes('layer-special-buildings'));
    assert.ok(svg.includes('layer-forests'));
    assert.ok(!svg.includes('NaN'));
});
