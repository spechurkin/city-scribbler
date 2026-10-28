import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity as generateModel} from '../src/compatible/city.js';
import {structureGeometry} from '../src/compatible/structure.js';
import {localStreets} from '../src/compatible/local-streets.js';
import {metricPoint} from '../src/compatible/terrain.js';
import {cityFromGeometry} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {renderMap} from '../src/rendering/render.js';
import {distance} from '../src/core/geometry.js';
import {buildBridgeNetwork, dryPieces} from '../src/roads/bridge-network.js';

for (const recipe of [
    {seed: '1931200012', size: 34, coast: true, river: true, walls: true},
    {seed: '314159', size: 37, coast: false, river: false, walls: false},
    {seed: '42', size: 60, coast: false, river: true, walls: true}
]) test(`group boundary streets connect districts without crossing barriers: ${JSON.stringify(recipe)}`, () => {
    const terrain = generateModel(recipe), before = terrain.sequence.checkpoint(), streets = localStreets(terrain);
    const keys = new Set(),
        key = (a, b) => [terrain.mesh.vertexOrder.get(a), terrain.mesh.vertexOrder.get(b)].sort((a, b) => a - b).join('-');
    assert.ok(streets.length > 0);
    for (const [a, b] of streets) {
        const edge = terrain.mesh.edgeBetween(a, b);
        assert.equal(edge.kind, null);
        assert.ok(edge.cell.urban && edge.twin.cell.urban);
        assert.notEqual(edge.cell.group, edge.twin.cell.group);
        assert.equal(keys.has(key(a, b)), false, 'a shared edge must be drawn only once');
        keys.add(key(a, b));
    }
    let betweenDistricts = 0, mainJunctions = 0;
    const mainPoints = new Set(terrain.arteries.flatMap(chain => chain.flatMap(e => [e.point, e.next.point])));
    for (const district of terrain.districts) for (const group of district.groups) for (const edge of group.border) {
        if (edge.kind || !edge.twin?.cell.urban || edge.twin.cell.group === group) continue;
        assert.ok(keys.has(key(edge.point, edge.next.point)), 'a passable group boundary is missing');
        if (edge.cell.district !== edge.twin.cell.district) betweenDistricts++;
        if (mainPoints.has(edge.point) || mainPoints.has(edge.next.point)) mainJunctions++;
    }
    assert.ok(betweenDistricts > 0);
    assert.ok(mainJunctions > 0);
    assert.deepEqual(terrain.sequence.checkpoint(), before);
    const geometry = structureGeometry(terrain);
    assert.deepEqual(geometry.experimental.localStreets, streets.map(p => p.map(metricPoint)));
    const city = cityFromGeometry(geometry, recipe), water = [...city.terrain.ribbons, ...city.terrain.sea];
    const displayed = city.streets.filter(r => r.id.startsWith('local-'));
    assert.ok(displayed.length > 0);
    for (const road of displayed) for (let i = 1; i < road.points.length; i++) {
        const segment = [road.points[i - 1], road.points[i]],
            dry = dryPieces(segment, water).reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0);
        assert.ok(Math.abs(dry - distance(...segment)) < 1e-5);
    }
});

test('local streets survive project export and share the streets layer', () => {
    const recipe = {seed: '314159', size: 27, coast: false, river: false, walls: true};
    const geometry = structureGeometry(generateModel(recipe)),
        city = cityFromGeometry(geometry, recipe, {name: 'Проверка дорог'});
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.streets, city.streets);
    assert.ok(renderMap(restored).includes('stroke-linecap="round"'));
    assert.match(renderMap(restored, {layers: {streets: false}}), /data-layer="streets" style="display:none"/);
    delete geometry.experimental.localStreets;
    assert.doesNotThrow(() => cityFromGeometry(geometry, recipe));
});

test('a local street ending at a river junction does not invent a bridge or rotate an existing one', () => {
    const river = {points: [[0, -50], [0, 0], [0, 50]], width: 10};
    const local = {id: 'local-0', points: [[-30, -20], [0, 0]], width: 4.8, major: false, landOnly: true};
    const network = buildBridgeNetwork({rivers: [river], roads: [local]});
    assert.equal(network.bridges.length, 0);
    assert.ok(network.streets[0].points.at(-1)[0] < 0);
    const main = {id: 'main', points: [[-30, 0], [30, 0]], width: 8, major: true};
    const baseline = buildBridgeNetwork({rivers: [river], roads: [main]});
    const connected = buildBridgeNetwork({rivers: [river], roads: [main, local]});
    assert.deepEqual(connected.bridges, baseline.bridges);
});
