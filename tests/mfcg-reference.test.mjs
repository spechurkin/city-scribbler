import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMfcgReference, projectReferenceToPrototype} from '../src/io/mfcg-reference.js';

const cases = JSON.parse(await readFile(new URL('./fixtures/mfcg-reference-cases.json', import.meta.url)));

test('reference links retain every exact seed and numeric size without coercion to presets', () => {
    for (const fixture of cases) {
        const reference = parseMfcgReference(fixture.url), params = new URL(fixture.url).searchParams;
        assert.equal(reference.seed, params.get('seed'));
        assert.equal(reference.size, Number(params.get('size')));
        assert.equal(reference.name, params.get('name') || params.get('seed'));
        for (const key of ['population', 'sea', 'gates']) if (params.has(key)) assert.equal(reference.optional[key], Number(params.get(key)));
    }
});
test('flags remain independent and disabled temple, walls and external castle are not discarded', () => {
    const refs = cases.map(c => parseMfcgReference(c.url));
    assert.equal(refs[1].flags.temple, false);
    assert.equal(refs[1].flags.walls, false);
    assert.equal(refs[1].flags.shantytown, true);
    assert.equal(refs[4].flags.urban_castle, false);
    assert.equal(refs[4].flags.citadel, true);
});
test('long arbitrary seeds and future URL parameters survive parsing', () => {
    const r = parseMfcgReference('https://watabou.github.io/city-generator/?seed=123456789012345678901234567890&size=47&future=value');
    assert.equal(r.seed, '123456789012345678901234567890');
    assert.equal(r.size, 47);
    assert.equal(r.unrecognized.future, 'value');
    assert.equal(r.flags.temple, undefined);
});
test('prototype projection explicitly reports incompatibility instead of claiming exact reproduction', () => {
    for (const fixture of cases) {
        const reference = parseMfcgReference(fixture.url), result = projectReferenceToPrototype(reference);
        assert.equal(result.exact, false);
        assert.equal(result.options.seed, reference.seed);
        assert.ok(result.approximations.some(a => a.parameter === 'seed'));
        for (const key of ['urban_castle', 'shantytown', 'greens', 'hub']) if (reference.flags[key] !== undefined) assert.ok(result.approximations.some(a => a.parameter === key));
    }
});
test('malformed links and invalid numeric parameters are rejected', () => {
    for (const url of ['https://example.com/?size=61&seed=1', 'https://watabou.github.io/city-generator/?seed=1&size=NaN', 'https://watabou.github.io/city-generator/?seed=1&size=50&population=NaN']) assert.throws(() => parseMfcgReference(url));
});

test('legacy flags follow the client integer protocol and preserve noncanonical input', () => {
    for (const [raw, resolved] of [['0', false], ['1', true], ['-1', true], ['2', true], ['false', true], ['true', true], ['0.5', false], ['0x0', false], ['0x1', true]]) {
        const r = parseMfcgReference(`https://watabou.github.io/city-generator/?seed=117&size=24&hub=${raw}`);
        assert.equal(r.flags.hub, resolved, raw);
        assert.equal(new URL(r.url).searchParams.get('hub'), raw);
        if (!['0', '1'].includes(raw)) assert.deepEqual(r.nonCanonicalFlags.hub, {raw, resolved});
    }
});
