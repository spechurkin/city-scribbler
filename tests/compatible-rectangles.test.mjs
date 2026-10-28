import test from 'node:test';
import assert from 'node:assert/strict';
import {inscribedRectangle, shrinkPolygon} from '../src/compatible/rectangles.js';
import {polygonBoolean, signedArea} from '../src/compatible/polygons.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const area = polygon => Math.abs(signedArea(polygon));

test('edge-anchored maximum rectangle agrees with elementary rectangle and right-triangle solutions', () => {
    near(area(inscribedRectangle([[0, 0], [12, 0], [12, 5], [0, 5]])), 60);
    near(area(inscribedRectangle([[0, 0], [10, 0], [0, 10]])), 25);
    near(area(inscribedRectangle([[0, 0], [10, 0], [0, 16]])), 40);
});

test('the largest rectangle remains inside a concave L and selects the larger arm', () => {
    const polygon = [[0, 0], [10, 0], [10, 3], [4, 3], [4, 10], [0, 10]], rectangle = inscribedRectangle(polygon);
    near(area(rectangle), 40);
    const overlap = polygonBoolean(polygon, rectangle, 'intersection').reduce((sum, p) => sum + signedArea(p), 0);
    near(overlap, 40);
});

test('rectangle fitting is invariant under a rigid rotation and translation', () => {
    const transform = ([x, y]) => [100 + x * Math.cos(.731) - y * Math.sin(.731), -50 + y * Math.cos(.731) + x * Math.sin(.731)];
    const polygon = [[0, 0], [12, 0], [12, 5], [0, 5]].map(transform);
    near(area(inscribedRectangle(polygon)), 60);
});

test('ordered inward edge cuts agree with an elementary square inset', () => {
    const polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    near(area(shrinkPolygon(polygon, 1)), 64);
    near(area(shrinkPolygon(polygon, [1, 2, 1, 2])), 48);
});
