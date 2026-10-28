import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateModel} from '../src/compatible/city.js';
import {outerWallStreets, wallStreets} from '../src/compatible/local-streets.js';
import {bounds, distance, inside, segmentDistance, segmentSegmentDistance} from '../src/core/geometry.js';
import {dryPieces} from '../src/roads/bridge-network.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';

test('wall streets follow only actual wall segments on the housing side', () => {
    const points = [[0, 0], [40, 0], [40, 30], [0, 30]],
        edges = points.map((point, i) => ({point, next: {point: points[(i + 1) % points.length]}})),
        wall = {edges, segments: [false, true, false, false], gates: [], towers: []},
        terrain = {walls: [wall], districts: [{groups: [{border: edges}]}]};
    const before = structuredClone(terrain);
    assert.deepEqual(wallStreets(terrain), [[[38.55, 0], [38.55, 30]]]);
    assert.deepEqual(terrain, before);
    wall.segments[1] = false;
    assert.deepEqual(wallStreets(terrain), []);
    terrain.walls = [];
    assert.deepEqual(wallStreets(terrain), []);
});

test('an exterior circuit follows both orientations of a wall and disappears when the wall is disabled', () => {
    for (const reversed of [false, true]) {
        const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
        if (reversed) polygon.reverse();
        const edges = polygon.map((point, i) => ({point, next: {point: polygon[(i + 1) % polygon.length]}})),
            wall = {polygon, edges, segments: edges.map(() => true), towers: [], gates: []},
            terrain = {walls: [wall], districts: []}, paths = outerWallStreets(terrain);
        assert.equal(paths.length, 1);
        assert.ok(distance(paths[0][0], paths[0].at(-1)) < 1e-7);
        assert.ok(paths[0].every(p => !inside(p, polygon)));
        assert.ok(bounds(paths[0]).every((v, i) => Math.abs(v - [-1.7, -1.7, 41.7, 31.7][i]) < 1e-7));
        wall.segments.fill(false);
        assert.deepEqual(outerWallStreets(terrain), []);
    }
});

test('deriving wall streets preserves all generation checkpoints and housing', () => {
    const terrain = generateModel({seed: '1931200012', size: 34, coast: true, river: true, walls: true}),
        before = terrain.sequence.checkpoint(),
        housing = JSON.stringify(terrain.districts.map(d => d.groups.map(g => g.blocks))),
        first = [...wallStreets(terrain), ...outerWallStreets(terrain)];
    assert.ok(first.length > 0);
    assert.deepEqual([...wallStreets(terrain), ...outerWallStreets(terrain)], first);
    assert.deepEqual(terrain.sequence.checkpoint(), before);
    assert.equal(JSON.stringify(terrain.districts.map(d => d.groups.map(g => g.blocks))), housing);
});

const fixtures = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
for (const recipe of [{seed: '1931200012'}, {seed: '42', size: 60, river: true, coast: false},
    ...fixtures.map(f => ({seed: f.url}))]) test(`wall streets fit between houses and fortifications: ${recipe.seed}`, () => {
    const city = generateCity(recipe), roads = city.streets.filter(r => /^(outer-)?wall-/.test(r.id)),
        water = [...city.terrain.sea, ...city.terrain.ribbons],
        buildings = [...city.buildings, ...city.special, ...city.fields].flatMap(b => [b.polygon, ...(b.tower ? [b.tower] : [])]).map(polygon => ({
            polygon,
            box: bounds(polygon)
        }));
    if (!city.walls.length) assert.equal(roads.length, 0);
    else assert.ok(roads.length > 0);
    if (city.options.walls) assert.ok(roads.some(r => r.id.startsWith('outer-wall-') && r.points.some(p => !inside(p, city.walls[0].polygon))), 'the free land outside the city wall also has streets');
    for (const road of roads) for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i], radius = road.width / 2,
            box = [Math.min(a[0], b[0]) - radius, Math.min(a[1], b[1]) - radius, Math.max(a[0], b[0]) + radius, Math.max(a[1], b[1]) + radius];
        const dry = dryPieces([a, b], water).reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0);
        assert.ok(Math.abs(dry - distance(a, b)) < 1e-5, 'wall streets stay on land');
        for (const building of buildings) {
            const p = building.polygon, bb = building.box;
            if (bb[0] >= box[2] || bb[2] <= box[0] || bb[1] >= box[3] || bb[3] <= box[1]) continue;
            assert.ok(!inside(a, p) && !inside(b, p) && p.every((v, j) => segmentSegmentDistance(v, p[(j + 1) % p.length], a, b) >= radius - 1e-5), `wall street overlaps a building: ${road.id}`);
        }
        for (const wall of city.walls) {
            wall.polygon.forEach((p, j) => {
                if (wall.segments[j]) assert.ok(segmentSegmentDistance(p, wall.polygon[(j + 1) % wall.polygon.length], a, b) >= 2.4 + radius - 1e-5, 'wall street clears the wall itself');
            });
            for (const tower of wall.towers) assert.ok(segmentDistance(tower, a, b) >= 3.7 + radius - 1e-5, 'wall street clears towers');
            for (const gate of wall.gates) assert.ok(segmentDistance(gate, a, b) >= 5 + radius - 1e-5, 'wall street clears gates');
        }
    }
    assert.deepEqual(parseProject(serializeProject(city, {})).city.streets, city.streets);
});
