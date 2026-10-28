import test from 'node:test';
import assert from 'node:assert/strict';
import {Sequence} from '../src/compatible/sequence.js';
import {PeriodicTreePattern, TreeField} from '../src/compatible/trees.js';

test('procedural periodic pattern respects its minimum separation across tile boundaries', () => {
    const pattern = new PeriodicTreePattern(new Sequence(1));
    assert.ok(pattern.points.length > 100);
    for (let i = 0; i < pattern.points.length; i++) {
        const point = pattern.points[i];
        assert.ok(point[0] >= 0 && point[0] < 30 && point[1] >= 0 && point[1] < 30);
        for (let j = i + 1; j < pattern.points.length; j++) {
            const other = pattern.points[j], x = Math.abs(point[0] - other[0]), y = Math.abs(point[1] - other[1]),
                dx = Math.min(x, 30 - x), dy = Math.min(y, 30 - y);
            assert.ok(dx * dx + dy * dy >= 2.25 * 2.25 - 1e-10);
        }
    }
});

test('periodic sampling translates exactly by a full tile and is reproducible from the pattern seed', () => {
    const pattern = new PeriodicTreePattern(new Sequence(13)), other = new PeriodicTreePattern(new Sequence(13));
    assert.deepEqual(pattern.points, other.points);
    const a = pattern.inside([[0, 0], [30, 0], [30, 30], [0, 30]]),
        b = pattern.inside([[30, 0], [60, 0], [60, 30], [30, 30]]);
    assert.deepEqual(b, a.map(p => [p[0] + 30, p[1]]));
});

test('tree area density filtering is deterministic and zero density produces no trees', () => {
    const field = new TreeField(), polygon = [[-10, -10], [40, -10], [40, 35], [-10, 35]];
    const points = field.area(polygon, .5);
    assert.ok(points.length > 20);
    assert.deepEqual(field.area(polygon, .5), points);
    assert.deepEqual(field.area(polygon, 0), []);
    assert.ok(points.every(p => p[0] >= -10 && p[0] <= 40 && p[1] >= -10 && p[1] <= 35));
});

test('tree line sampling consumes one draw per candidate even if density rejects every point', () => {
    const field = new TreeField(), sequence = new Sequence(7);
    assert.deepEqual(field.line([0, 0], [9, 0], 0, sequence), []);
    assert.equal(sequence.draws, 3);
});
