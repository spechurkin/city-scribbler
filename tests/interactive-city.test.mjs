import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateCity, normalizeOptions, recipeFromOptions} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {LAYERS, renderMap} from '../src/rendering/render.js';
import {compareGeometry} from '../src/compatible/compare.js';
import {buildBridgeNetwork, dryPieces, riverRibbon} from '../src/roads/bridge-network.js';
import {distance, inside} from '../src/core/geometry.js';

const fixtures = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
const palwe = generateCity({seed: fixtures.find(f => f.name === 'Palwe').url});

test('the interactive generation path preserves all source parameters and matches Palwe structural geometry', async () => {
    assert.equal(palwe.source.format, 'compatible');
    assert.equal(palwe.name, 'Palwe');
    assert.equal(palwe.options.size, 61);
    assert.equal(palwe.options.sea, 1.51);
    assert.equal(palwe.options.urban_castle, true);
    const native = JSON.parse(await readFile(new URL('fixtures/mfcg/palwe.json', import.meta.url)));
    const comparison = compareGeometry(palwe.generatedGeometry, native);
    for (const layer of ['earth', 'water', 'walls', 'mainRoads', 'riverCourse', 'riverWidth', 'planks']) assert.equal(comparison[layer].match, true, layer);
    assert.equal(palwe.generatedGeometry.completeness.fullySeedCompatible, false);
    assert.ok(palwe.buildings.length > 2000);
    assert.deepEqual(palwe.terrain.earth, palwe.generatedGeometry.earth.map(([x, y]) => [x, -y]));
});

test('arbitrary source URLs preserve exact size, flags, sea and gates without reference-specific branches', () => {
    const {options} = normalizeOptions({seed: 'https://watabou.github.io/city-generator/?seed=9867431223&size=43&citadel=0&urban_castle=1&plaza=0&temple=1&walls=0&shantytown=1&coast=1&river=1&greens=1&hub=1&sea=0.736241&gates=9'});
    assert.deepEqual(recipeFromOptions(options), {
        seed: 9867431223,
        size: 43,
        citadel: false,
        urban_castle: true,
        plaza: false,
        temple: true,
        walls: false,
        shantytown: true,
        coast: true,
        river: true,
        greens: true,
        hub: true,
        gates: 9,
        sea: .736241,
        coastOffset: 0,
        riverWidthScale: 1,
        riverCurvature: 1,
        housingDensity: 1
    });
});

test('a straight bridge follows its road corridor and has bank-cut ends instead of perpendicular square caps', () => {
    const river = {points: [[0, -100], [0, 0], [0, 100]], width: 20};
    const network = buildBridgeNetwork({
        rivers: [river],
        crossings: [[{point: [0, 0], pedestrian: false}]],
        roads: [{id: 'road', major: true, width: 8, points: [[-80, -30], [0, 0], [80, 40]]}]
    });
    assert.equal(network.bridges.length, 1);
    const bridge = network.bridges[0];
    const angle = Math.atan2(bridge.axis[1], bridge.axis[0]);
    assert.ok(angle > Math.atan2(30, 80) && angle < Math.atan2(40, 80));
    for (const rail of bridge.rails) for (const p of rail) assert.ok(Math.abs(Math.abs(p[0]) - 10) < 1e-7);
    assert.ok(distance(bridge.a, bridge.b) > 20);
    assert.ok(bridge.polygon.length >= 4);
    assert.equal(network.approaches.length, 2);
    for (const r of [...network.streets, ...network.approaches]) {
        assert.ok(r.points.length >= 2);
        for (let i = 1; i < r.points.length; i++) {
            const length = dryPieces([r.points[i - 1], r.points[i]], network.ribbons).reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0);
            assert.ok(Math.abs(length - distance(r.points[i - 1], r.points[i])) < 1e-5);
        }
    }
});

test('each Palwe bridge has two land connections; exported deck is painted before streets', () => {
    assert.equal(palwe.bridges.length, 4);
    assert.equal(palwe.approaches.length, 8);
    for (const a of palwe.approaches) {
        assert.ok(a.points.length >= 2);
        assert.ok(distance(a.points[0], a.end) < 1e-7);
        for (let i = 1; i < a.points.length; i++) assert.equal(palwe.terrain.ribbons.some(p => inside([(a.points[i][0] + a.points[i - 1][0]) / 2, (a.points[i][1] + a.points[i - 1][1]) / 2], p)), false);
    }
    const svg = renderMap(palwe, {}, {interactive: true});
    assert.ok(svg.indexOf('data-bridge-decks=') < svg.indexOf('data-street-connections='));
    for (const key of Object.keys(LAYERS)) assert.ok(svg.includes(`data-layer="${key}"`), key);
    assert.ok(svg.includes('data-district="'));
    assert.ok(!svg.includes('NaN'));
    assert.ok(!svg.includes('undefined'));
    assert.ok(!svg.includes('Infinity'));
});

test('new projects restore the displayed engine, exact geometry, custom water and district names', () => {
    const city = generateCity({
        seed: '865334241',
        size: 27,
        river: true,
        coast: true,
        riverWidthScale: .7,
        riverCurvature: .6,
        coastOffset: .03,
        sea: .73
    });
    city.name = 'Тест <&>';
    city.districts[0].name = 'Новый квартал';
    const saved = serializeProject(city, {theme: 'ink'}), restored = parseProject(saved);
    assert.equal(restored.city.source.format, 'compatible');
    assert.deepEqual(restored.city.generatedGeometry, city.generatedGeometry);
    assert.deepEqual(restored.city.options, city.options);
    assert.equal(restored.city.name, city.name);
    assert.equal(restored.city.districts[0].name, 'Новый квартал');
    assert.equal(restored.view.theme, 'ink');
    assert.ok(renderMap(restored.city).includes('Тест &lt;&amp;&gt;'));
});

test('legacy project aliases and hidden scenery migrate without regenerating saved geometry', () => {
    const city = generateCity({seed: '865334241', size: 27, urban_castle: true, river: true, coast: true});
    const saved = JSON.parse(serializeProject(city, {theme: 'ink'}));
    for (const [native, old] of [['citadel', 'castle'], ['urban_castle', 'urbanCastle'], ['plaza', 'market'], ['greens', 'gardens'], ['shantytown', 'shanty']]) {
        saved.recipe[old] = saved.recipe[native];
        delete saved.recipe[native];
    }
    Object.assign(saved.recipe, {density: 75, fields: false, forest: false, port: false});
    const restored = parseProject(JSON.stringify(saved));
    assert.deepEqual(restored.city.generatedGeometry, city.generatedGeometry);
    assert.equal(restored.city.options.urban_castle, true);
    assert.equal(restored.city.options.density, undefined);
    for (const key of ['fields', 'forest', 'port']) assert.equal(restored.view.layers[key], false);
});

test('obsolete local density values no longer change a city generated with native MFCG parameters', () => {
    const recipe = {seed: '38760091', size: 31, river: true, coast: true};
    assert.deepEqual(generateCity({...recipe, density: 25}).generatedGeometry, generateCity({
        ...recipe,
        density: 95
    }).generatedGeometry);
});

test('water slider changes are geometric and neutral values preserve the source recipe', () => {
    const input = {seed: '38760091', size: 31, river: true, coast: true, forest: false};
    const base = generateCity(input), wide = generateCity({...input, riverWidthScale: 1.8}),
        bend = generateCity({...input, riverCurvature: .35}), coast = generateCity({...input, coastOffset: .16});
    assert.ok(Math.abs(wide.terrain.rivers[0].width / base.terrain.rivers[0].width - 1.8) < 1e-10);
    assert.notDeepEqual(bend.terrain.rivers[0].points, base.terrain.rivers[0].points);
    assert.notDeepEqual(coast.terrain.sea, base.terrain.sea);
    assert.deepEqual(base.generatedGeometry, generateCity({
        ...input,
        riverWidthScale: 1,
        riverCurvature: 1,
        coastOffset: 0
    }).generatedGeometry);
    assert.ok(riverRibbon(base.terrain.rivers[0].points, base.terrain.rivers[0].width).every(p => p.every(Number.isFinite)));
});

test('invalid water settings fail explicitly and river/sea toggles remove their geometry', () => {
    for (const options of [{riverWidthScale: 0}, {riverCurvature: 3}, {coastOffset: .5}]) assert.throws(() => generateCity({
        seed: '985633',
        size: 18, ...options
    }), /Параметр/);
    const dry = generateCity({seed: '985633', size: 18, river: false, coast: false, forest: false});
    assert.equal(dry.terrain.rivers.length, 0);
    assert.equal(dry.terrain.sea.length, 0);
    assert.equal(dry.bridges.length, 0);
    assert.throws(() => normalizeOptions({seed: 'текст'}), /числовой сид/);
});
