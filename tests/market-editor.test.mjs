import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacy} from '../src/generation/generator.js';
import {
    applyBuildingPlan,
    buildingsOverlap,
    createBuilding,
    createEditorHistory,
    enterEditor,
    planBuildingReplacement,
    removeEditorBuilding,
    transformBuilding,
    validatePlacement
} from '../src/editor/building-editor.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {centroid, rectangle} from '../src/core/geometry.js';
import {renderMap} from '../src/rendering/render.js';

const source = generateCity({seed: '1931200012', size: 34, river: false, coast: false, marketCount: 3});
const marketsOf = city => city.buildings.filter(b => b.kind === 'market');

test('each generated market becomes one selectable object including its lot, stalls and fountain', () => {
    const before = serializeProject(source, {}), city = enterEditor(source), markets = marketsOf(city);
    assert.equal(markets.length, 3);
    assert.ok(!city.buildings.some(b => b.kind === 'stall'));
    assert.deepEqual(city.markets, []);
    assert.deepEqual(city.squares, []);
    const svg = renderMap(city, {}, {interactive: true});
    for (const [i, market] of markets.entries()) {
        assert.deepEqual(market.polygon, source.markets[i].polygon);
        assert.deepEqual(market.marketStallShades, source.markets[i].stalls.map((_, n) => n));
        assert.equal(Object.keys(market.parts).length, source.markets[i].stalls.length + 1);
        for (const [n, p] of source.markets[i].stalls.entries()) assert.deepEqual(market.parts[`stall_${n}`], p);
        assert.ok(Math.hypot(...centroid(market.parts.fountain).map((v, n) => v - source.markets[i].center[n])) < 1e-6);
        assert.equal(svg.split(`data-building="${market.id}"`).length - 1, 1);
    }
    assert.equal(serializeProject(source, {}), before);
});

test('moving, rotating and resizing a market carries every part and preserves other markets', () => {
    const city = enterEditor(source), markets = marketsOf(city), original = structuredClone(markets),
        market = markets[0];
    // Keep the complete market and its neighbours, with a vacant dry destination for the edit.
    city.buildings = markets;
    city.streets = [];
    city.editor.water.source.roads = [];
    city.editor.quarters = [];
    city.districts = [];
    const change = {dx: 1500, dy: 800, scaleX: 1.4, scaleY: .8, angle: .4},
        candidate = transformBuilding(market, change), origin = centroid(market.polygon);
    for (const [key, polygon] of Object.entries(market.parts)) polygon.forEach(([x, y], i) => {
        const px = (x - origin[0]) * change.scaleX, py = (y - origin[1]) * change.scaleY;
        assert.deepEqual(candidate.parts[key][i], [origin[0] + change.dx + px * Math.cos(change.angle) - py * Math.sin(change.angle), origin[1] + change.dy + px * Math.sin(change.angle) + py * Math.cos(change.angle)]);
    });
    const history = createEditorHistory(), before = serializeProject(city, {}),
        plan = planBuildingReplacement(city, candidate);
    assert.ok(plan.ok, plan.message);
    history.record(city);
    const edited = applyBuildingPlan(city, plan);
    assert.deepEqual(edited.parts, candidate.parts);
    assert.deepEqual(marketsOf(city).slice(1), original.slice(1));
    assert.ok(!renderMap(city, {}).includes(`M${market.polygon.map(p => p.join(',')).join('L')}Z`), 'the old lot is no longer drawn');
    const changed = serializeProject(city, {});
    assert.equal(renderMap(parseProject(changed).city, {}), renderMap(city, {}));
    history.undo(city);
    assert.equal(serializeProject(city, {}), before);
    history.redo(city);
    assert.equal(serializeProject(city, {}), changed);
    history.record(city);
    removeEditorBuilding(city, edited.id);
    assert.equal(marketsOf(city).length, 2);
    assert.ok(!renderMap(city, {}).includes(`M${candidate.polygon.map(p => p.join(',')).join('L')}Z`));
    history.undo(city);
    assert.equal(serializeProject(city, {}), changed);
});

test('the entire market lot participates in collision and water checks', () => {
    const city = enterEditor(source), market = marketsOf(city)[0];
    const square = {...market, polygon: rectangle([0, 0], 100, 80), rings: [rectangle([0, 0], 100, 80)], parts: {}};
    const house = createBuilding(city, 'house', [35, 0]);
    assert.ok(buildingsOverlap(square, house));
    city.buildings = [square];
    city.terrain.sea = [];
    city.terrain.ribbons = [];
    assert.equal(planBuildingReplacement(city, house, {regenerateStreets: false}).ok, false);
    city.buildings = [];
    city.terrain.sea = [rectangle([35, 0], 5, 5)];
    assert.equal(validatePlacement(city, square).ok, false);
});

test('market visibility hides the complete object, including ground and fountain', () => {
    const city = enterEditor(source), market = marketsOf(city)[0];
    const svg = renderMap(city, {layers: {market: false}}, {interactive: true, selectedBuilding: market.id});
    assert.ok(!svg.includes('data-building-kind="market"'));
    assert.ok(!svg.includes('id="editor-selection"'));
    assert.ok(!svg.includes(`M${market.polygon.map(p => p.join(',')).join('L')}Z`));
});

test('legacy markets retain their layout and become one object through JSON reload', () => {
    const original = generateLegacy({seed: 'label-overlay', size: 'village'}), city = enterEditor(original),
        market = marketsOf(city)[0];
    assert.ok(original.plaza.stalls.length > 0);
    assert.equal(marketsOf(city).length, 1);
    assert.equal(city.plaza, null);
    assert.deepEqual(market.marketStallShades, original.plaza.stalls.map(b => b.shade));
    for (const [i, b] of original.plaza.stalls.entries()) assert.deepEqual(market.parts[`stall_${i}`], b.polygon);
    assert.deepEqual(parseProject(serializeProject(city, {})).city.buildings, city.buildings);
});

test('project loading rejects invalid market shade and fountain geometry', () => {
    const city = enterEditor(source);
    for (const edit of [b => b.marketStallShades = [-1], b => b.marketStallShades = 'bad', b => b.parts.fountain.pop(), b => b.parts.stall_0.pop()]) {
        const data = JSON.parse(serializeProject(city, {}));
        edit(marketsOf(data.city)[0]);
        assert.throws(() => parseProject(JSON.stringify(data)), /геометри/);
    }
});

test('older legacy editor projects group existing stalls without swallowing custom standalone shops', () => {
    const original = generateLegacy({seed: 'label-overlay', size: 'village'}), city = enterEditor(original);
    city.buildings = city.buildings.filter(b => b.kind !== 'market');
    city.plaza = structuredClone(original.plaza);
    const native = city.plaza.stalls.map(b => ({
        ...b, id: `building-${city.editor.nextId++}`, kind: 'stall',
        name: '', rings: [b.polygon], parts: {}, district: null
    }));
    const shop = createBuilding(city, 'stall', centroid(city.plaza.polygon));
    city.editor.nextId++;
    city.buildings.push(...native, shop);
    city.plaza.stalls = [];
    const restored = parseProject(serializeProject(city, {})).city;
    assert.equal(marketsOf(restored).length, 1);
    assert.deepEqual(restored.buildings.find(b => b.id === shop.id), shop);
    assert.deepEqual(marketsOf(restored)[0].marketStallShades, native.map(b => b.shade));
    assert.equal(restored.plaza, null);
    assert.ok(!native.some(b => restored.buildings.some(r => r.id === b.id)));
    assert.deepEqual(parseProject(serializeProject(restored, {})).city, restored);
});
