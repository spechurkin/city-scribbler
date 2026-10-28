import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingFootprint} from '../src/compatible/footprints.js';
import {Sequence} from '../src/compatible/sequence.js';
import {signedArea} from '../src/compatible/polygons.js';

const bounds = [[0, 0], [24, 0], [24, 16], [0, 16]];

test('connected room growth produces reproducible finite footprints inside their frame', () => {
    let built = 0;
    for (const seed of [1, 7, 42, 1917, 987654321]) {
        const sequence = new Sequence(seed), polygon = buildingFootprint(bounds, 16, sequence, {jitter: .4});
        assert.deepEqual(buildingFootprint(bounds, 16, new Sequence(seed), {jitter: .4}), polygon);
        if (!polygon) continue;
        built++;
        assert.ok(polygon.length >= 4 && Math.abs(signedArea(polygon)) > 0 && Math.abs(signedArea(polygon)) <= 384);
        assert.ok(polygon.every(p => p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 24 && p[1] >= 0 && p[1] <= 16));
    }
    assert.ok(built > 0);
});

test('a symmetric room plan reflects across the frame centre when grid jitter is zero', () => {
    let tested = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
        const polygon = buildingFootprint(bounds, 16, new Sequence(seed), {symmetric: true});
        if (!polygon) continue;
        tested++;
        for (const [x, y] of polygon) assert.ok(polygon.some(p => Math.abs(p[0] - (24 - x)) < 1e-9 && Math.abs(p[1] - y) < 1e-9));
    }
    assert.ok(tested > 0);
});

test('a front-based footprint keeps the complete front edge', () => {
    const polygon = buildingFootprint(bounds, 16, new Sequence(195), {front: true});
    assert.ok(polygon);
    assert.ok(polygon.some(p => p[0] === 0 && p[1] === 0));
    assert.ok(polygon.some(p => p[0] === 24 && p[1] === 0));
});

test('a frame too narrow for two rooms returns the frame fallback without consuming random draws', () => {
    const sequence = new Sequence(81);
    assert.equal(buildingFootprint([[0, 0], [3, 0], [3, 20], [0, 20]], 16, sequence), null);
    assert.equal(sequence.draws, 0);
});
