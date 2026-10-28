import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBridgeNetwork, dryPieces} from '../src/roads/bridge-network.js';
import {area, inside} from '../src/core/geometry.js';
import {polygonBoolean} from '../src/compatible/polygons.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {renderMap} from '../src/rendering/render.js';

const rotate = (p, angle) => [p[0] * Math.cos(angle) - p[1] * Math.sin(angle), p[0] * Math.sin(angle) + p[1] * Math.cos(angle)];
const bay = [[-1000, 1500], [-1000, 250], [0, 0], [500, 1000], [1000, 1500]];

for (const angle of [0, Math.PI / 3, 1.51 * Math.PI]) for (const width of [5, 20, 60]) test(`river mouth joins a sharp coast across its whole width: angle=${angle}, width=${width}`, () => {
    const points = [[0, 0], [0, -100], [20, -200]].map(p => rotate(p, angle)), sea = bay.map(p => rotate(p, angle)),
        original = structuredClone(points);
    const network = buildBridgeNetwork({roads: [], rivers: [{points, width}], sea: [sea]});
    assert.equal(network.mouths.length, 1);
    const mouth = network.mouths[0];
    assert.ok(mouth.extension > 0);
    for (const p of mouth.cap) assert.ok(inside(p, sea));
    assert.equal(dryPieces(mouth.cap, [sea]).length, 0);
    const overlap = polygonBoolean(network.ribbons[0], sea, 'intersection').reduce((sum, p) => sum + area(p), 0);
    assert.ok(overlap > width * .001);
    assert.deepEqual(points, original);
});

test('a river away from a sea boundary is not stretched toward that sea', () => {
    const network = buildBridgeNetwork({roads: [], rivers: [{points: [[0, -100], [0, -200]], width: 20}], sea: [bay]});
    assert.equal(network.mouths.length, 0);
});

test('reported seed 566198536 has a finite-width sea connection and no outline across the mouth', () => {
    const city = generateCity({
        seed: '566198536',
        size: 61,
        citadel: true,
        urban_castle: true,
        plaza: true,
        temple: true,
        walls: true,
        river: true,
        coast: true,
        greens: false,
        hub: true,
        sea: 1.51
    });
    assert.equal(city.terrain.mouths.length, 1);
    for (const mouth of city.terrain.mouths) assert.equal(dryPieces(mouth.cap, city.terrain.sea).length, 0);
    const svg = renderMap(city);
    assert.ok(svg.includes('mask="url(#river-mouth-gaps)"'));
    assert.ok(svg.includes('mask="url(#sea-overlap)"'));
    assert.deepEqual(city.terrain.rivers[0].points, city.generatedGeometry.rivers[0].map(([x, y]) => [x, -y]));
});
