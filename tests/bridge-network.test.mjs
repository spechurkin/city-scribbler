import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cityFromGeometry, generateCity} from '../src/generation/interactive-city.js';
import {buildBridgeNetwork, dryPieces} from '../src/roads/bridge-network.js';
import {area, centroid, distance, inside, segmentDistance} from '../src/core/geometry.js';
import {renderMap} from '../src/rendering/render.js';

const fixtures = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
const bankDistance = (p, water) => Math.min(...water.map((q, i) => segmentDistance(p, q, water[(i + 1) % water.length])));
const assertDry = (points, water) => {
    for (let i = 1; i < points.length; i++) {
        const dry = dryPieces([points[i - 1], points[i]], water).reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0);
        assert.ok(Math.abs(dry - distance(points[i - 1], points[i])) < 1e-5);
    }
};

test('skew bridge ends follow the entire bank boundary and each rail ends at water, with no overhanging caps', () => {
    const network = buildBridgeNetwork({
        rivers: [{points: [[0, -100], [20, 0], [0, 100]], width: 24}],
        crossings: [[{point: [20, 0], pedestrian: true}]],
        roads: []
    });
    const bridge = network.bridges[0], water = network.ribbons[0];
    for (const rail of bridge.rails) for (const end of rail) assert.ok(bankDistance(end, water) < 1e-6);
    for (const end of [bridge.a, bridge.b]) assert.ok(bankDistance(end, water) < 1e-6);
    assert.ok(area(bridge.polygon) > 0);
    for (const p of bridge.polygon) assert.ok(inside(p, water) || bankDistance(p, water) < 1e-6);
    assert.equal(network.approaches.length, 2);
    for (const c of network.approaches) {
        assert.equal(c.kind, 'quay');
        assertDry(c.points, network.ribbons);
        const quay = network.quays.find(q => q.id === c.quay);
        assert.ok(quay);
        assert.ok(segmentDistance(c.end, ...quay.inner) < 1e-6);
        assert.ok(inside(c.points.at(-1), quay.polygon) || bankDistance(c.points.at(-1), quay.polygon) < 1e-6);
    }
});

test('a footbridge joins quays and never acquires a spur toward an unrelated nearby street', () => {
    const road = {id: 'parallel', major: true, width: 8, points: [[30, -100], [30, 100]]};
    const network = buildBridgeNetwork({
        roads: [road],
        rivers: [{points: [[0, -100], [0, 100]], width: 20}],
        crossings: [[{point: [0, 0], pedestrian: true}]]
    });
    assert.deepEqual(network.streets[0].points, road.points);
    assert.ok(network.approaches.every(a => a.kind === 'quay' && distance(...a.points) <= 4.8));
});

test('a bridge on a road rewires that same route to both bank ends without dangling old stubs', () => {
    const network = buildBridgeNetwork({
        roads: [{
            id: 'crossing',
            major: true,
            width: 8,
            points: [[-80, -25], [0, 0], [80, 25]]
        }, {id: 'other', major: true, width: 8, points: [[25, 50], [25, 100]]}],
        rivers: [{points: [[0, -100], [0, 100]], width: 20}],
        crossings: []
    });
    assert.equal(network.bridges.length, 1);
    assert.equal(network.approaches.length, 2);
    for (const c of network.approaches) {
        assert.equal(c.kind, 'road');
        assert.equal(c.road, 'crossing');
        assert.ok(network.streets.some(s => s.id === 'crossing' && [s.points[0], s.points.at(-1)].some(p => distance(p, c.end) < 1e-6)));
        assertDry(c.points, network.ribbons);
    }
    for (const s of network.streets) assertDry(s.points, network.ribbons);
});

test('Palwe keeps road bridges and size-based footbridges independently of harbour visibility', () => {
    const city = generateCity({seed: fixtures.find(f => f.name === 'Palwe').url});
    assert.equal(city.bridges.filter(b => b.pedestrian).length, 5);
    assert.equal(city.bridges.filter(b => !b.pedestrian).length, 2);
    assert.ok(city.approaches.filter(a => a.kind === 'quay').length >= 4);
    const svg = renderMap(city, {layers: {port: false}}),
        group = svg.slice(svg.indexOf('id="layer-streets"'), svg.indexOf('id="layer-market"'));
    assert.equal((group.match(/data-bridge="true"/g) || []).length, 7);
    assert.equal((group.match(/data-pedestrian="true"/g) || []).length, 5);
    assert.ok(group.includes('data-quays="true"'));
    assert.ok(city.docks.length > 0);
});

test('old generated projects recover footbridges from their plank geometry without crossing metadata', () => {
    const city = generateCity({seed: fixtures.find(f => f.name === 'Palwe').url});
    for (const missing of ['all', 'footbridges']) {
        const geometry = structuredClone(city.generatedGeometry);
        if (missing === 'all') delete geometry.riverCrossings;
        else geometry.riverCrossings = geometry.riverCrossings.map(list => list.filter(c => !c.pedestrian));
        const restored = cityFromGeometry(geometry, city.options, {name: city.name});
        assert.equal(restored.bridges.length, city.bridges.length);
        for (const bridge of city.bridges) assert.ok(restored.bridges.some(b => distance(b.origin, bridge.origin) < 1e-6));
        assert.equal(restored.bridges.filter(b => b.pedestrian).length, city.bridges.filter(b => b.pedestrian).length);
    }
});

test('a street touching the river and turning back onto the same bank does not create a bridge', () => {
    const network = buildBridgeNetwork({
        roads: [{
            id: 'touch',
            major: true,
            width: 8,
            points: [[-50, -30], [0, 0], [-50, 30]]
        }], rivers: [{points: [[0, -100], [0, 100]], width: 20}]
    });
    assert.equal(network.bridges.length, 0);
});

test('urban quays follow the river, while rural banks only get local bridge landings', () => {
    const network = buildBridgeNetwork({
        roads: [],
        rivers: [{points: [[0, -500], [0, -100], [0, 100], [0, 500]], width: 20}],
        crossings: [[{point: [0, 0], pedestrian: true}]],
        urban: [[[-100, -30], [100, -30], [100, 30], [-100, 30]]]
    });
    assert.ok(network.quays.length > 0);
    for (const q of network.quays) assert.ok(Math.abs(centroid(q.polygon)[1]) < 31);
});

for (const seed of ['884137421', '1437657', '76510239214']) test(`arbitrary seed ${seed}: every bridge rail is cut at its river bank and all connections are dry`, () => {
    const city = generateCity({seed, size: 39, coast: false, river: true, forest: false});
    assert.ok(city.bridges.length > 0);
    for (const bridge of city.bridges) for (const rail of bridge.rails) for (const p of rail) assert.ok(bankDistance(p, city.terrain.ribbons[bridge.river]) < 1e-5);
    for (const c of city.approaches) assertDry(c.points, city.terrain.ribbons);
    for (const s of city.streets) assertDry(s.points, city.terrain.ribbons);
});
