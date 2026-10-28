import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCustomObjects,
    customObjectBudget,
    visibleCityBuildings,
    visibleCityTrees
} from '../src/buildings/custom-objects.js';
import {BUILDING_TYPES, buildingsOverlap, containsFootprint, enterEditor} from '../src/editor/building-editor.js';
import {createArchitecture} from '../src/buildings/building-architecture.js';
import {footprints, hitsRoad} from '../src/buildings/building-spatial.js';
import {dryFootprint} from '../src/roads/bridge-network.js';
import {area, rectangle} from '../src/core/geometry.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {renderMap} from '../src/rendering/render.js';
import {placementRuleError, urbanPlacementRegions} from '../src/buildings/building-placement-rules.js';

const group = b => BUILDING_TYPES[b.kind].group;
const town = (fieldWidth = 0, size = 34, seed = '42') => {
    const districts = ['poor', 'mixed', 'rich'].map((wealth, i) => ({
        id: wealth, wealth, kind: 'regular', polygon: rectangle([i * 1000, 0], 900, 900)
    }));
    return {
        options: {seed, size}, districts, buildings: [], special: [], squares: [], gardens: [], streets: [], docks: [],
        walls: [], terrain: {sea: [], ribbons: []},
        fields: fieldWidth ? [{polygon: rectangle([0, 1500], fieldWidth, 300)}] : [],
        generatedGeometry: {cells: districts.map(d => ({urban: true, polygon: d.polygon.map(([x, y]) => [x, -y])}))}
    };
};

test('lodging is guaranteed, placements vary by seed, and city capacity grows with size', () => {
    const signatures = new Set();
    for (const size of [6, 34, 92, 200]) for (const seed of ['1', '42', '720156492783']) {
        const city = town(0, size, seed), before = structuredClone(city), overlay = buildCustomObjects(city),
            budget = customObjectBudget(size, 0);
        const lodging = overlay.buildings.filter(b => group(b) === 'Постой и питание');
        assert.ok(lodging.length >= 1 && lodging.length <= budget.lodging);
        assert.ok(overlay.buildings.length - lodging.length - city.districts.length <= budget.other);
        assert.ok(overlay.buildings.every(b => group(b) !== 'Сельское хозяйство'));
        for (const b of overlay.buildings) {
            const district = city.districts.find(d => d.id === b.district);
            assert.equal(placementRuleError({...city, buildings: overlay.buildings}, b, BUILDING_TYPES[b.kind]), null);
            if (district) {
                assert.ok(BUILDING_TYPES[b.kind].wealth.includes(district.wealth));
                assert.ok(footprints(b).every(p => containsFootprint(district, p)));
            } else assert.ok(footprints(b).every(p => dryFootprint(p, urbanPlacementRegions(city))));
        }
        assert.deepEqual(city, before);
        assert.deepEqual(buildCustomObjects(city), overlay);
        signatures.add(JSON.stringify(overlay.buildings.map(b => [b.kind, b.polygon])));
    }
    assert.ok(signatures.size > 4);
    assert.ok(customObjectBudget(200, 0).other > customObjectBudget(6, 0).other);
});

test('farm counts scale with city size while field area limits capacity', () => {
    for (const [width, size, expected] of [[100, 6, 1], [100, 200, 1], [1000, 6, 1], [1000, 200, 10]]) {
        const city = town(width, size),
            farms = buildCustomObjects(city).buildings.filter(b => group(b) === 'Сельское хозяйство');
        assert.equal(farms.length, expected);
        for (const farm of farms) {
            assert.equal(farm.layer, 'fields');
            assert.ok(footprints(farm).every(p => containsFootprint(city.fields[farm.field], p)));
        }
    }
    const tiny = town(1);
    tiny.fields = [{polygon: rectangle([0, 1500], 1, 1)}];
    assert.equal(buildCustomObjects(tiny).buildings.filter(b => group(b) === 'Сельское хозяйство').length, 0);
});

const cities = [
    generateCity({seed: '1424740', size: 6}),
    generateCity({seed: '1931200012', size: 34}),
    generateCity({seed: '865334241', size: 16, riverWidthScale: 3, coast: false, greens: true})
];

test('real cities keep fixed dimensions, district restrictions and dry, collision-free placements', () => {
    for (const city of cities) {
        assert.ok(city.customObjects.some(b => group(b) === 'Постой и питание'));
        const water = [...city.terrain.sea, ...city.terrain.ribbons];
        for (const [i, b] of city.customObjects.entries()) {
            assert.deepEqual(Object.keys(b.parts), Object.keys(createArchitecture(b.kind, [0, 0], BUILDING_TYPES[b.kind].width, BUILDING_TYPES[b.kind].height).parts));
            const expected = createArchitecture(b.kind, [0, 0], BUILDING_TYPES[b.kind].width, BUILDING_TYPES[b.kind].height);
            if (b.kind === 'guardhouse') assert.ok(area(b.polygon) > 4 && area(b.polygon) <= area(expected.polygon) + 1e-6);
            else assert.ok(Math.abs(area(b.polygon) - area(expected.polygon)) < 1e-6);
            assert.ok(footprints(b).every(p => dryFootprint(p, water)));
            assert.ok(!city.streets.some(r => hitsRoad(b, r)));
            assert.ok(!city.customObjects.slice(i + 1).some(other => buildingsOverlap(b, other)));
            assert.ok(!city.special.filter(s => s.kind !== 'farmhouse').some(s => buildingsOverlap(b, {polygon: b.kind === 'guardhouse' ? s.polygon : s.court || s.polygon})));
            if (b.kind !== 'guardhouse') assert.ok(!city.squares.some(polygon => buildingsOverlap(b, {polygon})));
            if (group(b) !== 'Сельское хозяйство') {
                const d = city.districts.find(d => d.id === b.district);
                if (d) {
                    assert.ok(BUILDING_TYPES[b.kind].wealth.includes(d.wealth));
                    assert.ok(footprints(b).every(p => containsFootprint(d, p)));
                } else assert.ok(footprints(b).every(p => dryFootprint(p, urbanPlacementRegions(city))));
            }
        }
        assert.equal(city.statistics.buildings, visibleCityBuildings(city).length + city.customObjects.length);
    }
});

test('JSON, editor entry and edited JSON retain exact architecture without duplicate objects', () => {
    const city = cities[1], before = serializeProject(city, {}), restored = parseProject(before).city,
        edited = enterEditor(restored), reopened = parseProject(serializeProject(edited, {})).city;
    assert.deepEqual(restored.customObjects, city.customObjects);
    assert.deepEqual(restored.generatedGeometry, city.generatedGeometry);
    const buildings = edited.buildings.filter(b => b.custom);
    assert.equal(buildings.length, city.customObjects.length);
    assert.equal(edited.customObjects, undefined);
    assert.deepEqual(edited.trees, visibleCityTrees(city));
    for (const [i, b] of buildings.entries()) {
        assert.deepEqual(b.parts, city.customObjects[i].parts);
        assert.deepEqual(b.polygon, city.customObjects[i].polygon);
        assert.equal(b.layer, city.customObjects[i].layer);
    }
    assert.deepEqual(reopened.buildings, edited.buildings);
    assert.equal(serializeProject(city, {}), before);
});

test('SVG and raster source contain the same custom architecture in each theme and layer', () => {
    const city = cities[1];
    for (const theme of ['atlas', 'ink']) {
        const svg = renderMap(city, {theme}),
            hidden = renderMap(city, {theme, layers: {fields: false, buildings: false}});
        for (const b of city.customObjects) {
            assert.ok(svg.includes(`data-custom-object="${b.id}"`));
            assert.ok(svg.includes(`data-building-architecture="${b.kind}"`));
        }
        assert.match(hidden, /id="layer-fields"[^>]*display:none/);
        assert.match(hidden, /id="layer-buildings"[^>]*display:none/);
        assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    }
});

test('old projects retain their original display and malformed custom overlays are rejected', () => {
    const data = JSON.parse(serializeProject(cities[1], {}));
    delete data.geometry.experimental.customObjects;
    const old = parseProject(JSON.stringify(data)).city;
    assert.equal(old.customObjects, undefined);
    assert.equal(visibleCityBuildings(old), old.buildings);
    assert.ok(!renderMap(old).includes('data-custom-object='));
    for (const corrupt of [b => b.kind = '<script>', b => b.parts.roof_bad = [[0, 0]], b => b.layer = 'bad', b => b.id = 'x" onload="bad']) {
        const project = JSON.parse(serializeProject(cities[1], {}));
        corrupt(project.geometry.experimental.customObjects.buildings[0]);
        assert.throws(() => parseProject(JSON.stringify(project)), /геометрия/);
    }
});
