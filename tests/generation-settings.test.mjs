import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_OPTIONS, generateCity, normalizeOptions} from '../src/generation/interactive-city.js';
import {
    generationHash,
    mfcgReferenceUrl,
    readGenerationForm,
    readGenerationLocation,
    writeGenerationForm
} from '../src/generation/generation-settings.js';
import {parseMfcgReference} from '../src/io/mfcg-reference.js';
import {buildTerrain} from '../src/compatible/terrain.js';

const references = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
const form = () => {
    const fields = new Map(Object.keys(DEFAULT_OPTIONS).map(key => [key, {value: '', checked: false}]));
    return {elements: {namedItem: key => fields.get(key)}};
};

test('new city form settings place castles inside the city while explicit outskirts settings survive', () => {
    for (const seed of ['1931200012', '798451', '891749']) for (const coast of [false, true]) {
        const controls = form();
        writeGenerationForm(controls, {...DEFAULT_OPTIONS, seed, coast});
        const options = normalizeOptions(readGenerationForm(controls)).options;
        const terrain = buildTerrain(options), castle = terrain.castle;
        assert.ok(castle);
        assert.notEqual(castle, terrain.plaza);
        for (const point of castle.polygon) for (const neighbor of terrain.mesh.cellsAt(point)) {
            assert.ok(neighbor.water || neighbor.urban, `${seed}/${coast}: castle touches the outskirts`);
        }
        const restored = readGenerationLocation(new URL(`http://localhost/${generationHash({options, name: 'Test'})}`));
        assert.equal(restored.options.urban_castle, true);
        controls.elements.namedItem('urban_castle').checked = false;
        const edgeOptions = normalizeOptions(readGenerationForm(controls)).options, edge = buildTerrain(edgeOptions);
        assert.ok(edge.castle.polygon.some(point => edge.mesh.cellsAt(point).some(cell => !cell.water && !cell.urban)));
        const saved = readGenerationLocation(new URL(`http://localhost/${generationHash({
            options: edgeOptions,
            name: 'Test'
        })}`));
        assert.equal(saved.options.urban_castle, false);
    }
});

for (const reference of references) test(`${reference.name}: source URL -> form -> generated city -> shared URL -> reopened city retains the entire recipe and geometry`, () => {
    const expected = generateCity({seed: reference.url}), parsed = normalizeOptions({seed: reference.url}),
        controls = form();
    writeGenerationForm(controls, parsed.options);
    const recipe = readGenerationForm(controls, {...parsed.source, name: parsed.name});
    const generated = generateCity(recipe);
    assert.deepEqual(generated.options, expected.options);
    assert.deepEqual(generated.generatedGeometry, expected.generatedGeometry);
    assert.equal(generated.name, reference.name);
    const saved = new URL(`http://127.0.0.1:4173/${generationHash(generated)}`),
        restored = generateCity(readGenerationLocation(saved).options);
    assert.deepEqual(restored.options, expected.options);
    assert.deepEqual(restored.generatedGeometry, expected.generatedGeometry);
    assert.equal(restored.name, reference.name);
    assert.equal(restored.source.referenceUrl, reference.url);
});

test('native query and fragment keys preserve size and aliases instead of filling them with UI defaults', () => {
    const source = '?size=43&seed=981635478&name=Example&citadel=0&urban_castle=1&plaza=0&temple=0&walls=0&shantytown=1&coast=1&river=1&greens=1&hub=1&gates=8&sea=0.736241';
    const canonical = normalizeOptions({seed: `https://watabou.github.io/city-generator/${source}`}).options;
    for (const url of [`http://localhost/${source}`, `http://localhost/#${source.slice(1)}`]) {
        const restored = readGenerationLocation(new URL(url));
        assert.deepEqual(normalizeOptions(restored.options).options, canonical);
    }
});

test('a source URL in the seed field works on submit without requiring a blur/change event', () => {
    const controls = form();
    writeGenerationForm(controls, DEFAULT_OPTIONS);
    const source = references[0].url;
    controls.elements.namedItem('seed').value = source;
    const expected = normalizeOptions({seed: source}), recipe = readGenerationForm(controls);
    assert.deepEqual(normalizeOptions(recipe).options, expected.options);
    assert.equal(recipe.name, expected.name);
    assert.equal(recipe.referenceUrl, source);
});

test('source provenance does not overwrite explicit edits after form or URL round trips', () => {
    const parsed = normalizeOptions({seed: references[0].url}), controls = form();
    writeGenerationForm(controls, parsed.options);
    controls.elements.namedItem('size').value = '44';
    controls.elements.namedItem('urban_castle').checked = false;
    controls.elements.namedItem('riverWidthScale').value = '1.73';
    const recipe = readGenerationForm(controls, parsed.source), city = generateCity(recipe),
        restored = readGenerationLocation(new URL(`http://localhost/${generationHash(city)}`));
    assert.equal(restored.options.size, 44);
    assert.equal(restored.options.urban_castle, false);
    assert.equal(restored.options.riverWidthScale, 1.73);
    assert.equal(restored.options.referenceUrl, references[0].url);
});

test('the reported wrong Palwe link really selects 34 cells and is never patched by seed or name', () => {
    const url = new URL('http://127.0.0.1:4173/#seed=892374508970549&size=34&density=65&castle=1&urbanCastle=0&market=1&temple=1&walls=1&shanty=0&river=1&coast=1&gardens=0&hub=1&gates=-1&sea=1.51&coastOffset=0&riverWidthScale=1&riverCurvature=1&port=1&fields=1&forest=1&name=Palwe');
    const {options} = readGenerationLocation(url);
    assert.equal(options.size, 34);
    assert.equal(options.urban_castle, false);
    assert.equal(options.greens, false);
    const controls = form();
    writeGenerationForm(controls, options);
    assert.deepEqual(normalizeOptions(readGenerationForm(controls)).options, normalizeOptions(options).options);
});

test('a new random seed replaces an imported text seed before validation and drops source identity', () => {
    const controls = form();
    writeGenerationForm(controls, {...DEFAULT_OPTIONS, seed: 'imported'});
    const recipe = readGenerationForm(controls, {
        seed: 'imported',
        name: 'Imported',
        url: references[0].url
    }, {seed: '89167024'});
    assert.equal(recipe.seed, '89167024');
    assert.equal(recipe.name, undefined);
    assert.equal(recipe.referenceUrl, undefined);
});

test('public settings and copied MFCG links use native parameter names and omit local density and display switches', () => {
    const legacy = new URL('http://localhost/#seed=566198536&size=61&density=75&castle=1&urbanCastle=1&market=1&shanty=0&gardens=0&river=1&coast=1&hub=1&sea=1.51&fields=0&forest=0&name=Test');
    const {options, view} = readGenerationLocation(legacy), native = mfcgReferenceUrl({options, name: 'Test'}),
        reference = parseMfcgReference(native),
        hash = new URLSearchParams(generationHash({options, name: 'Test'}).slice(1));
    assert.equal(options.citadel, true);
    assert.equal(options.urban_castle, true);
    assert.equal(options.plaza, true);
    assert.equal(options.greens, false);
    assert.equal(options.density, undefined);
    assert.equal(options.forest, undefined);
    assert.equal(view.layers.fields, false);
    assert.equal(view.layers.forest, false);
    assert.deepEqual(reference.unrecognized, {});
    assert.equal(reference.flags.urban_castle, true);
    assert.equal(reference.flags.greens, false);
    for (const key of ['castle', 'urbanCastle', 'market', 'shanty', 'gardens', 'density', 'fields', 'forest', 'port', 'coastOffset', 'riverCurvature', 'riverWidthScale']) assert.equal(hash.has(key), false, key);
    assert.deepEqual(normalizeOptions({seed: native}).options, normalizeOptions(options).options);
});

test('native parameter names win over legacy aliases and population survives form and URL transfer', () => {
    const {options} = normalizeOptions({
        seed: '981635478',
        citadel: false,
        castle: true,
        urban_castle: false,
        urbanCastle: true,
        population: 45678
    }), controls = form();
    assert.equal(options.citadel, false);
    assert.equal(options.urban_castle, false);
    writeGenerationForm(controls, options);
    const read = readGenerationForm(controls), saved = generationHash({options: read, name: 'Population'}),
        restored = readGenerationLocation(new URL(`http://localhost/${saved}`));
    assert.equal(restored.options.population, 45678);
    assert.throws(() => normalizeOptions({seed: '1', population: -1}), /Население/);
    assert.equal(normalizeOptions({seed: '1', population: ''}).options.population, null);
});

test('a pasted reference without scheme uses the same native parameters', () => {
    const full = references[0].url, bare = full.replace('https://', '');
    assert.deepEqual(normalizeOptions({seed: bare}).options, normalizeOptions({seed: full}).options);
});
