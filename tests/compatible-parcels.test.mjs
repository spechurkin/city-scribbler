import test from 'node:test';
import assert from 'node:assert/strict';
import {orientedBounds, ParcelDivider, splitParcel} from '../src/compatible/parcels.js';
import {polygonBoolean, signedArea} from '../src/compatible/polygons.js';
import {Sequence} from '../src/compatible/sequence.js';

const area = polygon => Math.abs(signedArea(polygon));
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('oriented bounds recover a rotated rectangle and enclose a concave outline', () => {
    const rotate = ([x, y]) => [x * Math.cos(.731) - y * Math.sin(.731), y * Math.cos(.731) + x * Math.sin(.731)];
    const rectangle = [[0, 0], [12, 0], [12, 4], [0, 4]].map(rotate);
    near(area(orientedBounds(rectangle)), 48);
    const concave = [[0, 0], [12, 0], [12, 4], [6, 4], [6, 9], [0, 9]].map(rotate);
    const bounds = orientedBounds(concave);
    near(area(bounds), 108);
    near(polygonBoolean(concave, bounds, 'intersection').reduce((sum, p) => sum + signedArea(p), 0), area(concave));
});

test('bent cut follows both boundary arcs without losing or overlapping area', () => {
    const polygon = [[0, 0], [10, 0], [10, 10], [0, 10]], chain = [[3, 0], [3, 6], [10, 6]];
    const parts = splitParcel(polygon, 0, 1, chain);
    near(parts.reduce((sum, p) => sum + area(p), 0), 100);
    near(polygonBoolean(parts[0], parts[1], 'intersection').reduce((sum, p) => sum + signedArea(p), 0), 0);
});

test('parcel subdivision conserves area and keeps separate leaf interiors for independent seeds', () => {
    const polygons = [[[0, 0], [25, 0], [25, 19], [0, 19]], [[0, 0], [24, 2], [20, 18], [9, 26], [-3, 15]], [[0, 0], [30, 0], [30, 10], [12, 10], [12, 27], [0, 27]]];
    for (const seed of [1, 42, 314159]) for (const polygon of polygons) {
        const divider = new ParcelDivider(polygon, {
            minimumArea: 22,
            variance: 2.7,
            minimumTurnOffset: .5
        }, new Sequence(seed));
        const parts = divider.partition();
        assert.ok(parts.length > 1);
        near(parts.reduce((sum, p) => sum + area(p), 0), area(polygon));
        assert.ok(parts.every(p => p.length >= 3 && area(p) > 1e-6 && p.every(point => point.every(Number.isFinite))));
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
            const overlap = polygonBoolean(parts[i], parts[j], 'intersection').reduce((sum, p) => sum + signedArea(p), 0);
            assert.ok(Math.abs(overlap) < 1e-5, `overlap ${overlap} for seed ${seed}`);
        }
    }
});

test('alley gaps remove a bounded part of the original parcel', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]],
        divider = new ParcelDivider(polygon, {minimumArea: 100, variance: 3, gap: 1.2}, new Sequence(514));
    const parts = divider.partition(), remaining = parts.reduce((sum, p) => sum + area(p), 0);
    assert.ok(divider.cuts.length > 0);
    assert.ok(remaining < area(polygon));
    assert.ok(remaining > area(polygon) * .7);
});

test('a folded face cannot become a large positive parcel by taking the absolute value of its area', () => {
    const polygon = [[0, 0], [0, 40], [30, 40], [30, 0]], sequence = new Sequence(514);
    const divider = new ParcelDivider(polygon, {minimumArea: 20, variance: 3}, sequence);
    assert.deepEqual(divider.partition(), [polygon]);
    assert.equal(divider.cuts.length, 0);
    assert.equal(sequence.draws, 4);
});

test('a cut with no forward exit remains local rather than restarting city generation', () => {
    const polygon = [[0, 0], [0, 40], [30, 40], [30, 0]];
    const divider = new ParcelDivider(polygon, {minimumArea: 20, variance: 3}, new Sequence(514));
    assert.deepEqual(divider.cut(polygon), [polygon]);
    assert.equal(divider.cuts.length, 0);
});
