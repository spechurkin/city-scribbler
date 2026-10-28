import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES} from '../src/editor/building-editor.js';
import {
    DEFAULT_OPTIONS,
    generateCity,
    normalizeOptions,
    recipeFromOptions
} from '../src/generation/interactive-city.js';
import {
    CUSTOM_COUNT_DEFAULTS,
    CUSTOM_OBJECT_COUNTS,
    customObjectCounts,
    customObjectLimit,
    FARM_KINDS,
    LARGE_OBJECT_KINDS,
    LODGING_KINDS
} from '../src/buildings/custom-object-settings.js';
import {
    generationHash,
    mfcgReferenceUrl,
    readGenerationForm,
    readGenerationLocation,
    syncCustomObjectControls,
    writeGenerationForm
} from '../src/generation/generation-settings.js';
import {attachCustomObjects, buildCustomObjects} from '../src/buildings/custom-objects.js';
import {rectangle} from '../src/core/geometry.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';

const zeroCounts = Object.fromEntries(Object.values(CUSTOM_OBJECT_COUNTS).map(key => [key, 0]));
const form = () => {
    const fields = new Map(Object.keys(DEFAULT_OPTIONS).map(key => [key, {value: '', checked: false, dataset: {}}]));
    return {elements: {namedItem: key => fields.get(key)}};
};

test('every custom type has one setting, size-based defaults grow monotonically, and large cities get many taverns', () => {
    const excluded = ['house', 'castle', 'temple', 'market', 'stall', 'special', 'guardhouse'];
    assert.deepEqual(Object.keys(CUSTOM_OBJECT_COUNTS).sort(), Object.keys(BUILDING_TYPES).filter(kind => !excluded.includes(kind)).sort());
    assert.equal(new Set(Object.values(CUSTOM_OBJECT_COUNTS)).size, Object.keys(CUSTOM_OBJECT_COUNTS).length);
    for (const kind of Object.keys(CUSTOM_OBJECT_COUNTS)) {
        let previous = 0;
        for (const size of [6, 16, 34, 60, 92, 200]) {
            const count = customObjectCounts({size})[kind];
            assert.ok(count >= previous && count <= customObjectLimit(kind, size), `${kind}/${size}`);
            previous = count;
        }
    }
    assert.equal(customObjectCounts({size: 92}).tavern, 10);
    assert.equal(customObjectCounts({size: 200}).tavern, 20);
});

test('counts validate, clamp to city capacity and preserve the minimum lodging invariant', () => {
    for (const count of [-1, 1.5, NaN, Infinity, 'bad']) assert.throws(() => normalizeOptions({tavernCount: count}), /Количество/);
    const options = normalizeOptions({size: 6, tavernCount: 200, universityCount: 4}).options;
    assert.equal(options.tavernCount, customObjectLimit('tavern', 6));
    assert.equal(options.universityCount, customObjectLimit('university', 6));
    const zero = normalizeOptions(zeroCounts).options;
    assert.equal(zero.tavernCount, 1);
    assert.equal(normalizeOptions({...zeroCounts, innCount: 1}).options.tavernCount, 0);
});

test('large complexes cap automatic and manual counts at one or two throughout forms and shared links', () => {
    for (const size of [6, 34, 92, 100, 101, 150, 200]) {
        const max = size <= 100 ? 1 : 2,
            manual = Object.fromEntries(LARGE_OBJECT_KINDS.map(kind => [CUSTOM_OBJECT_COUNTS[kind], 99])),
            options = normalizeOptions({size, ...manual}).options, controls = form();
        writeGenerationForm(controls, options);
        const linked = readGenerationLocation(new URL(`http://localhost/${generationHash({
            options,
            name: 'Город'
        })}`)).options;
        for (const kind of LARGE_OBJECT_KINDS) {
            const key = CUSTOM_OBJECT_COUNTS[kind];
            assert.equal(customObjectLimit(kind, size), max, `${kind}/${size}`);
            assert.ok(customObjectCounts({size})[kind] <= max);
            assert.equal(options[key], max);
            assert.equal(linked[key], max);
            assert.equal(Number(controls.elements.namedItem(key).max), max);
        }
        controls.elements.namedItem('size').value = '100';
        syncCustomObjectControls(controls);
        for (const kind of LARGE_OBJECT_KINDS) assert.equal(Number(controls.elements.namedItem(CUSTOM_OBJECT_COUNTS[kind]).value), 1);
    }
    assert.ok(customObjectLimit('tavern', 200) > 2);
});

test('form controls recalculate automatic counts, preserve manual counts, clamp and reset', () => {
    const controls = form(), field = key => controls.elements.namedItem(key);
    writeGenerationForm(controls, {...DEFAULT_OPTIONS, size: 92});
    assert.equal(field('tavernCount').value, '10');
    assert.equal(field('tavernCount').dataset.auto, 'true');
    field('size').value = '200';
    syncCustomObjectControls(controls);
    assert.equal(field('tavernCount').value, '20');
    field('tavernCount').dataset.auto = 'false';
    field('tavernCount').value = '23';
    field('size').value = '92';
    syncCustomObjectControls(controls);
    assert.equal(field('tavernCount').value, '23');
    field('size').value = '6';
    syncCustomObjectControls(controls);
    assert.equal(Number(field('tavernCount').value), customObjectLimit('tavern', 6));
    field('size').value = '92';
    syncCustomObjectControls(controls, {reset: true});
    assert.equal(field('tavernCount').value, '10');
    assert.equal(readGenerationForm(controls).tavernCount, null);
    field('tavernCount').dataset.auto = 'false';
    field('tavernCount').value = '7';
    assert.equal(readGenerationForm(controls).tavernCount, 7);
});

test('manual quantities and automatic mode survive local links, while MFCG receives no custom keys', () => {
    const options = normalizeOptions({size: 200, tavernCount: 14, universityCount: 2}).options,
        fake = {options, name: 'Город'}, hash = generationHash(fake),
        restored = readGenerationLocation(new URL(`http://localhost/${hash}`)).options;
    assert.equal(restored.tavernCount, 14);
    assert.equal(restored.universityCount, 2);
    assert.equal(restored.barnCount, null);
    assert.ok(!hash.includes('barnCount'));
    const native = new URL(mfcgReferenceUrl(fake));
    for (const key of Object.values(CUSTOM_OBJECT_COUNTS)) {
        assert.ok(!native.searchParams.has(key));
        assert.ok(!Object.hasOwn(recipeFromOptions(options), key));
    }
    const reference = normalizeOptions({...options, seed: native.href}).options;
    for (const key of Object.values(CUSTOM_OBJECT_COUNTS)) assert.equal(reference[key], null);
});

function spaciousCity(options) {
    const districts = ['poor', 'mixed', 'rich'].map((wealth, i) => ({
        id: wealth,
        wealth,
        kind: 'regular',
        polygon: rectangle([i * 1000, 0], 900, 900)
    }));
    return {
        options, districts, buildings: [], special: [], squares: [], gardens: [], streets: [], docks: [], walls: [],
        terrain: {sea: [], ribbons: []}, fields: [{polygon: rectangle([0, 1500], 1000, 300)}],
        generatedGeometry: {cells: districts.map(d => ({urban: true, polygon: d.polygon.map(([x, y]) => [x, -y])}))}
    };
}

test('generation also caps raw large-complex requests without depending on form validation', () => {
    const options = {
        seed: '42', size: 200, ...zeroCounts, tavernCount: 1,
        ...Object.fromEntries(LARGE_OBJECT_KINDS.map(kind => [CUSTOM_OBJECT_COUNTS[kind], 99]))
    };
    const overlay = buildCustomObjects(spaciousCity(options));
    for (const kind of LARGE_OBJECT_KINDS) {
        assert.equal(overlay.requested[kind], 2, kind);
        assert.equal(overlay.buildings.filter(b => b.kind === kind).length, 2, kind);
    }
});

test('explicit per-type counts produce exactly those buildings without random extras', () => {
    const counts = {...zeroCounts, tavernCount: 6, innCount: 2, schoolCount: 3, windmillCount: 4, barnCount: 1},
        city = spaciousCity({...normalizeOptions({size: 92, ...counts}).options}), overlay = buildCustomObjects(city);
    for (const [kind, key] of Object.entries(CUSTOM_OBJECT_COUNTS)) {
        assert.equal(overlay.buildings.filter(b => b.kind === kind).length, counts[key], kind);
    }
    const withoutFields = {...city, fields: []}, noFarm = buildCustomObjects(withoutFields);
    assert.ok(!noFarm.buildings.some(b => FARM_KINDS.includes(b.kind)));
    assert.equal(noFarm.requested.windmill, 4);
});

test('unavailable requested buildings report shortages, including field capacity, without losing lodging', () => {
    const city = spaciousCity(normalizeOptions({size: 92, ...zeroCounts, tavernCount: 1, windmillCount: 8}).options);
    city.fields = [{polygon: rectangle([0, 1500], 100, 300)}];
    city.statistics = {};
    city.generationWarnings = [];
    attachCustomObjects(city, buildCustomObjects(city));
    assert.match(city.generationWarnings.join(' '), /мельница 1 из 8/);
    assert.equal(city.customObjects.filter(b => b.kind === 'windmill').length, 1);
    assert.ok(city.customObjects.some(b => LODGING_KINDS.includes(b.kind)));
});

test('custom quantities change only their overlay and JSON restores counts, architecture and warnings', () => {
    const one = generateCity({seed: '42', size: 16, ...zeroCounts, tavernCount: 1}),
        three = generateCity({...one.options, tavernCount: 3, universityCount: 1});
    const a = structuredClone(one.generatedGeometry), b = structuredClone(three.generatedGeometry);
    delete a.experimental.customObjects;
    delete b.experimental.customObjects;
    assert.deepEqual(a, b);
    assert.equal(three.customObjects.filter(b => b.kind === 'tavern').length, 3);
    const restored = parseProject(serializeProject(three, {})).city;
    for (const key of ['options', 'generatedGeometry', 'customObjects', 'generationWarnings']) assert.deepEqual(restored[key], three[key], key);
    const old = JSON.parse(serializeProject(one, {}));
    old.geometry.experimental.customObjects.version = 1;
    delete old.geometry.experimental.customObjects.requested;
    old.recipe = Object.fromEntries(Object.entries(old.recipe).filter(([key]) => !Object.hasOwn(CUSTOM_COUNT_DEFAULTS, key)));
    assert.deepEqual(parseProject(JSON.stringify(old)).city.customObjects, one.customObjects);
});
