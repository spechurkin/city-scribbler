import test from 'node:test';
import assert from 'node:assert/strict';
import {cityFromGeometry, generateCity} from '../src/generation/interactive-city.js';
import {buildBridgeNetwork, dryPieces} from '../src/roads/bridge-network.js';
import {polygonBoolean} from '../src/compatible/polygons.js';
import {area, distance, segmentDistance} from '../src/core/geometry.js';
import {renderMap} from '../src/rendering/render.js';

const overlap = (a, b) => polygonBoolean(a, b, 'intersection').reduce((sum, p) => sum + area(p), 0);
const separate = bridges => {
    for (let i = 0; i < bridges.length; i++) for (let j = i + 1; j < bridges.length; j++) assert.ok(overlap(bridges[i].polygon, bridges[j].polygon) < 1e-5, `${bridges[i].id} overlaps ${bridges[j].id}`);
};
const dry = (points, water) => {
    for (let i = 1; i < points.length; i++) {
        const length = distance(points[i - 1], points[i]), pieces = dryPieces([points[i - 1], points[i]], water);
        assert.ok(Math.abs(length - pieces.reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0)) < 1e-5);
    }
};

test('nearby road crossings share a short bridge when the river becomes wider than their spacing', () => {
    const roads = [{id: 'first', major: true, width: 8, points: [[-100, -88], [100, 72]]}, {
        id: 'second',
        major: true,
        width: 8,
        points: [[-100, 88], [100, -72]]
    }];
    const narrow = buildBridgeNetwork({roads, rivers: [{points: [[0, -100], [0, 100]], width: 10}]});
    const wide = buildBridgeNetwork({roads, rivers: [{points: [[0, -100], [0, 100]], width: 60}]});
    assert.equal(narrow.bridges.length, 2);
    assert.equal(wide.bridges.length, 1);
    separate(narrow.bridges);
    separate(wide.bridges);
    assert.notDeepEqual(wide.bridges.map(b => b.axis), narrow.bridges.map(b => b.axis));
    assert.equal(wide.bridges[0].origins.length, 2);
    assert.ok(distance(wide.bridges[0].a, wide.bridges[0].b) <= 60.001);
    assert.equal(wide.approaches.length, 2);
    assert.ok(wide.approaches.every(a => a.kind === 'quay'));
    for (const street of wide.streets) {
        const landing = street.points.find(p => Math.abs(Math.abs(p[0]) - 30) < 1e-5);
        assert.ok(landing && wide.quays.some(q => segmentDistance(landing, ...q.inner) < 1e-5), 'every absorbed crossing still reaches the shared bank route');
    }
    for (const route of [...wide.streets, ...wide.approaches]) dry(route.points, wide.ribbons);
});

for (const riverWidthScale of [.25, 1, 1.5, 2, 2.5, 3]) test(`reported seed 2867488715 at river width ${riverWidthScale}: landmarks stay dry and bridges stay separate`, () => {
    const city = generateCity({
        seed: '2867488715',
        size: 34,
        citadel: true,
        urban_castle: true,
        plaza: true,
        temple: true,
        marketCount: 2,
        templeCount: 4,
        walls: true,
        shantytown: true,
        river: true,
        coast: false,
        greens: true,
        hub: false,
        gates: -1,
        sea: 0,
        riverWidthScale,
        riverCurvature: 1.09
    });
    assert.equal(city.markets.length, 2);
    assert.equal(city.special.filter(b => b.kind === 'temple').length, 4);
    const water = [...city.terrain.ribbons, ...city.terrain.sea];
    for (const site of city.generatedGeometry.experimental.districtLandmarks.sites) {
        for (const polygon of [site.polygon, ...(site.building ? [site.building, site.tower] : site.stalls)].map(p => p.map(([x, y]) => [x, -y]))) {
            for (const wet of water) assert.ok(overlap(polygon, wet) < 1e-5, `${site.kind} overlaps water`);
        }
    }
    separate(city.bridges);
    if (riverWidthScale === 3) {
        assert.equal(city.bridges.length, 2);
        assert.equal(city.bridges.filter(b => b.origins.length === 3).length, 1);
    }
    assert.equal(city.approaches.length, city.bridges.length * 2);
    for (const bridge of city.bridges) for (const rail of bridge.rails) for (const end of rail) {
        const bank = city.terrain.ribbons[bridge.river];
        assert.ok(Math.min(...bank.map((p, i) => segmentDistance(end, p, bank[(i + 1) % bank.length]))) < 1e-5);
    }
    for (const route of [...city.streets, ...city.approaches]) dry(route.points, water);
    const restored = cityFromGeometry(structuredClone(city.generatedGeometry), city.options);
    assert.deepEqual(restored.bridges, city.bridges);
    assert.deepEqual(restored.markets, city.markets);
});

test('saved and legacy landmark layers use the same water mask as ordinary buildings', () => {
    const city = generateCity({seed: '2867488715', coast: false, riverWidthScale: 3});
    const svg = renderMap(city);
    for (const layer of ['market', 'temple', 'castle']) assert.match(svg, new RegExp(`id="layer-${layer}"[^>]*mask="url\\(#dry-land\\)"`));
});

for (const [seed, size] of [['42', 90], ['1931200012', 34], ['762337811', 34], ['2867488715', 90]]) test(`wide bends retain dry bridge landings and do not leave folded water boundaries: ${seed}/${size}`, () => {
    const city = generateCity({
        seed,
        size,
        coast: false,
        riverWidthScale: 3,
        riverCurvature: 1.09,
        marketCount: 2,
        templeCount: 4
    });
    const water = city.terrain.ribbons;
    separate(city.bridges);
    assert.equal(city.approaches.length, city.bridges.length * 2);
    for (const route of [...city.streets, ...city.approaches]) dry(route.points, water);
    for (const building of city.buildings) for (const wet of water) assert.ok(overlap(building.polygon, wet) < 1e-5);
});
