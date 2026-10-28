import test from 'node:test';
import assert from 'node:assert/strict';
import {directInset, fractalBoundary, resampleClosed, smoothClosed} from '../src/compatible/vegetation-geometry.js';
import {signedArea} from '../src/compatible/polygons.js';
import {Sequence} from '../src/compatible/sequence.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

test('direct contour offsets agree with an elementary square inset', () => {
    assert.equal(signedArea(directInset(square, [10, 10, 10, 10])), 6400);
});

test('an extra vertex on a straight contour has a finite perpendicular offset', () => {
    const polygon = [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]],
        result = directInset(polygon, [10, 10, 10, 10, 10]);
    assert.deepEqual(result[1], [50, 10]);
    assert.equal(signedArea(result), 6400);
    assert.ok(result.flat().every(Number.isFinite));
});

test('closed resampling follows the perimeter with evenly spaced samples', () => {
    const result = resampleClosed(square, 10);
    assert.equal(result.length, 40);
    assert.deepEqual(result[0], [0, 100]);
    for (let i = 0; i < result.length; i++) assert.equal(Math.hypot(result[i][0] - result[(i + 1) % result.length][0], result[i][1] - result[(i + 1) % result.length][1]), 10);
});

test('fractal boundary refinement is procedural and consumes three draws at every inserted midpoint', () => {
    const sequence = new Sequence(72), refined = fractalBoundary(square, sequence);
    assert.equal(refined.length, 16);
    assert.equal(sequence.draws, 36);
    assert.deepEqual(fractalBoundary(square, new Sequence(72)), refined);
    assert.notDeepEqual(fractalBoundary(square, new Sequence(73)), refined);
});

test('closed cubic smoothing keeps its contour anchors and produces finite intermediate points', () => {
    const result = smoothClosed(square);
    assert.equal(result.length, 20);
    for (let i = 0; i < square.length; i++) assert.deepEqual(result[i * 5], square[i]);
    assert.ok(result.every(p => p.every(Number.isFinite)));
});
