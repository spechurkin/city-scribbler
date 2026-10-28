import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedStreets} from '../src/roads/street-network.js';
import {wallStreets} from '../src/compatible/local-streets.js';
import {rectangle} from '../src/core/geometry.js';

test('spatial street splitting retains source order across many separate junctions', () => {
    const roads = [];
    for (let i = 1999; i >= 0; i--) {
        const x = i * 100;
        roads.push({id: `main-${i}`, points: [[x, 0], [x, 20]], major: true},
            {id: `alley-${i}`, points: [[x, 10], [x + 20, 10]]},
            {id: `end-${i}`, points: [[x + 20, 0], [x + 20, 20]], major: true});
    }
    const result = connectedStreets(roads);
    assert.equal(result.length, roads.length);
    assert.deepEqual(result.filter(r => !r.major), roads.filter(r => !r.major));
});

test('wall corridor filtering keeps nearby collisions and ignores distant housing', () => {
    const points = [[0, 0], [40, 0], [40, 30], [0, 30]],
        edges = points.map((point, i) => ({point, next: {point: points[(i + 1) % points.length]}})),
        lots = [rectangle([38.55, 15], 2, 4)],
        terrain = {
            walls: [{edges, segments: [false, true, false, false], gates: [], towers: []}],
            districts: [{groups: [{border: edges, blocks: [{lots}]}]}]
        };
    const expected = wallStreets(terrain);
    assert.equal(expected.length, 2);
    assert.ok(expected.every(path => path.every(p => p[1] < 13 || p[1] > 17)));
    for (let i = 0; i < 10000; i++) lots.push(rectangle([1000 + i * 10, 1000], 4, 4));
    assert.deepEqual(wallStreets(terrain), expected);
});
