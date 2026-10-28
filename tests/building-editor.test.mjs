import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
    applyBuildingPlan,
    BUILDING_TYPES,
    buildingTypeGroups,
    commitBuilding,
    containsFootprint,
    createBuilding,
    createEditorHistory,
    enterEditor,
    isEditing,
    placementHint,
    planBuildingPlacement,
    planBuildingReplacement,
    snapBuildingToStreets,
    transformBuilding,
    validatePlacement,
    validPolygon
} from '../src/editor/building-editor.js';
import {BUILDING_PLANS} from '../src/buildings/building-architecture.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacy} from '../src/generation/generator.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {exportMfcgGeoJson, importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {renderMap} from '../src/rendering/render.js';
import {area, bounds, centroid, cross, distance, rectangle, segmentSegmentDistance, sub} from '../src/core/geometry.js';
import {visibleCityBuildings} from '../src/buildings/custom-objects.js';

const base = generateCity({seed: '1931200012', size: 16, river: true, coast: false});

function emptyCity() {
    const city = enterEditor(base);
    city.buildings = [];
    city.districts = ['poor', 'mixed', 'rich'].map((wealth, i) => ({
        id: wealth,
        name: wealth,
        wealth,
        polygon: rectangle([i * 250, 0], 200, 200)
    }));
    city.fields = [{polygon: rectangle([0, 250], 180, 180)}];
    city.terrain.sea = [];
    city.terrain.ribbons = [];
    return city;
}

test('entering the editor makes a detached geometry copy including every special and whole market', () => {
    const before = serializeProject(base, {}), city = enterEditor(base);
    assert.ok(isEditing(city));
    assert.equal(city.buildings.length, visibleCityBuildings(base).length + base.customObjects.length + base.special.filter(b => b.kind !== 'farmhouse').length + base.markets.length);
    assert.ok(city.buildings.some(b => b.kind === 'castle'));
    assert.ok(city.buildings.some(b => b.kind === 'temple'));
    assert.ok(city.buildings.some(b => b.kind === 'market'));
    assert.ok(!city.buildings.some(b => b.kind === 'stall'));
    assert.equal(city.generatedGeometry, undefined);
    assert.equal(city.source.geojson, undefined);
    city.buildings[0].polygon[0][0] += 10;
    assert.equal(serializeProject(base, {}), before);
    assert.throws(() => exportMfcgGeoJson(city));
});

test('all requested buildings and education levels are grouped and sorted in Russian', () => {
    for (const kind of ['fort', 'parish_school', 'school', 'lyceum', 'gymnasium', 'college', 'institute', 'university', 'magic_school', 'magic_tower', 'windmill']) assert.ok(BUILDING_TYPES[kind]);
    const groups = buildingTypeGroups();
    assert.deepEqual(groups.map(g => g.label), groups.map(g => g.label).sort((a, b) => a.localeCompare(b, 'ru')));
    assert.equal(groups.flatMap(g => g.entries).length, Object.keys(BUILDING_TYPES).length);
    assert.ok(!buildingTypeGroups({editable: true}).flatMap(g => g.entries).some(([kind]) => kind === 'guardhouse'));
    for (const group of groups) assert.deepEqual(group.entries.map(([, b]) => b.label), group.entries.map(([, b]) => b.label).sort((a, b) => a.localeCompare(b, 'ru')));
});

test('lodging and dining have their own category; the new hospital remains separate from the infirmary', () => {
    const dining = buildingTypeGroups().find(g => g.label === 'Постой и питание');
    assert.deepEqual(dining.entries.map(([kind]) => kind).sort(), ['cafe', 'hotel', 'inn', 'korchma', 'restaurant', 'tavern']);
    assert.equal(BUILDING_TYPES.hotel.label, 'Гостиница');
    assert.deepEqual(BUILDING_TYPES.hotel.wealth, ['mixed', 'rich']);
    assert.equal(BUILDING_TYPES.city_hospital.group, 'Город');
    assert.equal(BUILDING_TYPES.city_hospital.label, 'Больница');
    assert.equal(BUILDING_TYPES.hospital.label, 'Лечебница');
    assert.deepEqual(BUILDING_TYPES.hospital.wealth, ['poor', 'mixed']);
    for (const kind of ['restaurant', 'city_hospital']) assert.equal(placementHint(kind), 'Не на полях. Только в богатых районах.');
    assert.equal(placementHint('cafe'), 'Не на полях. Только в богатых или смешанных районах.');
    assert.equal(placementHint('parish_school'), 'Не на полях. Только в бедных районах.');
    assert.match(placementHint('korchma'), /Только в смешанных или бедных районах/);
});

test('new dining and hospital restrictions apply to the whole building on placement, move and resize', () => {
    const allowed = {
        restaurant: ['rich'],
        cafe: ['rich', 'mixed'],
        korchma: ['poor', 'mixed'],
        hotel: ['mixed', 'rich'],
        hospital: ['poor', 'mixed'],
        tavern: ['poor', 'mixed'],
        magic_tower: ['mixed', 'rich'],
        warehouse: ['poor'],
        city_hospital: ['rich']
    };
    for (const [kind, wealths] of Object.entries(allowed)) {
        const city = emptyCity();
        for (const [wealth, x] of [['poor', 0], ['mixed', 250], ['rich', 500]]) {
            const b = createBuilding(city, kind, [x, 0]), permitted = wealths.includes(wealth);
            assert.equal(validatePlacement(city, b).ok, permitted, `${kind}/${wealth}`);
            const before = serializeProject(city, {}),
                plan = planBuildingPlacement(city, kind, [x, 0], {snapDistance: 0});
            assert.equal(plan.ok, permitted, `${kind}/${wealth} plan`);
            if (!permitted) {
                assert.equal(plan.message, placementHint(kind));
                assert.equal(serializeProject(city, {}), before);
                continue;
            }
            const saved = commitBuilding(city, b);
            for (const [destination, dx] of [['poor', -x], ['mixed', 250 - x], ['rich', 500 - x]]) {
                const moved = transformBuilding(saved, {dx});
                assert.equal(validatePlacement(city, moved).ok, wealths.includes(destination), `${kind} move to ${destination}`);
            }
            assert.equal(validatePlacement(city, transformBuilding(saved, {scaleX: 30})).ok, false, `${kind} extends outside district`);
            assert.equal(validatePlacement(city, transformBuilding(saved, {dx: 125 - x})).ok, false, `${kind} outside all districts`);
            city.buildings = [];
        }
    }
});

for (const [wealth, x] of [['poor', 0], ['mixed', 250], ['rich', 500]]) {
    test(`education placement rules apply to ${wealth} districts on create, move and resize`, () => {
        const city = emptyCity();
        for (const kind of ['parish_school', 'school', 'lyceum', 'gymnasium', 'college', 'institute', 'university', 'magic_school']) {
            const candidate = createBuilding(city, kind, [x, 0]);
            const allowed = kind === 'school' || kind === 'parish_school' && wealth === 'poor' || kind !== 'parish_school' && wealth !== 'poor';
            assert.equal(validatePlacement(city, candidate).ok, allowed, kind);
            if (allowed) {
                const saved = commitBuilding(city, candidate);
                assert.equal(saved.district, wealth);
                const destination = kind === 'parish_school' ? 500 : 0;
                const moved = transformBuilding(saved, {dx: destination - x});
                assert.equal(validatePlacement(city, moved).ok, kind === 'school' || destination === x);
                if (kind !== 'school') assert.equal(validatePlacement(city, transformBuilding(saved, {scaleX: 20})).ok, false);
                city.buildings = [];
            } else assert.throws(() => commitBuilding(city, candidate));
        }
    });
}

test('mills must remain entirely on fields after moving and enlargement', () => {
    const city = emptyCity(), mill = commitBuilding(city, createBuilding(city, 'windmill', [0, 250]));
    assert.ok(validatePlacement(city, transformBuilding(mill, {dx: 50})).ok);
    assert.equal(validatePlacement(city, transformBuilding(mill, {dy: -250})).ok, false);
    assert.equal(validatePlacement(city, transformBuilding(mill, {scaleX: 20})).ok, false);
    assert.equal(validatePlacement(city, createBuilding(city, 'windmill', [85, 250])).ok, false);
});

test('buildings can move across districts, scale and rotate with their inner geometry', () => {
    const city = emptyCity(), house = commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    house.parts = {tower: rectangle([0, 0], 3, 3)};
    const moved = commitBuilding(city, transformBuilding(house, {dx: 250, scaleX: 2, scaleY: 2, angle: Math.PI / 4}));
    assert.equal(moved.district, 'mixed');
    assert.ok(Math.abs(area(moved.polygon) - area(house.polygon) * 4) < 1e-6);
    assert.ok(Math.abs(centroid(moved.parts.tower)[0] - 250) < 1e-6);
    assert.deepEqual(house.polygon, rectangle([0, 0], 12, 9));
});

test('geometry validation rejects collisions, water, self intersections and invalid coordinates', () => {
    const city = emptyCity();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    assert.equal(validatePlacement(city, createBuilding(city, 'house', [1, 1])).ok, false);
    city.terrain.ribbons = [rectangle([500, 0], 2, 100)];
    assert.equal(validatePlacement(city, createBuilding(city, 'house', [500, 0])).ok, false);
    for (const polygon of [[[0, 0], [20, 20], [0, 20], [20, 0]], [[0, 0], [0, 0], [10, 10]], [[0, 0], [NaN, 5], [10, 10]], [[0, 0], [1, 0], [1, 1]]]) assert.equal(validPolygon(polygon), false);
});

test('full-footprint containment handles concavities and district holes', () => {
    const concave = {polygon: [[0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100]]};
    assert.equal(containsFootprint(concave, rectangle([50, 70], 80, 10)), false);
    const outer = rectangle([0, 0], 100, 100), hole = rectangle([0, 0], 10, 10);
    assert.equal(containsFootprint({polygon: outer, rings: [outer, hole]}, rectangle([0, 0], 30, 30)), false);
    assert.equal(containsFootprint({polygon: outer, rings: [outer, hole]}, rectangle([30, 30], 10, 10)), true);
});

test('undo and redo restore geometry and ID allocation, and a new action clears redo', () => {
    const city = emptyCity(), history = createEditorHistory();
    const start = structuredClone(city.buildings), nextId = city.editor.nextId;
    history.record(city);
    const b = commitBuilding(city, createBuilding(city, 'barracks', [0, 0]));
    history.record(city);
    commitBuilding(city, transformBuilding(b, {dx: 250}));
    history.undo(city);
    assert.equal(city.buildings[0].district, 'poor');
    history.undo(city);
    assert.deepEqual(city.buildings, start);
    assert.equal(city.editor.nextId, nextId);
    history.redo(city);
    assert.equal(city.buildings[0].id, b.id);
    history.record(city);
    city.buildings = [];
    assert.equal(history.canRedo, false);
});

test('edited JSON restores exact changed geometry, names, wealth and view instead of regenerating from seed', () => {
    const city = emptyCity();
    const b = commitBuilding(city, createBuilding(city, 'parish_school', [0, 0]));
    commitBuilding(city, {...transformBuilding(b, {scaleX: 2, angle: .2}), name: 'Приходская школа'});
    const view = {theme: 'ink', layers: {fields: false}};
    const restored = parseProject(serializeProject(city, view));
    assert.deepEqual(restored.city, city);
    assert.deepEqual(restored.view, view);
    assert.ok(isEditing(restored.city));
    const svg = renderMap(restored.city, restored.view, {
        interactive: true,
        selectedBuilding: b.id,
        editingVertices: true
    });
    assert.ok(svg.includes('data-building-kind="parish_school"'));
    assert.ok(svg.includes('data-vertex="0"'));
    assert.ok(svg.includes('data-resize="true"'));
    assert.equal(/MFCG|NaN|Infinity|undefined/.test(svg), false);
    assert.equal(/data-resize|data-vertex|data-building="/.test(renderMap(city)), false);
    assert.equal(renderMap(city, {layers: {buildings: false}}).includes('data-building-kind="parish_school"'), false);
});

test('edited project loader rejects malformed geometry and duplicate IDs', () => {
    const city = emptyCity();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    const project = JSON.parse(serializeProject(city, {}));
    project.city.buildings.push(structuredClone(project.city.buildings[0]));
    assert.throws(() => parseProject(JSON.stringify(project)), /Некорректные здания/);
    project.city.buildings.pop();
    project.city.buildings[0].polygon = [[0, 0], ['2', 0], [1, 10]];
    assert.throws(() => parseProject(JSON.stringify(project)), /Некорректные здания/);
    const unsafe = JSON.parse(serializeProject(city, {}));
    unsafe.city.streets[0].width = '10" onload="alert(1)';
    assert.throws(() => parseProject(JSON.stringify(unsafe)), /Некорректная геометрия/);
});

test('placement includes outlying towers when checking water and automatic replacement', () => {
    const city = emptyCity();
    const neighbour = commitBuilding(city, {...createBuilding(city, 'house', [70, 0]), custom: false});
    const temple = createBuilding(city, 'temple', [0, 0]);
    temple.parts.tower = rectangle([70, 0], 10, 10);
    const plan = planBuildingReplacement(city, temple);
    assert.ok(plan.ok);
    assert.deepEqual(plan.remove, [neighbour.id]);
    city.terrain.ribbons = [rectangle([70, 0], 8, 100)];
    assert.equal(planBuildingReplacement(city, temple).ok, false);
});

test('one click replaces occupied plots, and undo restores every removed building atomically', () => {
    const city = emptyCity(), history = createEditorHistory();
    commitBuilding(city, createBuilding(city, 'house', [-8, 0]));
    commitBuilding(city, {...createBuilding(city, 'house', [8, 0]), custom: false});
    const before = structuredClone(city.buildings);
    const plan = planBuildingPlacement(city, 'tavern', [-8, 0]);
    assert.ok(plan.ok);
    assert.ok(plan.remove.includes(before[0].id));
    history.record(city);
    const tavern = applyBuildingPlan(city, plan);
    assert.equal(tavern.kind, 'tavern');
    assert.equal(city.buildings.some(b => b.id === before[0].id), false);
    history.undo(city);
    assert.deepEqual(city.buildings, before);
    history.redo(city);
    assert.ok(city.buildings.some(b => b.kind === 'tavern'));
});

test('complexes replace only overlapping buildings and preserve the rest of the quarter', () => {
    const city = emptyCity();
    city.editor.quarters = [{id: 'a', polygon: rectangle([235, 0], 100, 120)}, {
        id: 'b',
        polygon: rectangle([325, 0], 60, 120)
    }];
    for (const p of [[210, 0], [265, 0], [280, 0], [320, 0]]) commitBuilding(city, {
        ...createBuilding(city, 'house', p),
        custom: false
    });
    const outside = city.buildings.at(-1).id;
    const plan = planBuildingPlacement(city, 'university', [210, 0]);
    assert.ok(plan.ok, plan.message);
    assert.deepEqual(plan.remove, [city.buildings[0].id]);
    assert.ok(!plan.remove.includes(outside));
    applyBuildingPlan(city, plan);
    assert.ok(city.buildings.some(b => b.id === outside));
    for (const p of [[265, 0], [280, 0], [320, 0]]) assert.ok(city.buildings.some(b => Math.hypot(...sub(centroid(b.polygon), p)) < 1e-6));
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.editor.quarters, city.editor.quarters);
});

test('refused automatic replacements never remove existing buildings', () => {
    const city = emptyCity();
    commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    const before = serializeProject(city, {});
    for (const kind of ['university', 'magic_school', 'windmill']) {
        const plan = planBuildingPlacement(city, kind, [0, 0]);
        assert.equal(plan.ok, false, kind);
        assert.throws(() => applyBuildingPlan(city, plan));
        assert.equal(serializeProject(city, {}), before);
    }
    assert.ok(planBuildingPlacement(city, 'parish_school', [0, 0]).ok);
});

test('increasing a building automatically replaces overlaps instead of requiring manual clearing', () => {
    const city = emptyCity();
    const first = commitBuilding(city, createBuilding(city, 'house', [0, 0]));
    const second = commitBuilding(city, {...createBuilding(city, 'house', [18, 0]), custom: false});
    const plan = planBuildingReplacement(city, transformBuilding(first, {scaleX: 4}));
    assert.ok(plan.ok);
    assert.deepEqual(plan.remove, [second.id]);
    applyBuildingPlan(city, plan);
    assert.ok(!city.buildings.some(b => b.id === second.id));
});

test('building architecture stays visible without roof details and exports contain no icon badges', () => {
    const city = emptyCity();
    assert.deepEqual(Object.keys(BUILDING_PLANS).sort(), Object.keys(BUILDING_TYPES).sort());
    const silhouettes = new Set();
    for (const kind of Object.keys(BUILDING_TYPES)) {
        city.buildings = [createBuilding(city, kind, [0, 0])];
        const svg = renderMap(city, {roofs: false});
        if (!['house', 'stall'].includes(kind)) assert.ok(svg.includes(`data-building-architecture="${kind}"`), kind);
        assert.ok(!svg.includes('data-building-symbol='), kind);
        assert.ok(validPolygon(city.buildings[0].polygon), kind);
        silhouettes.add(JSON.stringify(BUILDING_PLANS[kind].outline));
        assert.ok(!svg.includes('NaN'));
    }
    assert.ok(silhouettes.size >= 10, 'recognition must include different footprints');
});

test('imported and legacy cities keep their terrain and become editable without source branding', async () => {
    const data = JSON.parse(await readFile(new URL('fixtures/mfcg/berford.json', import.meta.url)));
    for (const source of [importMfcgGeoJson(data), generateLegacy({seed: 'editor-legacy', size: 'village'})]) {
        const city = enterEditor(source);
        assert.ok(city.buildings.length >= source.buildings.length);
        assert.equal(city.buildings[0].kind, 'house');
        assert.ok(validPolygon(city.buildings[0].polygon));
        const restored = parseProject(serializeProject(city, {})).city;
        assert.deepEqual(restored.buildings, city.buildings);
        const svg = renderMap(restored, {}, {interactive: true});
        assert.equal(/MFCG|NaN|undefined/.test(svg), false);
        assert.ok(svg.includes('data-building="building-1"'));
    }
});

function streetCity(streets = [{points: [[-100, 0], [100, 0]], width: 10}]) {
    const city = emptyCity();
    city.streets = streets.map((street, i) => ({id: `street-${i}`, ...street}));
    city.editor.quarters = [];
    return city;
}

function streetClearance(building, a, b) {
    return Math.min(...[building.polygon, ...Object.values(building.parts)].flatMap(polygon => polygon.map((p, i) => segmentSegmentDistance(p, polygon[(i + 1) % polygon.length], a, b))));
}

test('street snapping places either side of a building one metre beyond the road edge', () => {
    const city = streetCity();
    for (const side of [-1, 1]) {
        const original = createBuilding(city, 'house', [0, side * 17]), before = structuredClone(original);
        const {building, snap} = snapBuildingToStreets(city, original);
        assert.ok(snap);
        assert.ok(Math.abs(centroid(building.polygon)[1] - side * 10.5) < 1e-6);
        assert.ok(Math.abs(streetClearance(building, ...city.streets[0].points) - 6) < 1e-6);
        assert.deepEqual(original, before);
        assert.equal(building.id, original.id);
    }
});

test('street snapping rotates all building geometry along diagonal and vertical streets', () => {
    for (const angle of [Math.PI / 7, Math.PI / 2, -Math.PI / 3]) {
        const tangent = [Math.cos(angle), Math.sin(angle)], normal = [-tangent[1], tangent[0]];
        const points = [-100, 0, 100].map(k => tangent.map(v => k * v)), city = streetCity([{points, width: 8}]);
        let original = createBuilding(city, 'inn', normal.map(v => v * 25));
        original.parts = {tower: rectangle(centroid(original.polygon), 6, 6)};
        original.rings.push(rectangle(centroid(original.polygon), 4, 4));
        original.towerPoints = [centroid(original.polygon)];
        original.detailCenter = centroid(original.polygon);
        original = transformBuilding(original, {angle: .17});
        const {building, snap} = snapBuildingToStreets(city, original, {distance: 20});
        assert.ok(snap, String(angle));
        assert.ok(building.polygon.some((p, i) => Math.abs(cross(sub(building.polygon[(i + 1) % building.polygon.length], p), tangent)) < 1e-6));
        assert.ok(Math.abs(streetClearance(building, points[0], points[2]) - 5) < 1e-6);
        assert.ok(Math.abs(area(building.polygon) - area(original.polygon)) < 1e-6);
        for (const p of [centroid(building.parts.tower), centroid(building.rings[1]), building.detailCenter, building.towerPoints[0]]) assert.ok(Math.hypot(...sub(p, centroid(building.polygon))) < 1e-6);
    }
});

test('snapping honours the capture distance, can be disabled, and does not extend a street past its end', () => {
    const city = streetCity(), original = createBuilding(city, 'house', [0, 17]);
    for (const distance of [0, 2, 6]) {
        const result = snapBuildingToStreets(city, original, {distance});
        assert.equal(result.snap, null);
        assert.equal(result.building, original);
    }
    assert.ok(snapBuildingToStreets(city, original, {distance: 7}).snap);
    assert.equal(snapBuildingToStreets(city, createBuilding(city, 'house', [150, 12])).snap, null);
    city.streets = [{points: [[0, 0], [0, 0]], width: 10}];
    assert.equal(snapBuildingToStreets(city, original).snap, null);
    city.streets = [];
    assert.equal(snapBuildingToStreets(city, original).building, original);
});

test('legacy a/b streets and reversed paths produce the same snapped footprint', () => {
    const city = streetCity(), original = createBuilding(city, 'house', [0, 17]);
    const expected = snapBuildingToStreets(city, original).building.polygon;
    city.streets = [{a: [100, 0], b: [-100, 0], width: 10}];
    const result = snapBuildingToStreets(city, original);
    assert.ok(result.snap);
    for (let i = 0; i < expected.length; i++) assert.ok(Math.hypot(...sub(result.building.polygon[i], expected[i])) < 1e-6);
});

test('snapping respects street width, nearby junctions and outlying building parts', () => {
    const city = streetCity(), original = createBuilding(city, 'house', [0, 17]);
    original.parts.tower = rectangle([0, 9], 4, 4);
    let result = snapBuildingToStreets(city, original);
    assert.ok(result.snap);
    assert.ok(Math.abs(streetClearance(result.building, ...city.streets[0].points) - 6) < 1e-6);
    city.streets[0].width = 20;
    result = snapBuildingToStreets(city, original);
    assert.ok(result.snap);
    assert.ok(Math.abs(streetClearance(result.building, ...city.streets[0].points) - 11) < 1e-6);
    city.streets.push({points: [[0, -100], [0, 100]], width: 10});
    assert.equal(snapBuildingToStreets(city, createBuilding(city, 'house', [0, 0])).snap, null);
});

test('snapping cannot pull a building into water, outside its allowed district, or off its field', () => {
    const city = streetCity(), house = createBuilding(city, 'house', [0, 20]);
    city.terrain.ribbons = [rectangle([0, 10], 100, 2)];
    assert.equal(snapBuildingToStreets(city, house).snap, null);
    city.terrain.ribbons = [];
    city.districts = [{id: 'poor', wealth: 'poor', polygon: rectangle([0, 50], 100, 75)}];
    const school = createBuilding(city, 'parish_school', [0, 25]);
    assert.ok(validatePlacement(city, school).ok);
    assert.equal(snapBuildingToStreets(city, school, {distance: 20}).snap, null);
    city.fields = [{polygon: rectangle([0, 50], 100, 75)}];
    const mill = createBuilding(city, 'windmill', [0, 25]);
    assert.ok(validatePlacement(city, mill).ok);
    assert.equal(snapBuildingToStreets(city, mill, {distance: 20}).snap, null);
});

test('add and move plans commit the snapped preview, with atomic replacement, undo and JSON restoration', () => {
    const city = streetCity(), history = createEditorHistory();
    const neighbour = commitBuilding(city, {...createBuilding(city, 'house', [0, 10.5]), custom: false});
    const plan = planBuildingPlacement(city, 'house', [0, 22], {snapDistance: 12});
    assert.ok(plan.ok);
    assert.ok(plan.snap);
    assert.deepEqual(plan.remove, [neighbour.id]);
    history.record(city);
    const added = applyBuildingPlan(city, plan);
    assert.deepEqual(added.polygon, plan.building.polygon);
    assert.ok(!city.buildings.some(b => b.id === neighbour.id));
    history.undo(city);
    assert.deepEqual(city.buildings, [neighbour]);
    history.redo(city);
    assert.deepEqual(city.buildings[0].polygon, plan.building.polygon);
    const moved = planBuildingReplacement(city, transformBuilding(added, {dx: 40, dy: 8}), {snapDistance: 12});
    assert.ok(moved.snap);
    applyBuildingPlan(city, moved);
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.buildings[0].polygon, moved.building.polygon);
    assert.equal(Object.hasOwn(restored.buildings[0], 'snap'), false);
    const free = planBuildingReplacement(city, transformBuilding(restored.buildings[0], {dy: 8}));
    assert.equal(free.snap, null);
    assert.ok(Math.abs(centroid(free.building.polygon)[1] - 18.5) < 1e-6);
});

test('every building keeps its catalog dimensions across quarter shapes and maps without quarters', () => {
    for (const [kind, rule] of Object.entries(BUILDING_TYPES)) {
        if (kind === 'guardhouse') continue;
        for (const quarter of [null, rectangle([0, 0], 100, 120), rectangle([0, 0], 25, 20), [[-100, -70], [80, -35], [55, 100], [-70, 60]]]) {
            const city = streetCity([]);
            city.districts = [{id: 'allowed', wealth: rule.wealth[0], polygon: rectangle([0, 0], 1000, 1000)}];
            city.fields = [{polygon: rectangle([0, 0], 1000, 1000)}];
            if (rule.zone === 'outside') {
                city.districts = [];
                city.walls = [];
            }
            if (rule.avoidFields) city.fields = [];
            city.editor.quarters = quarter ? [{id: 'lot', polygon: quarter}] : [];
            const point = [3, 2], plan = planBuildingPlacement(city, kind, point, {regenerateStreets: false});
            assert.ok(plan.ok, `${kind}: ${plan.message}`);
            assert.deepEqual(plan.building.polygon, createBuilding(city, kind, point).polygon, kind);
            assert.deepEqual(plan.building.parts, createBuilding(city, kind, point).parts, kind);
            const box = bounds([plan.building.polygon, ...Object.values(plan.building.parts)].flat());
            assert.ok(Math.abs(box[2] - box[0] - rule.width) < 1e-6, `${kind} width`);
            assert.ok(Math.abs(box[3] - box[1] - rule.height) < 1e-6, `${kind} height`);
        }
    }
});

test('placement refuses insufficient dry, district or field space instead of shrinking buildings', () => {
    for (const [kind, constraint] of [['fort', 'water'], ['house', 'water'], ['university', 'district'], ['windmill', 'field']]) {
        const city = streetCity([]), rule = BUILDING_TYPES[kind];
        city.districts = [{id: 'allowed', wealth: rule.wealth[0], polygon: rectangle([0, 0], 1000, 1000)}];
        if (rule.zone === 'outside') {
            city.districts = [];
            city.walls = [];
        }
        if (constraint === 'water') city.terrain.ribbons = [rectangle([rule.width / 2, 0], rule.width * .4, 100)];
        if (constraint === 'district') city.districts[0].polygon = rectangle([0, 0], rule.width * .8, rule.height * .8);
        if (constraint === 'field') city.fields = [{polygon: rectangle([0, 0], rule.width * .8, rule.height * .8)}];
        const before = serializeProject(city, {}),
            plan = planBuildingPlacement(city, kind, [0, 0], {regenerateStreets: false});
        assert.equal(plan.ok, false, kind);
        assert.deepEqual(plan.building.polygon, createBuilding(city, kind, [0, 0]).polygon, kind);
        assert.equal(serializeProject(city, {}), before);
    }
});

test('all building types snap on add and move without changing any part dimensions', () => {
    for (const [kind, rule] of Object.entries(BUILDING_TYPES)) for (const angle of [0, Math.PI / 7, Math.PI / 2]) {
        if (kind === 'guardhouse') continue;
        const tangent = [Math.cos(angle), Math.sin(angle)], normal = [-tangent[1], tangent[0]];
        const city = streetCity([{points: [-500, 500].map(k => tangent.map(v => k * v)), width: 10}]);
        city.districts = [{id: 'allowed', wealth: rule.wealth[0], polygon: rectangle([0, 0], 2000, 2000)}];
        city.fields = [{polygon: rectangle([0, 0], 2000, 2000)}];
        if (rule.zone === 'outside') {
            city.districts = [];
            city.walls = [];
        }
        if (rule.avoidFields) city.fields = [];
        city.editor.quarters = [{id: 'lot', polygon: rectangle([0, 0], 200, 200)}];
        for (const side of [-1, 1]) {
            const point = normal.map(v => v * side * (rule.height / 2 + 14));
            const original = createBuilding(city, kind, point);
            const plan = planBuildingPlacement(city, kind, point, {snapDistance: 60, regenerateStreets: false});
            assert.ok(plan.ok && plan.snap, `${kind}/${angle}/${side}: ${plan.message}`);
            assert.ok(Math.abs(streetClearance(plan.building, ...city.streets[0].points) - 6) < 1e-6, kind);
            const moved = planBuildingReplacement(city, transformBuilding(plan.building, {
                dx: normal[0] * 5,
                dy: normal[1] * 5
            }), {snapDistance: 12, regenerateStreets: false});
            assert.ok(moved.ok && moved.snap, `${kind} move`);
            for (const candidate of [plan.building, moved.building]) {
                const before = [original.polygon, ...Object.values(original.parts)],
                    after = [candidate.polygon, ...Object.values(candidate.parts)];
                for (let n = 0; n < before.length; n++) for (let i = 0; i < before[n].length; i++) for (let j = i + 1; j < before[n].length; j++) {
                    assert.ok(Math.abs(distance(before[n][i], before[n][j]) - distance(after[n][i], after[n][j])) < 1e-6, `${kind} part ${n}`);
                }
            }
        }
    }
});
