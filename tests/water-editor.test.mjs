import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacy} from '../src/generation/generator.js';
import {
    commitBuilding,
    createBuilding,
    createEditorHistory,
    enterEditor,
    validatePlacement
} from '../src/editor/building-editor.js';
import {
    applyWaterChange,
    editedWaterPoints,
    insertWaterPoint,
    planWaterChange,
    translateWaterBody,
    validateEditorWater,
    withWaterPoints
} from '../src/editor/water-editor.js';
import {footprintDryInWater, smoothWaterPoints, waterBodyGeometry} from '../src/water/water-geometry.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {renderMap} from '../src/rendering/render.js';
import {rectangle} from '../src/core/geometry.js';

const river = () => ({id: 'water-1', kind: 'river', points: [[0, -200], [0, 0], [0, 200]], width: 20, smooth: false});

function town() {
    const city = enterEditor(generateCity({
        seed: '42',
        size: 8,
        river: false,
        coast: false,
        citadel: false,
        plaza: false,
        temple: false
    }));
    city.buildings = [];
    city.trees = [];
    city.districts = [{id: 'main', name: 'Смешанный район', wealth: 'mixed', polygon: rectangle([0, 0], 1000, 1000)}];
    city.editor.water = {
        version: 1,
        nextId: 1,
        bodies: [],
        dirty: false,
        source: {
            roads: [{id: 'road-1', points: [[-200, 0], [200, 0]], width: 8, major: true}],
            footbridges: [],
            docks: []
        }
    };
    return city;
}

test('water entry preserves the existing geometry until a deliberate edit', () => {
    const original = generateCity(), before = structuredClone(original.terrain), city = enterEditor(original);
    assert.deepEqual(city.terrain, before);
    assert.equal(city.editor.water.dirty, false);
    assert.ok(city.editor.water.bodies.some(b => b.kind === 'river'));
    assert.ok(city.editor.water.bodies.some(b => b.kind === 'sea'));
    validateEditorWater(city.editor.water);
});

test('river edits rebuild bridges at the banks and clear only flooded buildings', () => {
    const city = town(), dry = commitBuilding(city, createBuilding(city, 'house', [-100, 50]));
    const flooded = commitBuilding(city, {...createBuilding(city, 'house', [0, 50]), custom: false});
    const plan = planWaterChange(city, [river()]);
    assert.ok(plan.ok, plan.message);
    assert.equal(plan.removed, 1);
    applyWaterChange(city, plan);
    assert.equal(city.buildings[0].id, dry.id);
    assert.ok(!city.buildings.some(b => b.id === flooded.id));
    assert.equal(city.bridges.length, 1);
    assert.equal(city.terrain.kind, 'river');
    assert.equal(city.statistics.bridges, 1);
    assert.equal(validatePlacement(city, createBuilding(city, 'house', [0, 80])).ok, false);
    assert.equal(validatePlacement(city, createBuilding(city, 'house', [-100, 80])).ok, true);
});

test('river start, end, bends and width remain independent editable geometry', () => {
    const body = river();
    const moved = withWaterPoints(body, [[-80, -240], [60, 0], [120, 260]]);
    const smooth = {...moved, smooth: true, width: 32}, shape = waterBodyGeometry(smooth);
    assert.deepEqual(shape.points[0], [-80, -240]);
    assert.deepEqual(shape.points.at(-1), [120, 260]);
    assert.ok(shape.points.length > moved.points.length);
    assert.ok(shape.polygon.some(p => p[0] > 120));
    assert.deepEqual(editedWaterPoints(smooth), moved.points);
    assert.deepEqual(smoothWaterPoints([[0, 0], [100, 0]]), [[0, 0], [100, 0]]);
});

test('manually edited banks determine both dry land and bridge ends, instead of the nominal width', () => {
    const city = town(), body = {...river(), outline: rectangle([15, 0], 70, 400)};
    const plan = planWaterChange(city, [body]);
    assert.ok(plan.ok, plan.message);
    applyWaterChange(city, plan);
    assert.equal(validatePlacement(city, createBuilding(city, 'house', [35, 80])).ok, false);
    const xs = city.bridges[0].polygon.map(p => p[0]);
    assert.ok(Math.abs(Math.min(...xs) + 20) < 1e-5);
    assert.ok(Math.abs(Math.max(...xs) - 50) < 1e-5);
});

test('points can be inserted in bends, before the river start and beyond its end', () => {
    const points = [[0, 0], [100, 0]];
    assert.deepEqual(insertWaterPoint(points, [-50, 20], false).points[0], [-50, 20]);
    assert.deepEqual(insertWaterPoint(points, [150, 30], false).points.at(-1), [150, 30]);
    assert.deepEqual(insertWaterPoint(points, [50, 40], false).points, [[0, 0], [50, 40], [100, 0]]);
    const sea = rectangle([0, 0], 100, 100);
    assert.equal(insertWaterPoint(sea, [-60, 0], true).points.length, 5);
});

test('whole water bodies move with their custom banks and islands', () => {
    const sea = {
        id: 'water-1',
        kind: 'sea',
        points: rectangle([0, 0], 300, 300),
        outline: rectangle([0, 0], 300, 300),
        holes: [rectangle([0, 0], 50, 50)],
        smooth: false
    };
    const moved = translateWaterBody(sea, [70, -30]);
    assert.deepEqual(moved.points[0], [sea.points[0][0] + 70, sea.points[0][1] - 30]);
    assert.deepEqual(moved.outline[0], moved.points[0]);
    assert.deepEqual(moved.holes[0][0], [45, -55]);
    assert.ok(footprintDryInWater(rectangle([70, -30], 10, 10), [waterBodyGeometry(moved)]));
});

test('editing sea islands keeps their buildings and roads dry while clipping submerged roads', () => {
    const city = town();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    city.editor.water.source.roads = [{id: 'island-road', points: [[-200, 0], [200, 0]], width: 6, major: true}];
    const sea = {
        id: 'water-1',
        kind: 'sea',
        points: rectangle([0, 0], 300, 300),
        holes: [rectangle([0, 0], 80, 80)],
        smooth: false
    };
    const plan = planWaterChange(city, [sea]);
    assert.ok(plan.ok, plan.message);
    applyWaterChange(city, plan);
    assert.equal(city.buildings.length, 1);
    assert.equal(city.streets.length, 3);
    assert.ok(city.streets.some(r => r.a[0] === -40 && r.b[0] === 40));
});

test('invalid or self-crossing water does not mutate the city or delete buildings', () => {
    const city = town();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    const before = serializeProject(city, {});
    for (const body of [{...river(), width: NaN}, {
        ...river(),
        points: [[0, 0], [100, 100], [0, 100], [100, 0]]
    }, {id: 'water-1', kind: 'sea', points: [[0, 0], [1, 1]], smooth: false}]) {
        const plan = planWaterChange(city, [body]);
        assert.equal(plan.ok, false);
        assert.equal(serializeProject(city, {}), before);
    }
});

test('one undo restores water, flooded buildings, trees, streets and bridges together; redo restores the edit', () => {
    const city = town(), history = createEditorHistory();
    commitBuilding(city, {...createBuilding(city, 'house', [0, 50]), custom: false});
    city.trees = [{point: [0, 100], radius: 3, shade: 0}];
    const before = serializeProject(city, {}), plan = planWaterChange(city, [river()]);
    assert.ok(plan.ok, plan.message);
    history.record(city);
    applyWaterChange(city, plan);
    const after = serializeProject(city, {});
    assert.equal(city.trees.length, 0);
    history.undo(city);
    assert.equal(serializeProject(city, {}), before);
    history.redo(city);
    assert.equal(serializeProject(city, {}), after);
});

test('multiple seas and rivers can be added and removed without changing a seed recipe', () => {
    const city = town(), bodies = [river(), {
        id: 'water-2',
        kind: 'sea',
        points: rectangle([300, 300], 100, 100),
        smooth: false,
        holes: []
    }];
    let plan = planWaterChange(city, bodies);
    assert.ok(plan.ok, plan.message);
    applyWaterChange(city, plan);
    assert.equal(city.terrain.kind, 'estuary');
    assert.equal(city.editor.water.nextId, 3);
    plan = planWaterChange(city, []);
    assert.ok(plan.ok, plan.message);
    applyWaterChange(city, plan);
    assert.equal(city.terrain.kind, 'inland');
    assert.equal(city.bridges.length, 0);
    assert.equal(city.terrain.ribbons.length, 0);
});

test('expanding the sea removes submerged river bridges and undo restores their approaches', () => {
    const city = town(), history = createEditorHistory();
    const first = planWaterChange(city, [river()]);
    assert.ok(first.ok, first.message);
    applyWaterChange(city, first);
    assert.equal(city.bridges.length, 1);
    const before = serializeProject(city, {});
    const sea = {id: 'water-2', kind: 'sea', points: rectangle([0, 0], 300, 300), smooth: false};
    const plan = planWaterChange(city, [river(), sea]);
    assert.ok(plan.ok, plan.message);
    history.record(city);
    applyWaterChange(city, plan);
    assert.equal(city.bridges.length, 0);
    assert.equal(city.approaches.length, 0);
    assert.ok(city.streets.every(r => r.points.every(([x]) => Math.abs(x) >= 150 - 1e-5)));
    history.undo(city);
    assert.equal(serializeProject(city, {}), before);
    history.redo(city);
    assert.equal(city.bridges.length, 0);
});

const imported = importMfcgGeoJson(JSON.parse(await readFile(new URL('fixtures/mfcg/berford.json', import.meta.url))));
for (const original of [generateCity(), imported, generateLegacy({
    seed: 'water-editor',
    size: 'village',
    geography: 'estuary'
})]) {
    test(`${original.source?.format || 'legacy'}: water edits survive JSON, render and preserve topmost annotations in both themes`, () => {
        const city = enterEditor(original), bodies = structuredClone(city.editor.water.bodies);
        const body = bodies.find(b => b.kind === 'river') || bodies[0];
        const moved = translateWaterBody(body, [10, 5]);
        const plan = planWaterChange(city, bodies.map(b => b.id === body.id ? moved : b));
        assert.ok(plan.ok, plan.message);
        applyWaterChange(city, plan);
        const restored = parseProject(serializeProject(city, {theme: 'ink'})).city;
        assert.deepEqual(restored.editor.water, city.editor.water);
        assert.deepEqual(restored.terrain, city.terrain);
        for (const theme of ['atlas', 'ink']) {
            const svg = renderMap(restored, {theme}, {
                interactive: true,
                waterOverlay: '<g id="editor-water-controls"/>'
            });
            assert.ok(!/NaN|undefined|Infinity/.test(svg));
            assert.ok(svg.includes(`data-water-shape="${body.id}"`));
            assert.ok(svg.indexOf('id="editor-water-controls"') < svg.indexOf('id="map-annotations"'));
        }
        const serialized = JSON.parse(serializeProject(restored, {}));
        serialized.city.editor.water.bodies[0].points[0][0] = 'bad';
        assert.throws(() => parseProject(JSON.stringify(serialized)));
    });
}
