import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedAlleys} from '../src/compatible/local-streets.js';
import {connectedStreets} from '../src/roads/street-network.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {distance, pathDistance, segmentSegmentDistance} from '../src/core/geometry.js';
import {dryPieces} from '../src/roads/bridge-network.js';

const road = (id, points, major = false) => ({id, points, major, width: major ? 8 : 4.8});
const castleWall = (city, wall) => city.generatedGeometry.cells.some(c => c.ward === 'castle' && c.polygon.length === wall.polygon.length && c.polygon.every(p => wall.polygon.some(q => distance([p[0], -p[1]], q) < 1e-6)));

test('alley ends reach the group boundary and the parent alley across parcel setbacks', () => {
    const corners = [[0, 0], [20, 0], [20, 20], [0, 20]],
        border = corners.map((point, i) => ({point, next: {point: corners[(i + 1) % corners.length]}})),
        alleys = [[[1, 10], [19, 10]], [[10, 1], [10, 9.4]]],
        terrain = {districts: [{groups: [{border, alleys}]}]}, before = structuredClone(alleys);
    assert.deepEqual(connectedAlleys(terrain), [[[0, 10], [20, 10]], [[10, 0], [10, 10]]]);
    assert.deepEqual(alleys, before, 'the seed-compatible parcel geometry remains intact');
});

test('an alley extension stops at the wall circuit before the distant block boundary', () => {
    const corners = [[0, 0], [20, 0], [20, 20], [0, 20]],
        border = corners.map((point, i) => ({point, next: {point: corners[(i + 1) % corners.length]}})),
        terrain = {districts: [{groups: [{border, alleys: [[[5, 10], [10, 10]]]}]}]};
    assert.deepEqual(connectedAlleys(terrain, [[[15, 0], [15, 20]]]), [[[0, 10], [15, 10]]]);
});

test('the castle-side alley in Timofeevsk joins the wall circuit without a thin triangular shortcut', () => {
    const city = generateCity(), alley = city.streets.find(r => r.id === 'alley-24');
    assert.ok(alley);
    const end = alley.points.at(-1), circuit = city.streets.filter(r => r.id.startsWith('outer-wall-'));
    assert.ok(circuit.some(r => pathDistance(end, r.points) < 1e-5));
    assert.ok(!city.streets.filter(r => r.major).some(r => pathDistance(end, r.points) < 1e-5));
});

test('pruning retains through routes, splits T junctions, and removes dangling branches and isolated cycles', () => {
    const streets = [road('left', [[0, 0], [0, 20]], true), road('right', [[20, 0], [20, 20]], true),
        road('through', [[0, 10], [20, 10]]), road('stub', [[10, 10], [10, 15]]),
        road('island', [[30, 0], [40, 0], [40, 10], [30, 10], [30, 0]])];
    const before = structuredClone(streets), result = connectedStreets(streets);
    assert.deepEqual(result.map(r => r.id), ['left', 'right', 'through']);
    assert.deepEqual(result[2].points, [[0, 10], [10, 10], [20, 10]]);
    assert.deepEqual(streets, before);
});

test('overlapping copies cannot keep a dangling street alive', () => {
    const result = connectedStreets([road('main', [[0, 0], [0, 20]], true),
        road('branch', [[0, 10], [20, 10]]), road('duplicate', [[20, 10], [10, 10]])]);
    assert.deepEqual(result.map(r => r.id), ['main']);
});

test('routes to a square or quay are valid destinations, including collinear junctions', () => {
    const main = road('main', [[0, 0], [0, 20]], true),
        result = connectedStreets([main, road('alley', [[0, 10], [20, 10]]), road('extension', [[20, 10], [30, 10]])],
            [[[15, 10], [20, 10]]]);
    assert.equal(result.some(r => r.id === 'extension'), false);
    assert.equal(result.filter(r => !r.major).reduce((sum, r) => sum + r.points.slice(1).reduce((sum, p, i) => sum + distance(r.points[i], p), 0), 0), 20);
});

test('a wall receives connected alleys without becoming a route between isolated roads', () => {
    const wall = [[20, 0], [20, 40]], main = road('main', [[0, 0], [0, 20]], true),
        streets = [main, road('wall-alley', [[0, 10], [20, 10]]),
            road('branch', [[10, 10], [10, 15]]),
            road('isolated', [[20, 30], [30, 30], [30, 40], [20, 40]])];
    const result = connectedStreets(streets, [], [wall]);
    assert.deepEqual(result.map(r => r.id), ['main', 'wall-alley']);
    assert.deepEqual(result[1].points, [[0, 10], [10, 10], [20, 10]]);
    assert.deepEqual(connectedStreets(streets).map(r => r.id), ['main']);
});

test('only a gate anchors a castle approach; branches aimed at a solid wall are pruned to their junction', () => {
    const streets = [road('main', [[0, -30], [0, 30]], true), road('gate', [[0, 0], [30, 0]]),
        road('wall', [[0, 15], [10, 15], [20, 15]]), road('wall-branch', [[10, 15], [10, 25]])];
    const result = connectedStreets(streets, [], [[[20, 0]]]);
    assert.deepEqual(result.map(r => r.id), ['main', 'gate']);
    assert.deepEqual(result[1].points.at(-1), [20, 0]);
});

test('a square touching a castle wall cannot keep a branch to the solid wall alive', () => {
    const streets = [road('main', [[0, -30], [0, 30]], true), road('gate', [[0, 0], [20, 0]]), road('stub', [[0, 15], [20, 15]])];
    const result = connectedStreets(streets, [[[20, 10], [20, 25]]], [[[20, 0]]], {allowTerminal: p => p[0] !== 20 || p[1] === 0});
    assert.deepEqual(result.map(r => r.id), ['main', 'gate']);
});

test('wall-side parcel alleys remain visible along their entire dry length', () => {
    const city = generateCity(), geometry = city.generatedGeometry, e = geometry.experimental,
        displayed = new Map(city.streets.map(r => [r.id, r])),
        castleWalls = city.walls.filter(w => castleWall(city, w)),
        terminals = city.walls.filter(w => !castleWall(city, w)).flatMap(w => w.polygon.flatMap((p, i) => w.segments[i] ? [[p, w.polygon[(i + 1) % w.polygon.length]]] : []));
    let count = 0;
    e.connectedAlleys.forEach((alley, i) => {
        const points = alley.map(([x, y]) => [x, -y]);
        if ([points[0], points.at(-1)].some(p => castleWalls.some(w => pathDistance(p, [...w.polygon, w.polygon[0]]) < 1e-5 && !w.gates.some(g => distance(p, g) < 1e-5)))) return;
        if (![points[0], points.at(-1)].some(p => terminals.some(w => pathDistance(p, w) < 1e-5))) return;
        if (!dryPieces(points, [...city.terrain.ribbons, ...city.terrain.sea]).some(p => p.length === points.length && p.every((v, j) => distance(v, points[j]) < 1e-5))) return;
        const visible = displayed.get(`alley-${i}`);
        assert.ok(visible, `missing wall alley ${i}`);
        for (const p of points) assert.ok(pathDistance(p, visible.points) < 1e-5, `truncated wall alley ${i}`);
        count++;
    });
    assert.ok(count > 0, 'the regression must cover alleys ending at walls');
});

function assertConnected(city) {
    const streets = city.streets, destinations = [
            ...streets.filter(r => r.major).map(r => r.points),
            ...city.quays.map(q => q.points), ...city.approaches.map(a => a.points),
            ...city.bridges.map(b => [b.a, b.b]), ...city.squares.map(p => [...p, p[0]])
        ],
        terminals = city.walls.flatMap(w => w.polygon.flatMap((p, i) => w.segments[i] ? [[p, w.polygon[(i + 1) % w.polygon.length]]] : [])),
        minor = streets.filter(r => !r.major), water = [...city.terrain.ribbons, ...city.terrain.sea];
    const touches = (a, b) => a.slice(1).some((p, i) => b.slice(1).some((q, j) => segmentSegmentDistance(a[i], p, b[j], q) < 1e-5));
    const reached = new Set(minor.filter(r => destinations.some(p => touches(r.points, p)))), queue = [...reached];
    for (let i = 0; i < queue.length; i++) for (const r of minor) if (!reached.has(r) && touches(queue[i].points, r.points)) {
        reached.add(r);
        queue.push(r);
    }
    assert.equal(reached.size, minor.length, 'every minor road reaches a main road, bridge, quay or square');
    for (const wall of city.walls.filter(w => castleWall(city, w))) for (const road of streets) {
        for (const p of [road.points[0], road.points.at(-1)]) if (pathDistance(p, [...wall.polygon, wall.polygon[0]]) < 1e-5) {
            assert.ok(wall.gates.some(g => distance(p, g) < 1e-5) || distance(road.points[0], road.points.at(-1)) < 1e-5 || streets.some(other => other !== road && pathDistance(p, other.points) < 1e-5), `${road.id} ends at a solid castle wall`);
        }
    }
    for (const r of minor) {
        for (const point of [r.points[0], r.points.at(-1)]) assert.ok(
            distance(r.points[0], r.points.at(-1)) < 1e-5 || [...destinations, ...terminals].some(p => pathDistance(point, p) < 1e-5) || minor.some(other => other !== r && pathDistance(point, other.points) < 1e-5),
            `dangling ${r.id} at ${point}`);
        const length = dryPieces(r.points, water).reduce((sum, points) => sum + points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0), 0);
        const expected = r.points.slice(1).reduce((sum, p, i) => sum + distance(r.points[i], p), 0);
        assert.ok(Math.abs(length - expected) < 1e-5, 'a connected street must stay on land');
    }
    assert.ok(minor.length > 0, 'connectivity must not be achieved by discarding all minor roads');
}

for (const options of [
    {seed: '1931200012'},
    {seed: '314159', size: 37, coast: false, river: false, walls: false},
    {seed: '42', size: 60, coast: false, river: true, walls: true},
    {seed: '884137421', size: 34, coast: true, river: true, riverWidthScale: 2},
    {seed: '1437657', size: 16, coast: false, river: true, walls: false},
    {seed: '76510239214', size: 92, coast: true, river: false, walls: true}
]) test(`displayed minor streets have no floating components or dangling ends: ${JSON.stringify(options)}`, () => assertConnected(generateCity(options)));
