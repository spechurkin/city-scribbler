import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assignDistrictWealth, buildingAppearance} from '../src/districts/district-wealth.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacyCity} from '../src/generation/generator.js';
import {geometryFingerprint, importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {LAYERS, normalizeView, renderMap, THEMES} from '../src/rendering/render.js';

const square = (x, y, r = 5) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const district = (id, x, y, kind = 'regular') => ({id, kind, polygon: square(x, y), name: id});
const wealth = city => Object.fromEntries(city.districts.map(d => [d.id, d.wealth]));

test('prosperity follows the castle and market, with mixed and poor districts farther out', () => {
    const city = {
        center: [0, 0], castle: {polygon: square(0, 0)}, markets: [{polygon: square(15, 0)}],
        districts: [district('keep', 0, 0, 'castle'), district('merchants', 15, 0),
            district('outer-a', 100, 0, 'outskirts'), district('outer-b', 0, 100, 'outskirts'),
            district('outer-c', -100, 0, 'outskirts'), district('outer-d', 0, -100, 'outskirts')]
    };
    const polygons = structuredClone(city.districts.map(d => d.polygon));
    assignDistrictWealth(city);
    assert.equal(city.districts[0].wealth, 'rich');
    assert.equal(city.districts[1].wealth, 'rich');
    assert.equal(city.districts.filter(d => d.wealth === 'mixed').length, 2);
    assert.equal(city.districts.filter(d => d.wealth === 'poor').length, 2);
    assert.deepEqual(city.districts.map(d => d.polygon), polygons);
    const before = wealth(city);
    city.districts.reverse();
    city.districts.forEach(d => {
        d.name = 'Переименован';
    });
    assignDistrictWealth(city);
    assert.deepEqual(wealth(city), before);
});

test('market access and city walls affect otherwise equally central districts', () => {
    const city = {center: [0, 0], districts: [district('west', -40, 0), district('east', 40, 0)]};
    city.markets = [{polygon: square(40, 0)}];
    assignDistrictWealth(city);
    assert.equal(city.districts[1].wealth, 'rich');
    city.markets = [{polygon: square(-40, 0)}];
    assignDistrictWealth(city);
    assert.equal(city.districts[0].wealth, 'rich');
    city.markets = [];
    city.walls = [{polygon: square(40, 0, 12)}];
    assignDistrictWealth(city);
    assert.equal(city.districts[1].wealth, 'rich');
});

test('a castle inside a district hole does not make the surrounding district a castle district', () => {
    const city = {
        center: [0, 0], castle: {polygon: square(0, 0, 2)},
        districts: [district('citadel', 0, 0, 'castle'), {
            id: 'ring',
            kind: 'regular',
            polygon: square(0, 0, 20),
            rings: [square(0, 0, 20), square(0, 0, 5)]
        }, district('suburb', 50, 0)]
    };
    assignDistrictWealth(city);
    assert.deepEqual(wealth(city), {citadel: 'rich', ring: 'mixed', suburb: 'poor'});
});

test('empty and single-district settlements have finite, stable assignments', () => {
    assert.deepEqual(assignDistrictWealth({districts: []}).districts, []);
    const city = {center: [0, 0], districts: [district('only', 0, 0)]};
    assignDistrictWealth(city);
    assert.equal(city.districts[0].wealth, 'mixed');
});

test('all city formats render permanent wealth colors in each theme and preserve imports', async () => {
    const source = JSON.parse(await readFile(new URL('fixtures/mfcg/palwe.json', import.meta.url), 'utf8'));
    const imported = importMfcgGeoJson(source);
    const fingerprint = geometryFingerprint(imported);
    const compatible = generateCity({seed: '1931200012', size: 16});
    const cities = [compatible, imported, generateLegacyCity({seed: 'wealth'})];
    assert.equal(Object.hasOwn(LAYERS, 'districts'), false);
    assert.equal(Object.hasOwn(THEMES, 'districts'), false);
    assert.equal(normalizeView({theme: 'districts'}).theme, 'atlas');
    for (const city of cities) {
        assert.deepEqual(new Set(city.districts.map(d => d.wealth)), new Set(['rich', 'mixed', 'poor']));
        const byId = new Map(city.districts.map(d => [d.id, d.wealth]));
        const appearance = buildingAppearance(city, THEMES.atlas), buildings = structuredClone(city.buildings);
        for (const b of city.buildings) assert.equal(appearance(b).wealth, byId.get(b.district) || 'poor');
        for (const [theme, palette] of Object.entries(THEMES)) {
            const svg = renderMap(city, {
                theme,
                layers: {...Object.fromEntries(Object.keys(LAYERS).map(k => [k, false])), districts: false}
            });
            assert.match(svg, /id="layer-districts"(?![^>]*display:none)/);
            for (const category of ['rich', 'mixed', 'poor']) assert.ok(svg.includes(`data-wealth="${category}" fill="${palette.wealth[category]}"`));
            assert.ok(!svg.includes('undefined'));
            const withBuildings = renderMap(city, {theme});
            for (const category of ['rich', 'mixed', 'poor']) {
                assert.ok(withBuildings.includes(`data-building-wealth="${category}"`));
                assert.ok(palette.wealthRoof[category].some(color => withBuildings.includes(`fill="${color}"`)));
            }
        }
        assert.deepEqual(city.buildings, buildings);
    }
    assert.equal(geometryFingerprint(imported), fingerprint);
    compatible.districts[0].name = 'Новое имя';
    const restored = parseProject(serializeProject(compatible, {theme: 'districts', layers: {districts: false}}));
    assert.deepEqual(wealth(restored.city), wealth(compatible));
    assert.equal(restored.city.districts[0].name, 'Новое имя');
    assert.equal(normalizeView(restored.view).theme, 'atlas');
});
