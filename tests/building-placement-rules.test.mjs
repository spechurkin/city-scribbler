import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BUILDING_TYPES,
    buildingsOverlap,
    createBuilding,
    planBuildingPlacement,
    planBuildingReplacement,
    removeEditorBuilding,
    transformBuilding,
    validatePlacement
} from '../src/editor/building-editor.js';
import {
    placementRuleError,
    rankPlacementCandidates,
    urbanPlacementRegions,
    wallDistance
} from '../src/buildings/building-placement-rules.js';
import {buildCustomObjects} from '../src/buildings/custom-objects.js';
import {CUSTOM_OBJECT_COUNTS} from '../src/buildings/custom-object-settings.js';
import {bounds, rectangle} from '../src/core/geometry.js';
import {footprints} from '../src/buildings/building-spatial.js';
import {dryFootprint} from '../src/roads/bridge-network.js';
import {random} from '../src/core/random.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';

const zero = Object.fromEntries(Object.values(CUSTOM_OBJECT_COUNTS).map(key => [key, 0]));

function cityForRules(seed = '42', counts = {}) {
    const districts = ['poor', 'mixed', 'rich'].map((wealth, i) => ({
        id: wealth, wealth, name: wealth, kind: 'regular', polygon: rectangle([(i - 1) * 500, 0], 400, 400)
    }));
    return {
        source: {format: 'edited'},
        editor: {baseFormat: 'compatible', nextId: 1},
        options: {size: 200, seed, ...zero, tavernCount: 1, ...counts},
        districts,
        buildings: [],
        special: [],
        squares: [],
        gardens: [],
        streets: [{id: 'main', points: [[-1100, -260], [1100, -260]], width: 8}],
        walls: [],
        docks: [],
        terrain: {sea: [], ribbons: []},
        fields: [{polygon: rectangle([0, 1100], 300, 300)}],
        generatedGeometry: {cells: districts.map(d => ({urban: true, polygon: d.polygon.map(([x, y]) => [x, -y])}))}
    };
}

test('hard wealth restrictions apply to the entire building on add, move and resize', () => {
    const allowed = {
        hotel: ['mixed', 'rich'],
        bathhouse: ['poor', 'mixed', 'rich'],
        school: ['poor', 'mixed', 'rich'],
        lyceum: ['mixed', 'rich'],
        gymnasium: ['mixed', 'rich'],
        magic_school: ['mixed', 'rich'],
        magic_tower: ['mixed', 'rich'],
        korchma: ['poor', 'mixed'],
        tavern: ['poor', 'mixed'],
        cafe: ['mixed', 'rich'],
        restaurant: ['rich'],
        hospital: ['poor', 'mixed'],
        city_hospital: ['rich'],
        warehouse: ['poor'],
        smithy: ['poor', 'mixed', 'rich'],
        workshop: ['poor', 'mixed', 'rich'],
        guildhall: ['poor', 'mixed', 'rich']
    };
    for (const [kind, wealths] of Object.entries(allowed)) {
        const city = cityForRules();
        for (const [i, wealth] of ['poor', 'mixed', 'rich'].entries()) {
            const b = createBuilding(city, kind, [(i - 1) * 500, 0]);
            assert.equal(validatePlacement(city, b).ok, wealths.includes(wealth), `${kind}/${wealth}`);
            const moved = transformBuilding(b, {dx: -(i - 1) * 500});
            assert.equal(validatePlacement(city, moved).ok, wealths.includes('mixed'), `${kind} moved`);
            if (wealths.length < 3) assert.equal(validatePlacement(city, transformBuilding(b, {scaleX: 100})).ok, false, `${kind} boundary`);
        }
    }
});

test('weighted preferences favor the requested wealth while taverns rarely select poor districts', () => {
    const expected = {
        bathhouse: 'poor',
        school: 'mixed',
        lyceum: 'rich',
        gymnasium: 'rich',
        magic_school: 'rich',
        magic_tower: 'rich',
        korchma: 'poor',
        tavern: 'mixed'
    };
    const city = cityForRules(),
        candidates = city.districts.map((district, i) => ({district, point: [(i - 1) * 500, 0]}));
    for (const [kind, wealth] of Object.entries(expected)) {
        const counts = {poor: 0, mixed: 0, rich: 0};
        for (let seed = 1; seed <= 400; seed++) {
            const ranked = rankPlacementCandidates(candidates, BUILDING_TYPES[kind], random(seed, kind), new Map(), city);
            counts[ranked[0].district.wealth]++;
        }
        assert.ok(counts[wealth] > (kind === 'tavern' ? 350 : 260), `${kind}: ${JSON.stringify(counts)}`);
        if (kind === 'tavern') {
            assert.ok(counts.poor > 0 && counts.poor < 50);
            assert.equal(counts.rich, 0);
        }
    }
});

test('forts stay outside all urban land and walls; monasteries additionally avoid fields', () => {
    const city = cityForRules();
    city.walls = [{polygon: rectangle([0, 0], 1500, 500), segments: [true, true, true, true]}];
    for (const kind of ['fort', 'monastery']) {
        assert.equal(validatePlacement(city, createBuilding(city, kind, [0, 0])).ok, false);
        assert.equal(validatePlacement(city, createBuilding(city, kind, [250, 0])).ok, false, 'gap between districts is still inside walls');
        assert.equal(validatePlacement(city, createBuilding(city, kind, [1000, 0])).ok, true);
        const b = createBuilding(city, kind, [1000, 0]);
        b.parts.remote = rectangle([0, 0], 8, 8);
        assert.equal(validatePlacement(city, b).ok, false, 'outlying parts also stay outside');
    }
    assert.equal(validatePlacement(city, createBuilding(city, 'monastery', [0, 1100])).ok, false);
    for (const kind of ['inn', 'chapel', 'temple']) assert.equal(validatePlacement(city, createBuilding(city, kind, [1000, 0])).ok, true, kind);
    assert.equal(validatePlacement(city, createBuilding(city, 'inn', [0, 0])).ok, true);
});

test('fields reject every non-farming building and retain all three farming exceptions', () => {
    for (const [kind, rule] of Object.entries(BUILDING_TYPES)) {
        const city = cityForRules();
        city.districts = [{id: 'allowed', wealth: rule.wealth[0], polygon: rectangle([0, 0], 500, 500)}];
        if (rule.zone === 'outside') city.districts = [];
        city.fields = [{polygon: rectangle([0, 0], 300, 300)}];
        const farming = rule.group === 'Сельское хозяйство';
        assert.equal(rule.avoidFields, !farming, kind);
        assert.equal(validatePlacement(city, createBuilding(city, kind, [0, 0])).ok, farming, kind);
    }
});

test('a fort cannot reach a field through movement, enlargement, a remote part or its courtyard', () => {
    const city = cityForRules();
    city.districts = [];
    city.fields = [{polygon: rectangle([0, 0], 100, 100)}];
    const fort = createBuilding(city, 'fort', [80, 0]);
    assert.equal(validatePlacement(city, fort).ok, true);
    const candidates = [transformBuilding(fort, {dx: -20}), transformBuilding(fort, {scaleX: 2}),
        {...fort, parts: {...fort.parts, remote: rectangle([0, 0], 4, 4)}},
        {...fort, parts: {...fort.parts, court: rectangle([0, 0], 8, 8)}}];
    for (const candidate of candidates) {
        const before = structuredClone(city),
            plan = planBuildingReplacement(city, candidate, {regenerateStreets: false});
        assert.equal(plan.ok, false);
        assert.match(plan.message, /На полях можно размещать только сельскохозяйственные/);
        assert.deepEqual(city, before);
    }
    city.fields = [{polygon: rectangle([80, 0], 8, 8)}];
    assert.equal(validatePlacement(city, fort).ok, false, 'a small field enclosed by the building is also forbidden');
});

test('guardhouses cannot enter gardens, parks or fields through placement, movement or an outlying part', () => {
    for (const zone of ['garden', 'park', 'field']) {
        const city = cityForRules(), polygon = rectangle([0, 0], 100, 100);
        if (zone === 'garden') city.gardens = [{polygon}];
        if (zone === 'park') city.districts.push({id: 'park', kind: 'park', polygon});
        if (zone === 'field') city.fields = [{polygon}];
        const guard = createBuilding(city, 'guardhouse', [80, 0]);
        assert.equal(validatePlacement(city, guard).ok, true, zone);
        for (const building of [createBuilding(city, 'guardhouse', [0, 0]),
            transformBuilding(guard, {dx: -40}),
            {...guard, parts: {...guard.parts, remote: rectangle([0, 0], 4, 4)}}]) {
            assert.equal(validatePlacement(city, building).ok, false, zone);
        }
    }
});

test('schools and lyceums use their priority district first and fall back when its footprint cannot fit', () => {
    for (const [kind, preferred] of [['school', 'mixed'], ['lyceum', 'rich'], ['gymnasium', 'rich']]) {
        const city = cityForRules('8432', {[CUSTOM_OBJECT_COUNTS[kind]]: 1});
        const first = buildCustomObjects(city).buildings.find(b => b.kind === kind);
        assert.equal(first.district, preferred, kind);
        city.districts.find(d => d.wealth === preferred).polygon = rectangle([preferred === 'mixed' ? 0 : 500, 0], 18, 12);
        const fallback = buildCustomObjects(city).buildings.find(b => b.kind === kind);
        assert.ok(fallback && fallback.district !== preferred, `${kind} has an allowed fallback`);
        assert.ok(BUILDING_TYPES[kind].wealth.includes(city.districts.find(d => d.id === fallback.district).wealth));
    }
});

test('guardhouses cannot duplicate a district through add or move; a guardhouse can keep its own slot', () => {
    const city = cityForRules();
    const first = {...createBuilding(city, 'guardhouse', [-500, 0]), id: 'building-1', district: 'poor'};
    city.buildings = [first];
    city.editor.nextId = 2;
    assert.equal(validatePlacement(city, first).ok, true);
    assert.equal(validatePlacement(city, createBuilding(city, 'guardhouse', [-450, 0])).ok, false);
    const second = {...createBuilding(city, 'guardhouse', [0, 0]), id: 'building-2', district: 'mixed'};
    assert.equal(validatePlacement(city, second).ok, true);
    city.buildings.push(second);
    const before = structuredClone(city),
        plan = planBuildingReplacement(city, transformBuilding(second, {dx: -450}), {regenerateStreets: false});
    assert.equal(plan.ok, false);
    assert.match(plan.message, /внутри её района/);
    assert.deepEqual(city, before);
    assert.equal(validatePlacement(city, createBuilding(city, 'guardhouse', [1000, 0])).ok, false);
});

test('generation uses exterior sites, one guardhouse per district and nearby wall slots for barracks', () => {
    const city = cityForRules('86753', {
        fortCount: 2,
        monasteryCount: 2,
        innCount: 6,
        guardhouseCount: 6,
        barracksCount: 3
    });
    city.walls = [{polygon: rectangle([0, 0], 1440, 440), segments: [true, true, true, true]}];
    const before = structuredClone(city), overlay = buildCustomObjects(city), urban = urbanPlacementRegions(city);
    for (const kind of ['fort', 'monastery']) {
        const list = overlay.buildings.filter(b => b.kind === kind);
        assert.equal(list.length, 2, kind);
        for (const b of list) {
            assert.equal(b.district, null);
            assert.ok(footprints(b).every(p => dryFootprint(p, urban)));
            assert.ok(footprints(b).every(p => dryFootprint(p, city.fields.map(f => f.polygon))));
        }
    }
    const guards = overlay.buildings.filter(b => b.kind === 'guardhouse');
    assert.equal(guards.length, 3);
    assert.equal(new Set(guards.map(b => b.district)).size, 3);
    const barracks = overlay.buildings.filter(b => b.kind === 'barracks');
    assert.equal(barracks.length, 3);
    for (const b of barracks) {
        const [x0, y0, x1, y1] = bounds(b.polygon);
        assert.ok(wallDistance(city, [(x0 + x1) / 2, (y0 + y1) / 2]) < 80);
    }
    assert.ok(overlay.buildings.some(b => b.kind === 'inn' && b.district === null));
    for (const b of overlay.buildings) assert.equal(placementRuleError({
        ...city,
        buildings: overlay.buildings
    }, b, BUILDING_TYPES[b.kind]), null, b.kind);
    for (let i = 0; i < overlay.buildings.length; i++) assert.ok(!overlay.buildings.slice(i + 1).some(b => buildingsOverlap(b, overlay.buildings[i])));
    assert.deepEqual(city, before);
});

test('mandatory guardhouses ignore old quantities and only permit translation inside their own district', () => {
    for (const guardhouseCount of [0, 1, 99]) {
        const city = cityForRules('86753', {guardhouseCount});
        const guards = buildCustomObjects(city).buildings.filter(b => b.kind === 'guardhouse');
        assert.deepEqual(guards.map(b => b.district).sort(), city.districts.map(d => d.id).sort());
    }
    const city = cityForRules();
    const guard = {...createBuilding(city, 'guardhouse', [-500, 0]), district: 'poor'};
    city.buildings = [guard];
    const before = structuredClone(city);
    assert.ok(planBuildingReplacement(city, transformBuilding(guard, {dx: 20}), {
        regenerateStreets: false,
        snapDistance: 12
    }).ok);
    for (const change of [{dx: 500}, {scaleX: 1.2}, {angle: Math.PI / 12}]) {
        assert.equal(planBuildingReplacement(city, transformBuilding(guard, change), {regenerateStreets: false}).ok, false);
    }
    assert.equal(planBuildingPlacement(city, 'guardhouse', [0, 0]).ok, false);
    assert.equal(planBuildingPlacement(city, 'house', [-500, 0]).ok, false);
    assert.equal(planBuildingReplacement(city, {...guard, kind: 'house'}).ok, false);
    assert.equal(planBuildingReplacement(city, {...guard, name: 'Другое название'}).ok, false);
    assert.throws(() => removeEditorBuilding(city, guard.id), /не удаляется/);
    assert.deepEqual(city, before);
});

test('real exterior buildings, placement rules and visible map bounds survive project reload', () => {
    const city = generateCity({seed: '1931200012', size: 92});
    assert.ok(city.customObjects.some(b => b.kind === 'fort' && b.district === null));
    assert.ok(city.customObjects.some(b => b.kind === 'monastery' && b.district === null));
    for (const b of city.customObjects) {
        assert.equal(placementRuleError({
            ...city,
            buildings: city.customObjects
        }, b, BUILDING_TYPES[b.kind]), null, b.kind);
        if (BUILDING_TYPES[b.kind].group !== 'Сельское хозяйство') {
            const shapes = [...footprints(b), ...(b.parts.court ? [b.parts.court] : [])];
            assert.ok(shapes.every(p => dryFootprint(p, city.fields.map(f => f.polygon))), b.kind);
        }
        if (b.district === null && !['barn', 'farmhouse', 'windmill'].includes(b.kind)) {
            const [x0, y0, x1, y1] = bounds(footprints(b).flat()), box = city.viewBox;
            assert.ok(x0 >= box.x && y0 >= box.y && x1 <= box.x + box.width && y1 <= box.y + box.height);
        }
    }
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.customObjects, city.customObjects);
    assert.deepEqual(restored.viewBox, city.viewBox);
    assert.deepEqual(restored.generatedGeometry, city.generatedGeometry);
});
