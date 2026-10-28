import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateStructure, structureGeometry} from '../src/compatible/structure.js';
import {buildDistricts} from '../src/compatible/districts.js';
import {buildTowers} from '../src/compatible/available.js';
import {buildHousing} from '../src/compatible/housing.js';
import {metricPoint} from '../src/compatible/terrain.js';
import {parseMfcgReference} from '../src/io/mfcg-reference.js';
import {comparePaths} from '../src/compatible/compare.js';
import {contains, signedArea} from '../src/compatible/polygons.js';
import {centroid} from '../src/compatible/math.js';
import {segmentDistance} from '../src/core/geometry.js';

const fixtures = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
for (const name of ['Palwe', 'Mugyoma', 'Goldbrook', 'Mpiyanga', 'Frampton', 'Berford', 'Hrošev']) {
    test(`${name}: district boundaries match native geometry without using native district names`, async () => {
        const fixture = fixtures.find(f => f.name === name), reference = parseMfcgReference(fixture.url);
        const terrain = buildDistricts(generateStructure({
            seed: reference.seed,
            size: reference.size, ...reference.flags, ...reference.optional
        }));
        const native = JSON.parse(await readFile(new URL(`fixtures/mfcg/${name.toLowerCase()}.json`, import.meta.url)));
        const expected = native.features.find(f => f.id === 'districts').geometries.map(g => g.coordinates[0]);
        const comparison = comparePaths(terrain.districts.map(d => d.border.map(e => metricPoint(e.point))), expected, {closed: true});
        assert.equal(comparison.match, true);
        const assigned = terrain.districts.flatMap(d => d.cells);
        assert.equal(assigned.length, terrain.cells.filter(c => c.urban).length);
        assert.equal(new Set(assigned).size, assigned.length);
    });
}

for (const {name, core} of [{name: 'Frampton', core: 2}, {
    name: 'Goldbrook',
    core: 1
}]) test(`${name}: every frontage in a small complete group matches the native export`, async () => {
    const fixture = fixtures.find(f => f.name === name), reference = parseMfcgReference(fixture.url);
    const terrain = buildHousing(buildDistricts(buildTowers(generateStructure({
        seed: reference.seed,
        size: reference.size, ...reference.flags, ...reference.optional
    }))));
    const group = terrain.districts.flatMap(d => d.groups).find(g => g.core.id === core);
    const native = JSON.parse(await readFile(new URL(`fixtures/mfcg/${name.toLowerCase()}.json`, import.meta.url)));
    const expected = native.features.find(f => f.id === 'buildings').coordinates.map(p => p[0]).filter(p => {
        const center = centroid(p);
        return contains(group.shape, [center[0] / 4, -center[1] / 4]);
    });
    assert.ok(expected.length >= 6);
    const lots = group.blocks.flatMap(b => b.lots).map(p => p.map(metricPoint));
    assert.equal(comparePaths(lots, expected, {closed: true}).match, true);
});

for (const processing of ['none', 'offset']) test(`housing ${processing}: deterministic lots remain in their groups and leave structural geometry intact`, () => {
    const recipe = {
        seed: '631780021981',
        size: 31,
        coast: false,
        river: false,
        walls: true,
        plaza: true,
        citadel: true,
        greens: true
    };
    const build = () => {
        const terrain = buildTowers(buildDistricts(generateStructure(recipe))), {
            experimental: beforeExperimental,
            completeness: beforeCompleteness,
            ...before
        } = structureGeometry(terrain);
        buildHousing(terrain, {processing});
        const {experimental: afterExperimental, completeness: afterCompleteness, ...after} = structureGeometry(terrain);
        assert.deepEqual(after, before);
        const groups = terrain.districts.flatMap(d => d.groups);
        let lots = 0;
        for (const group of groups) for (const block of group.blocks) for (const lot of block.lots) {
            lots++;
            assert.ok(lot.length >= 3 && signedArea(lot) > 0);
            assert.ok(lot.every(p => p.every(Number.isFinite)));
            for (const point of lot) {
                const onBoundary = group.shape.some((a, i) => segmentDistance(point, a, group.shape[(i + 1) % group.shape.length]) < 1e-6);
                assert.ok(onBoundary || contains(group.shape, point));
            }
        }
        assert.ok(lots > 100);
        return groups.map(g => ({core: g.core.id, alleys: g.alleys, lots: g.blocks.flatMap(b => b.lots)}));
    };
    assert.deepEqual(build(), build());
});
