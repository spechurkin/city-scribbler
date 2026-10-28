import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity} from '../src/generation/interactive-city.js';
import {
    applyBuildingPlan,
    commitBuilding,
    containsFootprint,
    createBuilding,
    createEditorHistory,
    enterEditor,
    planBuildingPlacement,
    planBuildingReplacement,
    removeEditorBuilding,
    transformBuilding
} from '../src/editor/building-editor.js';
import {applyQuarterChange, ensureQuarterEditor, planQuarterChange} from '../src/editor/quarter-editor.js';
import {
    affectedPopulationQuarters,
    applyPopulation,
    proceduralHouse,
    repopulateQuarters
} from '../src/districts/quarter-population.js';
import {boxesMeet, boxOf, footprintIntersection, hitsRoad} from '../src/buildings/building-spatial.js';
import {footprintDryInWater, waterGeometry} from '../src/water/water-geometry.js';
import {applyWaterChange, planWaterChange} from '../src/editor/water-editor.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {area, centroid, cross, distance, rectangle, segmentSegmentDistance, sub} from '../src/core/geometry.js';
import {footprintFrame, MIN_REGENERATED_HOUSE_SIZE} from '../src/buildings/footprint-size.js';

function town() {
    const city = enterEditor(generateCity({
        seed: '42',
        size: 8,
        river: false,
        coast: false,
        plaza: false,
        temple: false,
        citadel: false
    }));
    for (const key of ['buildings', 'trees', 'fields', 'gardens', 'walls', 'gates', 'docks', 'bridges', 'approaches', 'streets', 'markets', 'squares', 'monuments']) city[key] = [];
    city.plaza = null;
    city.editor.water = {
        version: 1,
        nextId: 1,
        dirty: false,
        bodies: [],
        source: {roads: [], footbridges: [], docks: []}
    };
    city.districts = [{id: 'main', name: 'Район', wealth: 'mixed', polygon: rectangle([250, 0], 600, 100)}];
    city.editor.quarters = [0, 100, 200, 500].map((x, i) => ({
        id: `q-${i}`,
        district: 'main',
        polygon: rectangle([x, 0], 100, 100)
    }));
    delete city.editor.quarterEditing;
    ensureQuarterEditor(city);
    for (const x of [0, 100, 200, 500]) for (const dx of [-35, -12, 12, 35]) for (const y of [-32, -10, 10, 32]) commitBuilding(city, {
        ...createBuilding(city, 'house', [x + dx, y]),
        custom: false
    });
    city.streets = [-50, 50].map((y, i) => ({id: `road-${i}`, points: [[-50, y], [550, y]], width: 4}));
    city.editor.water.source.roads = structuredClone(city.streets);
    return city;
}

function assertValid(city) {
    const water = waterGeometry(city);
    assert.equal(new Set(city.buildings.map(b => b.id)).size, city.buildings.length);
    assert.ok(city.buildings.every(b => Number(b.id.slice(9)) < city.editor.nextId));
    for (const b of city.buildings.filter(proceduralHouse)) {
        assert.ok(containsFootprint(city.editor.quarters.find(q => q.id === b.quarter) || city.editor.quarters.find(q => containsFootprint(q, b.polygon)), b.polygon), b.id);
        assert.ok(footprintDryInWater(b.polygon, water), b.id);
        assert.ok(!city.streets.some(r => hitsRoad(b, r)), b.id);
        for (const other of city.buildings) if (b !== other && boxesMeet(boxOf(b), boxOf(other))) assert.ok(footprintIntersection(b, other) < 1e-5, `${b.id}/${other.id}`);
    }
}

test('boundary edits keep existing houses and refill only around changed edges and roads', () => {
    const city = town(), before = structuredClone(city), oldIds = new Set(city.buildings.map(b => b.id));
    const plan = planQuarterChange(city, 'q-0', {type: 'move', index: 1, point: [65, -45]});
    assert.ok(plan.ok, plan.message);
    applyQuarterChange(city, plan);
    assert.ok(city.buildings.some(b => oldIds.has(b.id)));
    for (const b of before.buildings.filter(b => centroid(b.polygon)[0] > 150)) assert.deepEqual(city.buildings.find(after => after.id === b.id), b);
    assert.deepEqual(city.buildings.filter(b => centroid(b.polygon)[0] > 400), before.buildings.filter(b => centroid(b.polygon)[0] > 400));
    assertValid(city);
});

test('placement, moving, scaling, rotation and deletion refill released space around manual buildings', () => {
    const city = town(), history = createEditorHistory(),
        far = structuredClone(city.buildings.filter(b => centroid(b.polygon)[0] > 400));
    const original = serializeProject(city, {});
    const add = planBuildingPlacement(city, 'tavern', [0, 0]);
    assert.ok(add.ok, add.message);
    history.record(city);
    const manual = applyBuildingPlan(city, add), shape = structuredClone(manual);
    assert.equal(manual.custom, true);
    assert.deepEqual(city.buildings.find(b => b.id === manual.id), shape);
    assertValid(city);
    const installed = serializeProject(city, {});
    history.undo(city);
    assert.equal(serializeProject(city, {}), original);
    history.redo(city);
    assert.equal(serializeProject(city, {}), installed);
    let current = city.buildings.find(b => b.id === manual.id);
    for (const change of [{dx: 100}, {scaleX: 1.2, scaleY: 1.2}, {angle: .3}]) {
        const candidate = transformBuilding(current, change), plan = planBuildingReplacement(city, candidate);
        assert.ok(plan.ok, plan.message);
        current = applyBuildingPlan(city, plan);
        assert.deepEqual(current.polygon, candidate.polygon);
        assertValid(city);
    }
    removeEditorBuilding(city, current.id);
    assert.ok(!city.buildings.some(b => b.id === current.id));
    assert.ok(city.buildings.some(b => proceduralHouse(b) && containsFootprint(city.editor.quarters[1], b.polygon)));
    assert.deepEqual(city.buildings.filter(b => centroid(b.polygon)[0] > 400), far);
    assertValid(city);
    assert.deepEqual(parseProject(serializeProject(city, {})).city, city);
});

test('generated house editing promotes it to a manual obstacle for subsequent repopulation', () => {
    const city = town(), original = city.buildings[5];
    const plan = planBuildingReplacement(city, transformBuilding(original, {angle: .1}));
    assert.ok(plan.ok, plan.message);
    const edited = structuredClone(applyBuildingPlan(city, plan));
    assert.equal(edited.custom, true);
    applyPopulation(city, repopulateQuarters(city, city, new Set(['q-0', 'q-1'])));
    assert.deepEqual(city.buildings.find(b => b.id === edited.id), edited);
    assertValid(city);
});

test('complexes and resized buildings cannot silently clear a different installed building', () => {
    const city = town();
    const first = applyBuildingPlan(city, planBuildingPlacement(city, 'house', [-30, 0]));
    const second = applyBuildingPlan(city, planBuildingPlacement(city, 'house', [30, 0]));
    const before = serializeProject(city, {});
    const a = centroid(first.polygon), b = centroid(second.polygon);
    assert.equal(planBuildingReplacement(city, transformBuilding(first, {dx: b[0] - a[0], dy: b[1] - a[1]})).ok, false);
    assert.equal(serializeProject(city, {}), before);
    const complex = planBuildingPlacement(city, 'university', [0, 0]);
    if (complex.ok) applyBuildingPlan(city, complex);
    assert.deepEqual(city.buildings.find(b => b.id === first.id), first);
    assert.deepEqual(city.buildings.find(b => b.id === second.id), second);
    assertValid(city);
});

test('water edits regenerate flooded and exposed quarters and reject flooding a manual building', () => {
    const city = town(),
        river = {id: 'water-1', kind: 'river', points: [[0, -100], [0, 100]], width: 30, smooth: false};
    let plan = planWaterChange(city, [river]);
    assert.ok(plan.ok, plan.message);
    applyWaterChange(city, plan);
    assertValid(city);
    plan = planWaterChange(city, []);
    assert.ok(plan.ok, plan.message);
    applyWaterChange(city, plan);
    assert.ok(city.buildings.some(b => b.quarter === 'q-0' && Math.abs(centroid(b.polygon)[0]) < 15));
    assertValid(city);
    applyBuildingPlan(city, planBuildingPlacement(city, 'house', [0, 0]));
    const before = serializeProject(city, {});
    plan = planWaterChange(city, [river]);
    assert.equal(plan.ok, false);
    assert.match(plan.message, /здание/);
    assert.equal(serializeProject(city, {}), before);
});

test('concave quarters and holes stay clear alongside roads, fields and outlying manual parts', () => {
    const city = town(), q = city.editor.quarters[0];
    q.polygon = [[-50, -50], [50, -50], [50, 50], [20, 50], [20, 40], [-20, 40], [-20, 50], [-50, 50]];
    q.rings[0] = q.polygon;
    q.rings.push(rectangle([20, 20], 16, 16).reverse());
    city.fields = [{polygon: rectangle([-25, -25], 30, 30)}];
    city.streets = [{id: 'road', points: [[-40, 0], [40, 0]], width: 8}];
    const manual = {...createBuilding(city, 'house', [0, 30]), parts: {tower: rectangle([-20, 20], 10, 10)}};
    city.buildings.push(manual);
    city.editor.nextId++;
    const before = structuredClone(city);
    city.buildings = city.buildings.filter(b => b === manual || centroid(b.polygon)[0] > 50);
    applyPopulation(city, repopulateQuarters(city, before, new Set(['q-0'])));
    assert.deepEqual(city.buildings.find(b => b.id === manual.id), manual);
    assert.ok(city.buildings.some(b => b.quarter === 'q-0'));
    for (const b of city.buildings.filter(b => b.quarter === 'q-0')) assert.ok(footprintIntersection(b, city.fields[0]) < 1e-5);
    assertValid(city);
});

test('density survives repeated rebuilding and project reload, with deterministic geometry', () => {
    const city = town(), affected = affectedPopulationQuarters(city, [city.editor.quarters[0].polygon]);
    applyPopulation(city, repopulateQuarters(city, city, affected));
    const profiles = city.editor.quarters.map(q => q.population), geometry = city.buildings.map(b => b.polygon);
    const restored = parseProject(serializeProject(city, {})).city;
    applyPopulation(restored, repopulateQuarters(restored, restored, affected));
    assert.deepEqual(restored.editor.quarters.map(q => q.population), profiles);
    assert.deepEqual(restored.buildings.map(b => b.polygon), geometry);
    const invalid = JSON.parse(serializeProject(city, {}));
    invalid.city.editor.quarters[0].population.coverage = -1;
    assert.throws(() => parseProject(JSON.stringify(invalid)), /плотность/);
});

test('placing a school on empty ground leaves every existing house in this and adjacent districts exact', () => {
    for (const fallback of [false, true]) {
        const city = town();
        city.buildings = city.buildings.filter(b => Math.abs(centroid(b.polygon)[0]) > 20 || Math.abs(centroid(b.polygon)[1]) > 20);
        if (fallback) city.editor.quarters = [];
        const originals = structuredClone(city.buildings), plan = planBuildingPlacement(city, 'school', [0, 0]);
        assert.ok(plan.ok, plan.message);
        assert.equal(plan.remove.length, 0);
        const school = applyBuildingPlan(city, plan);
        for (const b of originals) assert.deepEqual(city.buildings.find(after => after.id === b.id), b);
        assert.equal(city.buildings.length, originals.length + 1);
        assert.equal(city.buildings.at(-1).id, school.id);
    }
});

test('released frontage is filled with houses at least 9 by 9 metres, always facing a road', () => {
    for (const angle of [0, Math.PI / 7, Math.PI / 2]) {
        const city = town(), before = structuredClone(city), firstNewId = city.editor.nextId;
        city.buildings = city.buildings.filter(b => centroid(b.polygon)[0] > 150);
        if (angle) {
            const rotate = ([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
            for (const map of [before, city]) {
                for (const q of map.editor.quarters) {
                    q.polygon = q.polygon.map(rotate);
                    q.rings = [q.polygon];
                }
                for (const d of map.districts) d.polygon = d.polygon.map(rotate);
                map.buildings = map.buildings.map(b => transformBuilding(b, {angle, origin: [0, 0]}));
                map.streets = map.streets.map(r => ({...r, points: r.points.map(rotate)}));
            }
        }
        applyPopulation(city, repopulateQuarters(city, before, new Set(['q-0', 'q-1'])));
        const houses = city.buildings.filter(b => Number(b.id.slice(9)) >= firstNewId);
        assert.ok(houses.length > 0);
        assert.ok(new Set(houses.map(b => area(b.polygon).toFixed(3))).size > 1, 'new houses have different sizes');
        for (const b of houses) {
            const frame = footprintFrame(b.polygon);
            assert.ok(frame.width >= MIN_REGENERATED_HOUSE_SIZE.width - 1e-6 && frame.height >= MIN_REGENERATED_HOUSE_SIZE.depth - 1e-6);
            assert.ok(area(b.polygon) >= MIN_REGENERATED_HOUSE_SIZE.area - 1e-6);
            assert.ok(city.streets.some(r => {
                const road = sub(r.points[1], r.points[0]);
                const frontage = b.polygon.some((p, i) => Math.abs(cross(sub(b.polygon[(i + 1) % b.polygon.length], p), road)) < 1e-6);
                const clearance = Math.min(...b.polygon.map((p, i) => segmentSegmentDistance(p, b.polygon[(i + 1) % b.polygon.length], ...r.points)));
                return frontage && Math.abs(clearance - r.width / 2 - 1) < 1e-6;
            }));
        }
        assertValid(city);
        const withoutRoads = {...before, streets: [], buildings: []};
        assert.equal(repopulateQuarters(withoutRoads, before, new Set(['q-0'])).added, 0);
    }
});

test('moving and removing a roadside school refills its former footprint without reshuffling neighbours', () => {
    const city = town();
    const school = applyBuildingPlan(city, planBuildingPlacement(city, 'school', [0, 40]));
    const retained = structuredClone(city.buildings.filter(b => b.id !== school.id));
    const moved = applyBuildingPlan(city, planBuildingReplacement(city, transformBuilding(school, {dx: 100})));
    const removed = new Set(retained.filter(b => !city.buildings.some(after => after.id === b.id)).map(b => b.id));
    for (const b of retained) if (!removed.has(b.id)) assert.deepEqual(city.buildings.find(after => after.id === b.id), b);
    assert.ok(city.buildings.some(b => proceduralHouse(b) && distance(centroid(b.polygon), [0, 40]) < 15));
    removeEditorBuilding(city, moved.id);
    assert.ok(city.buildings.some(b => proceduralHouse(b) && distance(centroid(b.polygon), [100, 40]) < 15));
    assertValid(city);
});
