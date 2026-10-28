import test from 'node:test';
import assert from 'node:assert/strict';
import {area, centroid, clip, inset, inside, segmentSegmentDistance, splitLots, voronoi} from '../src/core/geometry.js';
import {random} from '../src/core/random.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
test('half-plane clipping preserves exact area and centroid', () => {
    const half = clip(square, [1, 0], 40);
    assert.equal(area(half), 4000);
    assert.deepEqual(centroid(half), [20, 50]);
    assert.equal(clip(square, [1, 0], -1).length, 0);
});
test('inset uses edge normals and handles either polygon winding', () => {
    assert.equal(area(inset(square, 10)), 6400);
    assert.equal(area(inset([...square].reverse(), 10)), 6400);
    assert.equal(inset(square, 60).length, 0);
});
test('Voronoi cells partition the bounding polygon without losing area', () => {
    const sites = [[20, 20], [80, 20], [50, 75], [25, 60]];
    const cells = voronoi(sites, square);
    assert.ok(Math.abs(cells.reduce((s, p) => s + area(p), 0) - area(square)) < 1e-6);
    cells.forEach((cell, i) => assert.ok(inside(sites[i], cell)));
});
test('subdivision preserves coverage instead of overlapping independent rectangles', () => {
    const lots = splitLots(square, random('test'), 180);
    assert.ok(lots.length > 20);
    assert.ok(Math.abs(lots.reduce((s, p) => s + area(p), 0) - area(square)) < 1e-6);
});
test('water intersection detects a crossing even if both segment endpoints are dry', () => {
    assert.equal(segmentSegmentDistance([0, 0], [100, 100], [0, 100], [100, 0]), 0);
    assert.equal(segmentSegmentDistance([0, 0], [10, 0], [20, 0], [30, 0]), 10);
});
