import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity} from '../src/generation/interactive-city.js';
import {
    buildingsOverlap,
    commitBuilding,
    containsFootprint,
    containsPoint,
    createBuilding,
    createEditorHistory,
    enterEditor,
    planBuildingPlacement
} from '../src/editor/building-editor.js';
import {
    applyQuarterChange,
    changeQuarterBoundary,
    deformQuarterPoint,
    ensureQuarterEditor,
    planDistrictWealthChange,
    planQuarterChange,
    rebuildQuarterDistricts
} from '../src/editor/quarter-editor.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {area, centroid, distance, rectangle} from '../src/core/geometry.js';
import {renderMap} from '../src/rendering/render.js';
import {readdir, readFile} from 'node:fs/promises';
import {importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {generateCity as generateLegacy} from '../src/generation/generator.js';
import {polygonBoolean} from '../src/compatible/polygons.js';
import {footprintFrame, MIN_REGENERATED_HOUSE_SIZE} from '../src/buildings/footprint-size.js';

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
    const left = rectangle([0, 0], 100, 100), right = rectangle([100, 0], 100, 100);
    city.districts = [{id: 'left', name: 'Бедная слобода', wealth: 'poor', polygon: left}, {
        id: 'right',
        name: 'Купеческий район',
        wealth: 'rich',
        polygon: right
    }];
    city.editor.quarters = [{id: 'a', district: 'left', polygon: left}, {id: 'b', district: 'right', polygon: right}];
    delete city.editor.quarterEditing;
    for (const key of ['buildings', 'trees', 'fields', 'gardens', 'walls', 'gates', 'docks', 'bridges', 'approaches', 'streets', 'markets', 'squares', 'monuments']) city[key] = [];
    city.editor.water.source = {roads: [], footbridges: [], docks: []};
    ensureQuarterEditor(city);
    return city;
}

function assertRigid(before, after) {
    const points = b => [b.polygon, ...(b.rings || []), ...Object.values(b.parts || {}), b.towerPoints || [], b.detailCenter ? [b.detailCenter] : []].flat();
    const a = points(before), b = points(after);
    assert.equal(a.length, b.length, before.id);
    assert.ok(Math.abs(area(before.polygon) - area(after.polygon)) < 1e-6, `area of ${before.id}`);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.abs(distance(a[i], a[j]) - distance(b[i], b[j])) < 1e-6, `shape and details of ${before.id}`);
}

function addHouse(city, point, custom = false) {
    return commitBuilding(city, {...createBuilding(city, 'house', point), custom});
}

test('district wealth can change between every type without altering buildings, boundaries or neighbours', () => {
    for (const from of ['poor', 'mixed', 'rich']) for (const to of ['poor', 'mixed', 'rich']) {
        const city = town();
        city.districts[0].wealth = from;
        ensureQuarterEditor(city);
        addHouse(city, [0, 0], true);
        addHouse(city, [100, 0]);
        const before = structuredClone(city), expected = structuredClone(city);
        expected.districts[0].wealth = to;
        expected.editor.quarterEditing.catalog[0].wealth = to;
        const plan = planDistrictWealthChange(city, 'left', to);
        assert.ok(plan.ok, plan.message);
        assert.deepEqual(city, before, 'planning does not mutate the city');
        applyQuarterChange(city, plan);
        assert.deepEqual(city, expected, `${from} to ${to} only updates district metadata`);
        const svg = renderMap(city);
        assert.match(svg, new RegExp(`data-building-wealth="${to}"`));
    }
});

test('district wealth survives undo, redo, JSON and subsequent boundary edits', () => {
    const city = town(), history = createEditorHistory();
    addHouse(city, [0, 0]);
    const before = serializeProject(city, {}), plan = planDistrictWealthChange(city, 'left', 'rich');
    history.record(city);
    applyQuarterChange(city, plan);
    const after = serializeProject(city, {});
    history.undo(city);
    assert.equal(serializeProject(city, {}), before);
    history.redo(city);
    assert.equal(serializeProject(city, {}), after);
    const restored = parseProject(after).city;
    const geometry = planQuarterChange(restored, 'a', {type: 'move', index: 1, point: [55, -45]});
    assert.ok(geometry.ok, geometry.message);
    applyQuarterChange(restored, geometry);
    assert.equal(restored.districts.find(d => d.id === 'left').wealth, 'rich');
    assert.equal(restored.editor.quarterEditing.catalog.find(d => d.id === 'left').wealth, 'rich');
});

test('changing district wealth preserves existing special buildings and updates new placement rules', () => {
    const city = town();
    const school = commitBuilding(city, createBuilding(city, 'parish_school', [-25, 0]));
    assert.equal(planBuildingPlacement(city, 'restaurant', [20, 20]).ok, false);
    const plan = planDistrictWealthChange(city, 'left', 'rich');
    assert.ok(plan.ok, plan.message);
    applyQuarterChange(city, plan);
    assert.deepEqual(city.buildings.find(b => b.id === school.id), school);
    assert.equal(planBuildingPlacement(city, 'restaurant', [20, 20]).ok, true);
    assert.equal(planBuildingPlacement(city, 'parish_school', [20, 20]).ok, false);
});

test('invalid district type edits are atomic and only edited maps accept them', () => {
    const city = town(), before = serializeProject(city, {});
    for (const [id, wealth] of [['left', 'unknown'], ['left', '__proto__'], ['missing', 'rich']]) {
        assert.equal(planDistrictWealthChange(city, id, wealth).ok, false);
        assert.equal(serializeProject(city, {}), before);
    }
    const generated = generateCity({seed: '42', size: 8});
    assert.equal(planDistrictWealthChange(generated, generated.districts[0].id, 'rich').ok, false);
    delete city.editor.quarterEditing;
    const plan = planDistrictWealthChange(city, 'left', 'mixed');
    assert.ok(plan.ok, plan.message);
    applyQuarterChange(city, plan);
    assert.equal(ensureQuarterEditor(city).catalog.find(d => d.id === 'left').wealth, 'mixed');
});

function assertLayout(before, plan) {
    assert.ok(plan.ok, plan.message);
    const originals = new Map(before.buildings.map(b => [b.id, b]));
    for (const b of plan.city.buildings) {
        if (originals.has(b.id)) assertRigid(originals.get(b.id), b);
        else {
            const frame = footprintFrame(b.polygon);
            assert.ok(frame.width >= MIN_REGENERATED_HOUSE_SIZE.width - 1e-6 && frame.height >= MIN_REGENERATED_HOUSE_SIZE.depth - 1e-6);
        }
        const q = plan.city.editor.quarters.find(q => q.id === b.quarter);
        if (q) assert.ok(containsFootprint(q, b.polygon), `${b.id} stays inside its quarter`);
    }
    for (let i = 0; i < plan.city.buildings.length; i++) for (let j = i + 1; j < plan.city.buildings.length; j++) assert.ok(!buildingsOverlap(plan.city.buildings[i], plan.city.buildings[j]), 'rearranged roofs do not overlap');
}

test('expanding a quarter relocates displaced neighbouring houses without stretching their roofs or details', () => {
    const city = town();
    const displaced = addHouse(city, [60, -30]), stable = addHouse(city, [120, 25]);
    addHouse(city, [60, 0]);
    addHouse(city, [60, 30]);
    const special = commitBuilding(city, createBuilding(city, 'temple', [0, 0]));
    special.parts.tower = rectangle([0, 0], 4, 4);
    special.towerPoints = [[-5, -5], [5, 5]];
    special.detailCenter = [0, 0];
    const q = city.editor.quarters[0], plan = planQuarterChange(city, q.id, {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x * 1.4, y * 1.4]))
    });
    assertLayout(city, plan);
    assert.equal(plan.removedHouses, 0);
    assert.notDeepEqual(plan.city.buildings.find(b => b.id === displaced.id).polygon, displaced.polygon);
    assert.deepEqual(plan.city.buildings.find(b => b.id === stable.id).polygon, stable.polygon);
});

test('dragging a shared vertex rearranges the neighbouring houses as rigid buildings', () => {
    const city = town(), house = addHouse(city, [60, -30]);
    addHouse(city, [110, 25]);
    const plan = planQuarterChange(city, 'a', {type: 'move', index: 1, point: [85, -45]});
    assertLayout(city, plan);
    assert.equal(plan.removedHouses, 0);
    assert.notDeepEqual(plan.city.buildings.find(b => b.id === house.id).polygon, house.polygon);
});

test('a neighbouring house moves when a changed road reaches it, even if the quarter still contains it', () => {
    const city = town(), house = addHouse(city, [100, 0]);
    city.editor.water.source.roads = [{id: 'road-1', points: [[85, -40], [85, 40]], width: 6, major: false}];
    const q = city.editor.quarters[0], plan = planQuarterChange(city, q.id, {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x * 1.4, y * 1.4]))
    });
    assertLayout(city, plan);
    assert.equal(plan.removedHouses, 0);
    assert.notDeepEqual(plan.city.buildings.find(b => b.id === house.id).polygon, house.polygon);
});

test('roofs that originally share a slanted edge cannot overlap after quarter stretching', () => {
    const city = town(), first = addHouse(city, [70, 0]), second = addHouse(city, [120, 0]);
    first.polygon = [[60, -15], [80, -15], [80, 15]];
    second.polygon = [[60, -15], [80, 15], [60, 15]];
    first.rings = [first.polygon];
    second.rings = [second.polygon];
    const q = city.editor.quarters[0], plan = planQuarterChange(city, q.id, {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x * 1.4, y * 1.4]))
    });
    assert.ok(plan.ok, plan.message);
    assert.equal(plan.removedHouses, 0);
    for (const b of plan.city.buildings) assertRigid(city.buildings.find(old => old.id === b.id), b);
    const [a, b] = plan.city.buildings;
    assert.ok(polygonBoolean(a.polygon, b.polygon, 'intersection').reduce((sum, p) => sum + area(p), 0) < 1e-5);
});

test('nonuniform stretching and repeated shrinking never scale buildings in the selected or adjacent quarter', () => {
    const city = town();
    addHouse(city, [-35, -30]);
    addHouse(city, [15, 25]);
    addHouse(city, [65, 0]);
    addHouse(city, [125, 20]);
    const before = structuredClone(city), first = city.editor.quarters[0];
    let plan = planQuarterChange(city, 'a', {
        type: 'transform',
        rings: first.rings.map(r => r.map(([x, y]) => [x * .8, y * 1.3]))
    });
    assertLayout(before, plan);
    applyQuarterChange(city, plan);
    for (let step = 0; step < 6; step++) {
        const q = city.editor.quarters[0], center = centroid(q.polygon);
        plan = planQuarterChange(city, 'a', {
            type: 'transform',
            rings: q.rings.map(r => r.map(p => p.map((n, i) => center[i] + (n - center[i]) * .95)))
        });
        assertLayout(before, plan);
        applyQuarterChange(city, plan);
    }
});

test('rotating a quarter turns its buildings and details rigidly with it', () => {
    const city = town(), house = addHouse(city, [-10, 0], true), q = city.editor.quarters[0];
    const angle = Math.PI / 12, c = Math.cos(angle), s = Math.sin(angle);
    const plan = planQuarterChange(city, 'a', {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x * c - y * s, x * s + y * c]))
    });
    assertLayout(city, plan);
    const after = plan.city.buildings.find(b => b.id === house.id);
    for (let i = 0; i < house.polygon.length; i++) {
        const [x, y] = house.polygon[i];
        assert.ok(distance(after.polygon[i], [x * c - y * s, x * s + y * c]) < 1e-6);
    }
});

test('crowding removes only ordinary buildings, reports the change and supports exact undo', () => {
    const city = town(), history = createEditorHistory();
    addHouse(city, [100, 0], false);
    const before = serializeProject(city, {}), q = city.editor.quarters[0];
    const plan = planQuarterChange(city, 'a', {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x * 2.96, y * 2.96]))
    });
    assert.ok(plan.ok, plan.message);
    assert.equal(plan.removedHouses, 1);
    history.record(city);
    applyQuarterChange(city, plan);
    assert.equal(city.buildings.length, 0);
    history.undo(city);
    assert.equal(serializeProject(city, {}), before);
    history.redo(city);
    assert.equal(city.buildings.length, 0);
});

test('a user building that cannot fit rejects the edit instead of being distorted or removed', () => {
    const city = town();
    addHouse(city, [100, 0], true);
    const before = serializeProject(city, {}), q = city.editor.quarters[0];
    const plan = planQuarterChange(city, 'a', {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x * 2.96, y * 2.96]))
    });
    assert.equal(plan.ok, false);
    assert.match(plan.message, /без изменения формы/);
    assert.equal(serializeProject(city, {}), before);
});

test('generated quarters retain their exact district membership and rebuild district areas', () => {
    const city = enterEditor(generateCity()),
        before = new Map(city.districts.map(d => [d.id, area(d.polygon) - d.rings.slice(1).reduce((n, p) => n + area(p), 0)]));
    const state = ensureQuarterEditor(city), rebuilt = rebuildQuarterDistricts(city.editor.quarters, state.catalog);
    assert.equal(rebuilt.length, city.districts.length);
    for (const d of rebuilt) {
        const value = d.components.reduce((sum, c) => sum + area(c.polygon) - c.rings.slice(1).reduce((n, p) => n + area(p), 0), 0);
        assert.ok(Math.abs(value - before.get(d.id)) < 1e-4, d.id);
    }
});

test('moving a shared vertex changes both quarters and their district boundaries without a gap', () => {
    const city = town();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    commitBuilding(city, createBuilding(city, 'house', [100, 0]));
    const plan = planQuarterChange(city, 'a', {type: 'move', index: 1, point: [65, -45]});
    assert.ok(plan.ok, plan.message);
    assert.equal(plan.affected, 2);
    applyQuarterChange(city, plan);
    for (const q of city.editor.quarters) assert.ok(q.polygon.some(p => p[0] === 65 && p[1] === -45));
    assert.deepEqual(city.districts.map(d => d.name), ['Бедная слобода', 'Купеческий район']);
    assert.deepEqual(city.districts.map(d => d.wealth), ['poor', 'rich']);
    assert.ok(containsPoint(city.districts.find(d => d.id === 'left'), [55, -30]));
    assert.ok(!containsPoint(city.districts.find(d => d.id === 'right'), [55, -30]));
    for (const b of city.buildings) assert.ok(containsFootprint(city.districts.find(d => d.id === b.district), b.polygon));
});

test('boundary insertion creates one shared node in both neighbouring quarters', () => {
    const city = town(), change = changeQuarterBoundary(city, 'a', {type: 'insert', index: 1, point: [60, 0]});
    assert.equal(change.quarters[0].polygon.length, 5);
    assert.equal(change.quarters[1].polygon.length, 5);
    for (const q of change.quarters) assert.ok(q.polygon.some(p => p[0] === 60 && p[1] === 0));
    const plan = planQuarterChange(city, 'a', {type: 'insert', index: 1, point: [60, 0]});
    assert.ok(plan.ok, plan.message);
    applyQuarterChange(city, plan);
    const removed = planQuarterChange(city, 'a', {type: 'delete', index: 2});
    assert.ok(removed.ok, removed.message);
    applyQuarterChange(city, removed);
    assert.equal(city.editor.quarters[0].polygon.length, 4);
    assert.equal(city.editor.quarters[1].polygon.length, 4);
});

test('deformation maps interior points and shared edges continuously under affine changes', () => {
    const before = rectangle([0, 0], 100, 100), after = before.map(([x, y]) => [x * 1.2 + 20, y * .8 - 10]);
    for (const p of [[0, 0], [50, 0], [-20, 25], before[0]]) {
        const actual = deformQuarterPoint(p, before, after);
        assert.ok(Math.abs(actual[0] - (p[0] * 1.2 + 20)) < 1e-8);
        assert.ok(Math.abs(actual[1] - (p[1] * .8 - 10)) < 1e-8);
    }
});

test('district unions support disconnected quarter groups and holes', () => {
    const city = town(), extra = {id: 'c', district: 'left', polygon: rectangle([250, 0], 60, 60)};
    city.editor.quarters.push(extra);
    const districts = rebuildQuarterDistricts(city.editor.quarters, city.editor.quarterEditing.catalog),
        left = districts.find(d => d.id === 'left');
    assert.equal(left.components.length, 2);
    assert.ok(containsPoint(left, [250, 0]));
    assert.ok(containsFootprint(left, rectangle([250, 0], 10, 10)));
    assert.ok(!containsPoint(left, [130, 0]));
    extra.rings = [extra.polygon, rectangle([250, 0], 20, 20).reverse()];
    const withHole = rebuildQuarterDistricts(city.editor.quarters, city.editor.quarterEditing.catalog).find(d => d.id === 'left');
    assert.equal(withHole.components[1].rings.length, 2);
    assert.ok(!containsPoint(withHole, [250, 0]));
    assert.ok(containsPoint(withHole, [275, 0]));
});

test('T junctions keep all three quarters connected when their shared node moves', () => {
    const city = town();
    city.editor.quarters = [
        {id: 'a', district: 'left', polygon: rectangle([0, 0], 100, 100)},
        {id: 'b', district: 'right', polygon: rectangle([100, -25], 100, 50)},
        {id: 'c', district: 'right', polygon: rectangle([100, 25], 100, 50)}
    ];
    delete city.editor.quarterEditing;
    ensureQuarterEditor(city);
    const shared = city.editor.quarters[0].polygon.findIndex(([x, y]) => x === 50 && y === 0);
    assert.ok(shared >= 0);
    const plan = planQuarterChange(city, 'a', {type: 'move', index: shared, point: [60, 5]});
    assert.ok(plan.ok, plan.message);
    assert.equal(plan.affected, 3);
    applyQuarterChange(city, plan);
    for (const q of city.editor.quarters) assert.ok(q.polygon.some(([x, y]) => x === 60 && y === 5));
    assert.equal(city.districts.find(d => d.id === 'right').components.length, 1);
});

test('reassignment reshapes both districts, and forbidden school placements reject the whole change', () => {
    let city = town();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    let plan = planQuarterChange(city, 'a', {type: 'district', district: 'right'});
    assert.ok(plan.ok, plan.message);
    applyQuarterChange(city, plan);
    assert.equal(city.districts.length, 1);
    assert.equal(city.districts[0].id, 'right');
    assert.equal(city.buildings[0].district, 'right');
    city = town();
    commitBuilding(city, createBuilding(city, 'parish_school', [0, 0]));
    const before = serializeProject(city, {});
    plan = planQuarterChange(city, 'a', {type: 'district', district: 'right'});
    assert.equal(plan.ok, false);
    assert.match(plan.message, /ограничениям/);
    assert.equal(serializeProject(city, {}), before);
});

test('invalid boundaries do not alter quarter or district geometry', () => {
    const city = town(), before = serializeProject(city, {});
    const plan = planQuarterChange(city, 'a', {type: 'move', index: 1, point: [-60, 80]});
    assert.equal(plan.ok, false);
    assert.equal(serializeProject(city, {}), before);
});

test('district reassignment cannot put two guardhouses into the same district', () => {
    const city = town();
    commitBuilding(city, createBuilding(city, 'guardhouse', [0, 0]));
    commitBuilding(city, createBuilding(city, 'guardhouse', [100, 0]));
    const before = serializeProject(city, {}),
        plan = planQuarterChange(city, 'a', {type: 'district', district: 'right'});
    assert.equal(plan.ok, false);
    assert.match(plan.message, /уже есть караульня/);
    assert.equal(serializeProject(city, {}), before);
});

test('unrelated quarter edits preserve an existing imported field dwelling without permitting new field buildings', () => {
    const city = town();
    city.fields = [{polygon: rectangle([300, 0], 100, 100)}];
    const original = {...createBuilding(city, 'house', [300, 0]), custom: false};
    city.buildings.push(original);
    city.editor.nextId++;
    const field = structuredClone(city.fields), quarter = city.editor.quarters[0];
    const plan = planQuarterChange(city, quarter.id, {
        type: 'transform',
        rings: (quarter.rings || [quarter.polygon]).map(r => r.map(([x, y]) => [x + 1, y + 1]))
    });
    assert.ok(plan.ok, plan.message);
    assert.deepEqual(plan.city.buildings.find(b => b.id === original.id).polygon, original.polygon);
    assert.deepEqual(plan.city.fields, field);
    assert.throws(() => commitBuilding(plan.city, createBuilding(plan.city, 'house', [320, 20])), /На полях/);
});

test('quarter geometry, buildings, water and district names survive undo, redo and JSON', () => {
    const city = town(), history = createEditorHistory();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    const before = serializeProject(city, {}),
        plan = planQuarterChange(city, 'a', {type: 'move', index: 1, point: [60, -45]});
    assert.ok(plan.ok, plan.message);
    history.record(city);
    applyQuarterChange(city, plan);
    const after = serializeProject(city, {});
    history.undo(city);
    assert.equal(serializeProject(city, {}), before);
    history.redo(city);
    assert.equal(serializeProject(city, {}), after);
    const restored = parseProject(after).city;
    assert.deepEqual(restored.districts, city.districts);
    assert.deepEqual(restored.editor.quarters, city.editor.quarters);
    const svg = renderMap(restored, {}, {interactive: true, quarterOverlay: '<g id="editor-quarter-controls"/>'});
    assert.ok(svg.indexOf('id="editor-quarter-controls"') < svg.indexOf('id="map-annotations"'));
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
});

const fixtures = new URL('fixtures/mfcg/', import.meta.url);
for (const name of await readdir(fixtures)) {
    test(`${name}: imported district geometry can be edited, saved and rendered`, async () => {
        const city = enterEditor(importMfcgGeoJson(JSON.parse(await readFile(new URL(name, fixtures)))));
        ensureQuarterEditor(city);
        const before = new Map(city.buildings.map(b => [b.id, structuredClone(b)]));
        const q = city.editor.quarters[0];
        const plan = planQuarterChange(city, q.id, {
            type: 'transform',
            rings: q.rings.map(r => r.map(([x, y]) => [x + 1, y + 1]))
        });
        assert.ok(plan.ok, plan.message);
        applyQuarterChange(city, plan);
        const restored = parseProject(serializeProject(city, {})).city;
        assert.deepEqual(restored.editor.quarters, city.editor.quarters);
        for (const b of restored.buildings) if (before.has(b.id)) assertRigid(before.get(b.id), b);
        for (const b of before.values()) if (b.custom || b.name || b.kind !== 'house') assert.ok(restored.buildings.some(after => after.id === b.id), b.id);
        assert.ok(!/NaN|undefined|Infinity/.test(renderMap(restored)));
    });
}

test('legacy quarters deform their layers and survive project reload', () => {
    const city = enterEditor(generateLegacy({seed: 'quarter-editor', size: 'village', geography: 'estuary'}));
    ensureQuarterEditor(city);
    const q = city.editor.quarters[0];
    const plan = planQuarterChange(city, q.id, {
        type: 'transform',
        rings: q.rings.map(r => r.map(([x, y]) => [x + 1, y + 1]))
    });
    assert.ok(plan.ok, plan.message);
    applyQuarterChange(city, plan);
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.editor.quarters, city.editor.quarters);
    assert.ok(!/NaN|undefined|Infinity/.test(renderMap(restored)));
});
