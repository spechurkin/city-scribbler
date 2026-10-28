import test from 'node:test';
import assert from 'node:assert/strict';
import {
    generateCity,
    isWater,
    normalizeOptions,
    parseProject,
    polygonOnLand,
    serializeProject,
    SIZES
} from '../src/generation/generator.js';
import {normalizeView, renderMap} from '../src/rendering/render.js';
import {area, inside, lerp} from '../src/core/geometry.js';

test('same seed and parameters reproduce all geometry exactly', () => {
    assert.deepEqual(generateCity({seed: 'Лисий брод'}), generateCity({seed: 'Лисий брод'}));
    assert.notDeepEqual(generateCity({seed: '1'}).buildings, generateCity({seed: '2'}).buildings);
});
test('optional vegetation and walls do not shift city blocks, rivers or houses', () => {
    const a = generateCity({seed: '42'}), b = generateCity({seed: '42', forest: false, fields: false, walls: false});
    assert.deepEqual(a.districts, b.districts);
    assert.deepEqual(a.buildings, b.buildings);
    assert.deepEqual(a.terrain, b.terrain);
    assert.equal(b.trees.length + b.fields.length + b.walls.length, 0);
});
test('all feature switches disable their generated data', () => {
    const c = generateCity({
        walls: false,
        castle: false,
        temple: false,
        market: false,
        forest: false,
        fields: false,
        port: false
    });
    for (const key of ['walls', 'towers', 'trees', 'fields', 'docks']) assert.equal(c[key].length, 0, key);
    for (const key of ['castle', 'temple', 'plaza']) assert.equal(c[key], null, key);
});
test('hostile or malformed input falls back to finite bounded settings', () => {
    const options = normalizeOptions({
        size: '__proto__',
        geography: 'unknown',
        density: Infinity,
        seed: ' '.repeat(1000),
        walls: 'false'
    });
    assert.equal(options.size, 'town');
    assert.equal(options.density, 65);
    assert.equal(options.walls, true);
    assert.ok(Number.isFinite(generateCity(options).statistics.area));
    assert.equal(normalizeOptions({density: 100000}).density, 95);
    assert.equal(normalizeView({theme: '__proto__'}).theme, 'atlas');
});
test('project round trip retains geometry, city and district names and presentation', () => {
    const c = generateCity({seed: 'Импорт'});
    c.name = 'Тестовый город';
    c.districts[0].name = 'Старое кольцо';
    const result = parseProject(serializeProject(c, {theme: 'ink', layers: {forest: false}}));
    assert.deepEqual(result.city, c);
    assert.equal(result.view.theme, 'ink');
    assert.equal(result.view.layers.forest, false);
    assert.throws(() => parseProject('{"format":"other","version":1}'));
    assert.throws(() => parseProject('{"format":"gradopisets","version":2,"options":{}}'));
});
test('SVG is self contained, escapes names and has independently exportable layers', () => {
    const c = generateCity({seed: 'svg'});
    c.name = '<script>&"';
    c.districts[0].name = '<img onerror="alert(1)">';
    const svg = renderMap(c, {layers: {forest: false}});
    assert.ok(svg.includes('&lt;script&gt;&amp;&quot;'));
    assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('<img'));
    assert.match(svg, /id="layer-forest"[^>]*style="display:none"/);
    assert.ok(!svg.includes('data-district='));
    for (const layer of ['sea', 'river', 'districts', 'streets', 'buildings', 'port', 'castle', 'market', 'temple', 'walls', 'fields', 'forest', 'labels']) assert.ok(svg.includes(`id="layer-${layer}"`), layer);
    assert.ok(!svg.includes('NaN'));
    assert.ok(!svg.includes('Infinity'));
});

for (const geography of ['inland', 'river', 'coast', 'estuary']) {
    test(`${geography}: buildings, landmarks, gates and trees respect the terrain`, () => {
        for (const seed of ['0', '42', '1931200012']) {
            const c = generateCity({seed, geography});
            assert.ok(c.buildings.length > 100);
            assert.ok(c.districts.length <= SIZES.town && c.districts.length >= SIZES.town * .65);
            if (!c.terrain.coast) assert.equal(c.districts.length, SIZES.town);
            const districtById = new Map(c.districts.map(d => [d.id, d]));
            for (const building of c.buildings) {
                assert.ok(area(building.polygon) >= 32);
                assert.ok(polygonOnLand(c.terrain, building.polygon, 3.9), building.id);
                assert.ok(building.polygon.every(p => inside(p, districtById.get(building.district).polygon)), `outside district: ${building.id}`);
            }
            for (const tree of c.trees) assert.ok(!isWater(c.terrain, tree.point, tree.radius + 7.9));
            for (const gate of c.gates) assert.ok(!isWater(c.terrain, gate.point, 26.9));
            for (const route of c.routes) assert.ok(route.edges.length > 0, `unreachable gate ${route.gate}`);
            assert.ok(c.castle);
            assert.ok(c.temple);
            assert.ok(c.plaza);
            assert.ok(polygonOnLand(c.terrain, c.castle.polygon, 0));
            for (const polygon of [c.temple.nave, c.temple.transept, c.temple.tower]) assert.ok(polygonOnLand(c.terrain, polygon, 0));
            if (!c.terrain.coast) assert.equal(c.docks.length, 0);
            if (!c.terrain.river) assert.equal(c.bridges.length, 0);
            for (const bridge of c.bridges) assert.ok(isWater(c.terrain, lerp(bridge.a, bridge.b, .5), 3.1));
        }
    });
}
test('larger settlements produce more districts and houses for the same seed', () => {
    let before = 0;
    for (const size of Object.keys(SIZES)) {
        const c = generateCity({seed: 'scale', size, geography: 'inland'});
        assert.ok(c.buildings.length > before);
        before = c.buildings.length;
    }
});
