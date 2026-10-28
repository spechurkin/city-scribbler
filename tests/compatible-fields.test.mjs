import test from 'node:test';
import assert from 'node:assert/strict';
import {generateStructure, structureGeometry} from '../src/compatible/structure.js';
import {buildTowers} from '../src/compatible/available.js';
import {buildFields} from '../src/compatible/fields.js';
import {cutPolygon} from '../src/compatible/parcels.js';
import {contains, signedArea} from '../src/compatible/polygons.js';
import {segmentDistance} from '../src/core/geometry.js';

test('infinite straight cuts return the left side first and keep the requested gap', () => {
    const polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const parts = cutPolygon(polygon, [5, -1], [5, 11]);
    assert.ok(parts[0].every(p => p[0] <= 5));
    assert.ok(parts[1].every(p => p[0] >= 5));
    assert.equal(parts.reduce((sum, p) => sum + signedArea(p), 0), 100);
    const gapped = cutPolygon(polygon, [5, -1], [5, 11], 2);
    assert.ok(gapped[0].every(p => p[0] <= 4));
    assert.ok(gapped[1].every(p => p[0] >= 6));
    assert.equal(gapped.reduce((sum, p) => sum + signedArea(p), 0), 80);
});

test('field generation uses each cell seed, remains inside farm cells and preserves structural state', () => {
    const recipe = {seed: '516423798', size: 33, coast: false, river: false, walls: true, citadel: true};
    const make = () => {
        const terrain = buildTowers(generateStructure(recipe)), before = structureGeometry(terrain);
        buildFields(terrain);
        const after = structureGeometry(terrain);
        after.completeness = before.completeness;
        assert.deepEqual(after, before);
        let count = 0;
        for (const cell of terrain.cells) if (cell.fields) for (const plot of cell.fields) {
            count++;
            assert.ok(signedArea(plot) > 0);
            assert.ok(plot.every(p => p.every(Number.isFinite)));
            for (const point of plot) assert.ok(contains(cell.polygon, point) || cell.polygon.some((p, i) => segmentDistance(point, p, cell.polygon[(i + 1) % cell.polygon.length]) < 1e-6));
        }
        assert.ok(count > 0);
        return terrain.fields;
    };
    assert.deepEqual(make(), make());
});
