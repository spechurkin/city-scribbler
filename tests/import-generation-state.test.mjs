import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generationUiState} from '../src/generation/generation-ui-state.js';
import {DEFAULT_OPTIONS, generateCity} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {geometryFingerprint, importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {readGenerationForm, writeGenerationForm} from '../src/generation/generation-settings.js';

const controls = () => {
    const fields = new Map(Object.keys(DEFAULT_OPTIONS).map(key => [key, {value: '', checked: false}]));
    return {elements: {namedItem: key => fields.get(key)}};
};

for (const name of ['palwe', 'mugyoma', 'goldbrook', 'mpiyanga', 'woma', 'frampton', 'berford', 'hrošev']) test(`${name}: import without a seed stays editable and never acquires a placeholder/default seed on save/reopen`, async () => {
    const text = await readFile(new URL(`fixtures/mfcg/${name}.json`, import.meta.url), 'utf8'),
        city = parseProject(text, {name}).city, state = generationUiState(city);
    assert.equal(city.options.seed, null);
    assert.equal(city.options.size, null);
    assert.equal(state.options.seed, '');
    assert.equal(state.options.size, DEFAULT_OPTIONS.size);
    assert.equal(state.seedReadOnly, false);
    assert.equal(state.buildDisabled, false);
    assert.equal(state.randomDisabled, false);
    assert.equal(state.buildLabel, 'Построить новую карту');
    assert.match(state.seedHint, /В JSON нет исходного сида/);
    const restored = parseProject(serializeProject(city, {theme: 'ink'})).city;
    assert.equal(restored.options.seed, null);
    assert.equal(restored.options.size, null);
    assert.equal(geometryFingerprint(restored), geometryFingerprint(city));
});

test('the legacy imported sentinel is discarded rather than normalized into a generator default', async () => {
    const text = await readFile(new URL('fixtures/mfcg/woma.json', import.meta.url), 'utf8'),
        city = parseProject(text).city;
    const saved = JSON.parse(serializeProject(city, {}));
    saved.options = {seed: 'imported', size: 'city', castle: true, walls: true, density: 65};
    const restored = parseProject(JSON.stringify(saved)).city;
    assert.equal(restored.options.seed, null);
    assert.equal(restored.options.size, null);
    assert.equal(generationUiState(restored).options.seed, '');
});

test('an explicit real seed and numeric size in file metadata survive project restoration', async () => {
    const data = JSON.parse(await readFile(new URL('fixtures/mfcg/woma.json', import.meta.url))),
        metadata = data.features.find(f => f.id === 'values');
    Object.assign(metadata, {seed: '9876543210123', size: 57, population: 0, urban_castle: true});
    const city = importMfcgGeoJson(data), restored = parseProject(serializeProject(city, {})).city,
        state = generationUiState(restored);
    assert.equal(state.options.seed, '9876543210123');
    assert.equal(state.options.size, 57);
    assert.equal(state.options.population, 0);
    assert.equal(state.options.urban_castle, true);
    assert.match(state.seedHint, /Сид указан/);
    assert.deepEqual(restored.source.geojson, data);
});

test('building after a raw import uses the entered seed and keeps original imported geometry intact', async () => {
    const text = await readFile(new URL('fixtures/mfcg/woma.json', import.meta.url), 'utf8'),
        imported = parseProject(text).city, fingerprint = geometryFingerprint(imported);
    const form = controls();
    writeGenerationForm(form, generationUiState(imported).options);
    assert.throws(() => readGenerationForm(form), /числовой сид/);
    form.elements.namedItem('seed').value = '631780021981';
    form.elements.namedItem('size').value = '18';
    const recipe = readGenerationForm(form), busy = generationUiState(imported, {busy: true});
    assert.equal(busy.buildDisabled, true);
    assert.equal(busy.buildLabel, 'Строим город…');
    const generated = generateCity(recipe), idle = generationUiState(generated);
    assert.equal(generated.options.seed, '631780021981');
    assert.equal(generated.source.format, 'compatible');
    assert.equal(idle.buildDisabled, false);
    assert.equal(idle.seedReadOnly, false);
    assert.equal(idle.buildLabel, 'Построить по сиду');
    assert.equal(geometryFingerprint(imported), fingerprint);
});

test('a reference URL can start a new generation after import without leaving the form locked', async () => {
    const city = parseProject(await readFile(new URL('fixtures/mfcg/woma.json', import.meta.url), 'utf8')).city,
        form = controls();
    writeGenerationForm(form, generationUiState(city).options);
    form.elements.namedItem('seed').value = 'https://watabou.github.io/city-generator/?seed=831652997&size=19&citadel=0&urban_castle=0&plaza=0&temple=0&walls=0&shantytown=0&coast=0&river=0&greens=0&hub=0&gates=4&name=New';
    const next = generateCity(readGenerationForm(form));
    assert.equal(next.name, 'New');
    assert.equal(next.options.size, 19);
    assert.equal(next.options.seed, '831652997');
    assert.equal(generationUiState(next).buildDisabled, false);
});

test('invalid generation settings are rejected by both form and engine without changing the imported city', async () => {
    const city = parseProject(await readFile(new URL('fixtures/mfcg/woma.json', import.meta.url), 'utf8')).city,
        fingerprint = geometryFingerprint(city);
    const form = controls();
    writeGenerationForm(form, generationUiState(city).options);
    form.elements.namedItem('seed').value = '918377442';
    form.elements.namedItem('size').value = '201';
    assert.throws(() => readGenerationForm(form), /размер/);
    assert.throws(() => generateCity({...DEFAULT_OPTIONS, seed: '918377442', size: 201}), /размер/);
    const state = generationUiState(city, {busy: false});
    assert.equal(state.buildDisabled, false);
    assert.equal(state.randomDisabled, false);
    assert.equal(form.elements.namedItem('seed').value, '918377442');
    assert.equal(geometryFingerprint(city), fingerprint);
});
