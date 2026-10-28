import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity as generateModel} from '../src/compatible/city.js';
import {structureGeometry} from '../src/compatible/structure.js';
import {cityFromGeometry, normalizeOptions} from '../src/generation/interactive-city.js';
import {dryPieces} from '../src/roads/bridge-network.js';
import {area, distance, segmentDistance} from '../src/core/geometry.js';
import {polygonBoolean} from '../src/compatible/polygons.js';
import {renderMap} from '../src/rendering/render.js';
import {updateRiverState} from '../src/compatible/river.js';

// Exercise the displayed bridge network without placing unrelated custom buildings.
function bridgeCity(recipe) {
    const {options} = normalizeOptions(recipe);
    const model = generateModel(options);
    const city = cityFromGeometry(structureGeometry(model), options);
    return {model, city};
}

for (const [size, coast, minimum] of [[100, false, 12], [100, true, 12], [200, true, 21]]) {
    test(`size ${size}, coast ${coast}: enough distinct bridges with dry bank connections`, () => {
        const {model, city} = bridgeCity({seed: '1931200012', size, coast});
        assert.ok(city.bridges.length >= minimum, `only ${city.bridges.length} bridges`);
        const water = [...city.terrain.ribbons, ...city.terrain.sea];
        assert.equal(city.approaches.length, city.bridges.length * 2);
        for (const river of model.rivers) for (const p of river.bridges.keys()) {
            if (!river.bridges.get(p)) assert.ok(!river.watergates.includes(p));
        }
        for (const bridge of city.bridges) {
            const bank = city.terrain.ribbons[bridge.river];
            for (const end of bridge.rails.flat()) assert.ok(Math.min(...bank.map((p, i) => segmentDistance(end, p, bank[(i + 1) % bank.length]))) < 1e-5);
        }
        for (let i = 0; i < city.bridges.length; i++) for (let j = i + 1; j < city.bridges.length; j++) {
            assert.ok(polygonBoolean(city.bridges[i].polygon, city.bridges[j].polygon, 'intersection').reduce((sum, p) => sum + area(p), 0) < 1e-5);
        }
        for (const route of [...city.streets, ...city.approaches]) for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1], b = route.points[i];
            const dry = dryPieces([a, b], water).reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0);
            assert.ok(Math.abs(distance(a, b) - dry) < 1e-5);
        }
        assert.equal((renderMap(city).match(/data-bridge="true"/g) || []).length, city.bridges.length);
        const restored = cityFromGeometry(structuredClone(city.generatedGeometry), city.options);
        assert.deepEqual(restored.bridges, city.bridges);
    });
}

test('large-city bridge placement is repeatable for the same seed', () => {
    const recipe = {seed: '42', size: 100, coast: true};
    assert.deepEqual(bridgeCity(recipe).city.bridges, bridgeCity(recipe).city.bridges);
});

for (const size of [34, 70, 100, 150, 200]) test(`size ${size}: one bridge per 8.5 size when sites are available`, () => {
    const cell = {}, points = Array.from({length: 40}, (_, i) => [0, i * 100]);
    const course = points.map((point, i) => ({
        point,
        next: {point: points[Math.min(i + 1, points.length - 1)]},
        cell,
        twin: {cell}
    }));
    const river = {points, course};
    updateRiverState({
        rivers: [river], urban: Array(size).fill(cell), arteries: [],
        options: {walls: false, riverWidthScale: 1},
        mesh: {incident: new Map(points.map(p => [p, [1, 2, 3]]))},
        sequence: {next: () => .99}
    });
    assert.equal(river.bridges.size, Math.round(size / 8.5));
    assert.equal(river.footbridges.length, river.bridges.size);
});
