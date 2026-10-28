import test from 'node:test';
import assert from 'node:assert/strict';
import {area, rectangle, segmentSegmentDistance} from '../src/core/geometry.js';
import {rerouteBuildingStreets} from '../src/buildings/building-streets.js';
import {hitsRoad} from '../src/buildings/building-spatial.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {
    applyBuildingPlan,
    createBuilding,
    createEditorHistory,
    enterEditor,
    planBuildingPlacement,
    planBuildingReplacement,
    removeEditorBuilding,
    restoreEditorAppearance,
    transformBuilding
} from '../src/editor/building-editor.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {applyWaterChange, planWaterChange} from '../src/editor/water-editor.js';

const road = (id, points, width = 6) => ({id, points, width, major: true});
const building = (id, polygon, extra = {}) => ({id, kind: 'house', polygon, parts: {}, custom: true, ...extra});
const block = building('house', rectangle([0, 0], 30, 24));

test('a crossing street regenerates around the footprint with its width and endpoints preserved', () => {
    const source = [road('main', [[-70, 0], [70, 0]]), road('remote', [[-70, 100], [70, 100]])],
        before = structuredClone(source);
    const result = rerouteBuildingStreets(source, [block]);
    assert.deepEqual(source, before);
    assert.deepEqual(result[0].points[0], [-70, 0]);
    assert.deepEqual(result[0].points.at(-1), [70, 0]);
    assert.ok(result[0].points.length > 2);
    assert.equal(result[0].width, 6);
    assert.equal(result[0].major, true);
    assert.ok(!hitsRoad(block, result[0]));
    assert.deepEqual(result[1], source[1]);
    assert.deepEqual(rerouteBuildingStreets(result, []), source);
});

test('a narrow street keeps its own clearance when a wider road exists elsewhere', () => {
    const source = [road('local', [[-100, 0], [100, 0]], 4), road('main', [[-100, 100], [100, 100]], 14)];
    const house = building('house', rectangle([0, 7.5], 12, 9));
    assert.deepEqual(rerouteBuildingStreets(source, [house]), source);
});

test('mixed-width junctions stay connected and clear of a building after rerouting', () => {
    const source = [road('through', [[-70, 0], [70, 0]], 4), road('north', [[0, 0], [0, 70]], 14), road('south', [[0, -70], [0, 0]], 6)];
    const result = rerouteBuildingStreets(source, [block]), junction = result[1].points[0];
    assert.deepEqual(result[2].points.at(-1), junction);
    assert.ok(result[0].points.some(p => Math.hypot(p[0] - junction[0], p[1] - junction[1]) < 1e-6));
    for (const r of result) for (let i = 1; i < r.points.length; i++) {
        const clearance = Math.min(...block.polygon.map((p, j) => segmentSegmentDistance(p, block.polygon[(j + 1) % block.polygon.length], r.points[i - 1], r.points[i])));
        assert.ok(clearance >= r.width / 2 + 1 - 1e-6, `${r.id}: ${clearance}`);
    }
    assert.deepEqual(rerouteBuildingStreets(result, []), source);
});

test('an unsplit narrow street follows its junction when only the wider branch needs clearance', () => {
    const source = [road('through', [[-70, 0], [70, 0]], 4), road('north', [[0, 0], [0, 70]], 14)];
    const house = building('house', rectangle([0, 8], 12, 9));
    for (const roads of [source, source.slice().reverse()]) {
        const result = rerouteBuildingStreets(roads, [house]);
        const junction = result.find(r => r.id === 'north').points[0];
        assert.notDeepEqual(junction, [0, 0]);
        assert.ok(result.find(r => r.id === 'through').points.some(p => Math.hypot(p[0] - junction[0], p[1] - junction[1]) < 1e-6));
        assert.ok(result.every(r => !hitsRoad(house, r)));
        assert.deepEqual(rerouteBuildingStreets(result, []), roads);
    }
});

test('a junction swallowed by a building moves once for every incident street, including an unsplit through road', () => {
    const source = [road('through', [[-70, 0], [70, 0]]), road('north', [[0, 0], [0, 70]]), road('south', [[0, -70], [0, 0]])];
    const result = rerouteBuildingStreets(source, [block]);
    const junction = result[1].points[0];
    assert.notDeepEqual(junction, [0, 0]);
    assert.deepEqual(result[2].points.at(-1), junction);
    assert.ok(result[0].points.some(p => Math.hypot(p[0] - junction[0], p[1] - junction[1]) < 1e-6));
    assert.ok(result.every(r => !hitsRoad(block, r)));
    assert.deepEqual(rerouteBuildingStreets(result, []), source);
});

test('routing respects a concave courtyard and does not fill its open corner with an invented convex obstacle', () => {
    const outline = [[-40, -40], [40, -40], [40, -20], [-20, -20], [-20, 40], [-40, 40]];
    const temple = building('temple', rectangle([-30, -30], 10, 10), {
        kind: 'temple',
        nativeLandmark: true,
        parts: {court: outline}
    });
    const source = [road('corner', [[-10, 0], [40, 0]], 4)];
    assert.deepEqual(rerouteBuildingStreets(source, [temple]), source);
});

test('an approach follows a moved palace gate while leaving room for the corner towers', () => {
    const palace = building('castle', rectangle([30, 0], 10, 10), {
        kind: 'castle',
        nativeLandmark: true,
        fortification: {
            polygon: rectangle([30, 0], 40, 40),
            gates: [[10, 0]],
            gateOrigins: [[-20, 0]],
            towers: [],
            segments: [true, true, true, true]
        }
    });
    const source = [road('approach', [[-70, 0], [-20, 0]])], result = rerouteBuildingStreets(source, [palace]);
    const end = result[0].points.at(-1);
    assert.ok(end[0] > 0 && end[0] < 10);
    assert.ok(Math.abs(end[1]) < 1e-6);
    assert.ok(!hitsRoad(palace, result[0]));
    assert.deepEqual(rerouteBuildingStreets(result, []), source);
});

test('outlying workshop parts block roads even when the main L-shaped outline leaves that space open', () => {
    const smithy = createBuilding({editor: {nextId: 1}}, 'smithy', [0, 0]);
    const source = [road('annexe', [[0, 0], [50, 0]], 2)], result = rerouteBuildingStreets(source, [smithy]);
    assert.ok(hitsRoad(smithy, source[0]));
    assert.ok(!hitsRoad(smithy, result[0]));
    assert.notDeepEqual(result[0].points, source[0].points);
});

test('a detour avoids the wet side of a building and fails atomically when no dry route remains', () => {
    const source = [road('main', [[-70, 0], [70, 0]])];
    const water = [{kind: 'sea', polygon: rectangle([0, 30], 70, 30), holes: []}];
    const result = rerouteBuildingStreets(source, [block], water);
    assert.ok(result[0].points.some(p => p[1] < -12));
    assert.ok(!result[0].points.some(p => p[1] > 20));
    const before = structuredClone(source);
    assert.throws(() => rerouteBuildingStreets(source, [block], [{
        kind: 'sea',
        polygon: rectangle([0, 0], 140, 120),
        holes: []
    }]), /дорог|Дорож/);
    assert.deepEqual(source, before);
});

function town() {
    const city = enterEditor(generateCity({
        seed: '42',
        size: 8,
        river: false,
        coast: false,
        citadel: false,
        temple: false,
        plaza: false
    }));
    for (const key of ['buildings', 'trees', 'gardens', 'walls', 'gates', 'fields', 'markets', 'squares', 'monuments']) city[key] = [];
    city.plaza = null;
    city.districts = [{id: 'd', name: 'Район', wealth: 'mixed', polygon: rectangle([0, 0], 400, 300)}];
    city.editor.quarters = [];
    city.streets = [road('main', [[-150, 0], [150, 0]])];
    city.editor.water = {
        version: 1,
        nextId: 1,
        dirty: false,
        bodies: [],
        source: {roads: structuredClone(city.streets), footbridges: [], docks: []}
    };
    return city;
}

test('snapped add and move previews preserve streets of different widths on commit and repeated moves', () => {
    for (const angle of [0, Math.PI / 2, Math.PI / 7]) for (const side of [-1, 1]) {
        const city = town(), tangent = [Math.cos(angle), Math.sin(angle)], normal = [-tangent[1], tangent[0]];
        const point = (along, across) => tangent.map((v, i) => v * along + normal[i] * across);
        city.streets = [road('local', [point(-100, 0), point(100, 0)], 4), road('main', [point(-100, 100), point(100, 100)], 14)];
        city.editor.water.source.roads = structuredClone(city.streets);
        const before = structuredClone(city.streets), history = createEditorHistory();
        let candidate = createBuilding(city, 'house', point(0, side * 12));
        for (let step = 0; step < 3; step++) {
            const preview = planBuildingReplacement(city, candidate, {snapDistance: 12, regenerateStreets: false});
            const plan = planBuildingReplacement(city, candidate, {snapDistance: 12});
            assert.ok(plan.ok, plan.message);
            assert.ok(plan.snap);
            assert.deepEqual(plan.building, preview.building);
            history.record(city);
            const placed = applyBuildingPlan(city, plan);
            assert.deepEqual(city.streets, before);
            assert.deepEqual(city.editor.water.source.roads, before);
            const delta = point(15, side * 2);
            candidate = transformBuilding(placed, {dx: delta[0], dy: delta[1]});
        }
        const saved = serializeProject(city, {});
        history.undo(city);
        history.redo(city);
        assert.equal(serializeProject(city, {}), saved);
        assert.deepEqual(parseProject(saved).city.streets, before);
    }
});

test('large fixed-size complexes commit the snapped preview without moving roads and survive undo and reload', () => {
    for (const kind of ['fort', 'castle', 'temple', 'monastery', 'college', 'institute', 'university', 'magic_school']) {
        const city = town(), history = createEditorHistory();
        city.editor.quarters = [{id: 'lot', polygon: rectangle([0, 0], 200, 200)}];
        if (['fort', 'monastery'].includes(kind)) {
            city.districts = [];
            city.editor.quarters = [];
        }
        const source = createBuilding(city, kind, [0, 40]), roads = structuredClone(city.streets);
        const preview = planBuildingPlacement(city, kind, [0, 40], {snapDistance: 30, regenerateStreets: false});
        const plan = planBuildingPlacement(city, kind, [0, 40], {snapDistance: 30});
        assert.ok(plan.ok && plan.snap, `${kind}: ${plan.message}`);
        assert.deepEqual(plan.building, preview.building, kind);
        assert.ok(Math.abs(area(source.polygon) - area(plan.building.polygon)) < 1e-6, kind);
        history.record(city);
        const placed = applyBuildingPlan(city, plan);
        assert.deepEqual(placed.polygon, plan.building.polygon, kind);
        assert.deepEqual(placed.parts, plan.building.parts, kind);
        assert.deepEqual(city.streets, roads, kind);
        assert.deepEqual(city.editor.water.source.roads, roads, kind);
        const saved = serializeProject(city, {});
        history.undo(city);
        assert.equal(city.buildings.some(b => b.id === placed.id), false, kind);
        history.redo(city);
        assert.equal(serializeProject(city, {}), saved, kind);
        assert.deepEqual(parseProject(saved).city.buildings.find(b => b.id === placed.id), placed, kind);
    }
});

test('a concave palace is bound to its quarter wall even when the wall centre lies in the open courtyard', () => {
    const city = town(), polygon = [[-25, -25], [25, -25], [25, -15], [-15, -15], [-15, 25], [-25, 25]];
    const palace = building('building-1', polygon, {kind: 'castle', custom: false, nativeLandmark: true});
    const wall = {polygon: rectangle([0, 0], 70, 70), towers: [], gates: [], segments: [true, true, true, true]};
    city.buildings = [palace];
    city.walls = [{...wall, polygon: rectangle([0, 0], 300, 200)}, wall];
    city.editor.quarters = [{id: 'palace-quarter', polygon: wall.polygon}];
    restoreEditorAppearance(city);
    assert.deepEqual(palace.fortification, wall);
    assert.equal(city.walls.length, 1);
    assert.deepEqual(city.walls[0].polygon, rectangle([0, 0], 300, 200));
});

test('placement, movement, deletion, undo and JSON restore both road representations with the building', () => {
    const city = town(), history = createEditorHistory(), initial = serializeProject(city, {});
    const candidate = createBuilding(city, 'school', [0, 0]), plan = planBuildingReplacement(city, candidate);
    assert.ok(plan.ok, plan.message);
    assert.notDeepEqual(plan.roads.streets, city.streets);
    assert.equal(serializeProject(city, {}), initial);
    history.record(city);
    const b = applyBuildingPlan(city, plan), changed = serializeProject(city, {});
    assert.ok(!hitsRoad(b, city.streets[0]));
    assert.notDeepEqual(city.editor.water.source.roads[0].points, [[-150, 0], [150, 0]]);
    assert.deepEqual(parseProject(changed).city, city);
    history.undo(city);
    assert.equal(serializeProject(city, {}), initial);
    history.redo(city);
    assert.equal(serializeProject(city, {}), changed);
    const moved = planBuildingReplacement(city, transformBuilding(city.buildings.find(x => x.id === b.id), {dy: 80}));
    assert.ok(moved.ok, moved.message);
    applyBuildingPlan(city, moved);
    assert.deepEqual(city.streets[0].points, [[-150, 0], [150, 0]]);
    removeEditorBuilding(city, b.id);
    assert.deepEqual(city.editor.water.source.roads[0].points, [[-150, 0], [150, 0]]);
});

test('water network rebuilding keeps the building detour and does not restore a street through its footprint', () => {
    const city = town(), plan = planBuildingReplacement(city, createBuilding(city, 'school', [0, 0]));
    assert.ok(plan.ok, plan.message);
    const b = applyBuildingPlan(city, plan), water = planWaterChange(city, [], {repopulate: false});
    assert.ok(water.ok, water.message);
    applyWaterChange(city, water);
    assert.ok(city.streets.every(r => !hitsRoad(b, r)));
    const move = planBuildingReplacement(city, transformBuilding(b, {dy: 80}));
    assert.ok(move.ok, move.message);
    applyBuildingPlan(city, move);
    assert.ok(city.streets.every(r => r.points.every(p => Math.abs(p[1]) < 1e-6)));
    assert.deepEqual(parseProject(serializeProject(city, {})).city, city);
});
