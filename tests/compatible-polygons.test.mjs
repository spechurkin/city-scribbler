import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clipSingle,
    largestPolygon,
    polygonBoolean,
    signedArea,
    stripe,
    variableInset
} from '../src/compatible/polygons.js';
import {area, clip} from '../src/core/geometry.js';

const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const total = polygons => polygons.reduce((sum, p) => sum + signedArea(p), 0);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('polygon intersection, difference and union preserve independently known rectangle areas', () => {
    const a = square(0, 0, 4), b = square(2, 2, 4);
    near(total(polygonBoolean(a, b, 'intersection')), 4);
    near(total(polygonBoolean(a, b, 'difference')), 12);
    near(total(polygonBoolean(a, b, 'union')), 28);
    near(total(polygonBoolean([...a].reverse(), b, 'intersection')), 4);
});

test('subtraction retains both disconnected components and a contained hole with its winding', () => {
    const a = square(0, 0, 4), slice = [[1, -1], [3, -1], [3, 5], [1, 5]];
    const pieces = polygonBoolean(a, slice, 'difference');
    assert.equal(pieces.length, 2);
    near(total(pieces), 8);
    const hole = polygonBoolean(a, square(1, 1, 2), 'difference');
    assert.equal(hole.length, 2);
    near(total(hole), 12);
    assert.ok(hole.some(p => signedArea(p) < 0));
});

test('coincident and shared edges do not produce duplicate boundary loops', () => {
    const a = square(0, 0, 2), b = square(2, 0, 2);
    near(total(polygonBoolean(a, b, 'union')), 8);
    assert.equal(polygonBoolean(a, b, 'intersection').length, 0);
    near(total(polygonBoolean(a, b, 'difference')), 4);
    near(total(polygonBoolean(a, a, 'intersection')), 4);
    assert.equal(polygonBoolean(a, a, 'difference').length, 0);
});

test('single-component clipping keeps the first boundary crossing as a stable anchor', () => {
    const a = square(0, 0, 4), b = square(2, 2, 4);
    const intersection = clipSingle(a, b, 'intersection'), difference = clipSingle(a, b, 'difference');
    near(signedArea(intersection), 4);
    near(signedArea(difference), 12);
    assert.deepEqual(intersection[0], [4, 2]);
    assert.deepEqual(difference[0], [4, 2]);
});

test('a concave polygon clipped by an independent half-plane has the same area', () => {
    const concave = [[0, 0], [7, 0], [7, 2], [3, 2], [3, 6], [0, 6]];
    for (const limit of [1, 2.5, 4.7, 6.1]) {
        const rectangle = [[-10, -10], [limit, -10], [limit, 10], [-10, 10]];
        near(total(polygonBoolean(concave, rectangle, 'intersection')), area(clip(concave, [1, 0], limit)));
    }
});

test('variable edge offsets agree with elementary inset dimensions and leave zero offsets untouched', () => {
    const a = square(0, 0, 10);
    assert.equal(variableInset(a, [0, 0, 0, 0]), a);
    near(area(variableInset(a, [1, 1, 1, 1])), 64);
    near(area(variableInset(a, [1, 2, 1, 2])), 48);
    near(area(variableInset(a, [0, 2, 0, 0])), 80);
    assert.equal(stripe([[0, 0], [10, 0]], 1).length, 4);
    assert.equal(largestPolygon([]), null);
});
