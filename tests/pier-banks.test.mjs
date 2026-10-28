import test from 'node:test';
import assert from 'node:assert/strict';
import {anchorPiersToBanks, dryPieces} from '../src/roads/bridge-network.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {distance, inside, lerp, segmentDistance} from '../src/core/geometry.js';

const sea = [[0, -200], [200, -200], [200, 200], [0, 200]];
const river = [[-20, -100], [20, -100], [20, 100], [-20, 100]];

test('a pier reaches the exposed bank through overlapping sea and river water', () => {
    const piers = [[[0, 0], [32, 0]], [[0, 150], [32, 150]]], original = structuredClone(piers);
    const result = anchorPiersToBanks(piers, [sea, river]);
    assert.deepEqual(result, [[[-20, 0], [32, 0]], piers[1]]);
    assert.deepEqual(piers, original);
    assert.deepEqual(anchorPiersToBanks(result, [sea, river]), result);
    assert.deepEqual(anchorPiersToBanks(piers, []), piers);
});

test('overlapping river banks and an island use the nearest exposed land along the pier axis', () => {
    const wider = river.map(([x, y]) => [x * 2, y]);
    assert.deepEqual(anchorPiersToBanks([[[0, 0], [32, 0]]], [sea, river, wider]), [[[-40, 0], [32, 0]]]);
    const hole = [[-15, -10], [-5, -10], [-5, 10], [-15, 10]];
    assert.deepEqual(anchorPiersToBanks([[[0, 0], [32, 0]]], [sea, {
        polygon: river,
        holes: [hole]
    }]), [[[-5, 0], [32, 0]]]);
});

test('Ust-Amursk estuary piers connect to visible land, including with a wider river', () => {
    for (const riverWidthScale of [1, 2]) {
        const city = generateCity({
            seed: '79510967', size: 64, citadel: true, urban_castle: true,
            plaza: true, temple: true, walls: true, shantytown: true,
            river: true, coast: true, greens: true, hub: false, gates: -1,
            sea: 1.70892018779343, riverWidthScale
        });
        const water = [...city.terrain.sea, ...city.terrain.ribbons];
        assert.ok(city.docks.length > 0);
        let extended = 0;
        for (const [i, dock] of city.docks.entries()) {
            const [a, b] = dock.points, length = distance(a, b),
                landward = lerp(a, b, -.001 / length);
            assert.ok(!water.some(polygon => inside(landward, polygon)), `pier ${i} has dry access`);
            assert.ok(Math.min(...water.flatMap(polygon => polygon.map((p, j) => segmentDistance(a, p, polygon[(j + 1) % polygon.length])))) < 1e-6);
            assert.equal(dryPieces(dock.points, water).length, 0, `pier ${i} extends into water`);
            const source = city.generatedGeometry.piers.map(p => p.map(([x, y]) => [x, -y])).find(p => distance(p[1], b) < 1e-6) || city.generatedGeometry.experimental.portLayout.docks.find(d => distance(d.points[1], b) < 1e-6).points;
            assert.deepEqual(b, source[1]);
            if (distance(a, source[0]) > 1e-6) extended++;
        }
        assert.ok(extended > 0);
    }
});
