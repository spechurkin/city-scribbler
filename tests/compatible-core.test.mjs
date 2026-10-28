import test from 'node:test';
import assert from 'node:assert/strict';
import {Sequence} from '../src/compatible/sequence.js';
import {buildInitialCells, radialSites} from '../src/compatible/cells.js';
import {area} from '../src/core/geometry.js';
import {selectUrbanCells} from '../src/compatible/junctions.js';

test('48271 sequence matches independent published integer reference values', () => {
    const sequence = new Sequence(1), expected = [48271, 182605794, 1291394886, 1914720637, 2078669041];
    for (const value of expected) {
        sequence.next();
        assert.equal(sequence.state, value);
    }
});
test('large seed starts with Number arithmetic before entering the 31-bit state space', () => {
    const sequence = new Sequence('892374508970549');
    sequence.next();
    assert.equal(sequence.state, 1467812309);
    sequence.next();
    assert.equal(sequence.state, 840002268);
});
test('isolated generation restores the exact sequence and counter even on failure', () => {
    const sequence = new Sequence(42), before = sequence.checkpoint();
    assert.throws(() => sequence.isolated(r => {
        r.next();
        throw new Error('test');
    }));
    assert.deepEqual(sequence.checkpoint(), before);
});

test('a successful branch restores its sequence, while a rejected layout retains consumed draws for retry', () => {
    const sequence = new Sequence(1234), before = sequence.checkpoint();
    sequence.branch(r => r.next());
    assert.deepEqual(sequence.checkpoint(), before);
    assert.throws(() => sequence.branch(r => {
        r.next();
        throw new Error('rejected layout');
    }));
    assert.equal(sequence.draws, before.draws + 1);
    assert.notEqual(sequence.state, before.state);
});
test('central plaza changes central sites without shifting the rest of the terrain', () => {
    const a = radialSites({seed: '84862492', size: 70, plaza: true}),
        b = radialSites({seed: '84862492', size: 70, plaza: false});
    assert.deepEqual(a.points.slice(5), b.points.slice(5));
    assert.notDeepEqual(a.points.slice(1, 5), b.points.slice(1, 5));
    assert.deepEqual(a.sequence.checkpoint(), b.sequence.checkpoint());
    assert.equal(a.points.length, 70 * 8 + 6);
});

test('an internal castle may occupy the central cell when the plaza is disabled', () => {
    const make = () => {
        const layout = buildInitialCells({seed: '798451', size: 25, plaza: false});
        for (const cell of layout.cells) cell.water = false;
        layout.sequence.restore({state: 1, draws: 0});
        return layout;
    };
    const a = make(), withoutPlaza = selectUrbanCells(a, {size: 25, citadel: true, urbanCastle: true, plaza: false});
    assert.equal(withoutPlaza.plaza, null);
    assert.equal(withoutPlaza.castle, withoutPlaza.centerCell);
    const b = make(), withPlaza = selectUrbanCells(b, {size: 25, citadel: true, urbanCastle: true, plaza: true});
    assert.notEqual(withPlaza.castle, withPlaza.plaza);
});
test('unbounded cell construction produces shared finite nonzero polygons for arbitrary seeds', () => {
    for (const seed of ['1', '891749', '5694989849646']) {
        const result = buildInitialCells({seed, size: 58, plaza: true});
        assert.ok(result.cells.length > 58);
        for (const cell of result.cells) {
            assert.ok(area(cell.polygon) > 0);
            assert.ok(cell.polygon.every(p => Math.hypot(...p) <= result.radius));
        }
        assert.ok(Math.hypot(...result.ordered[0].center) < 5);
    }
});
