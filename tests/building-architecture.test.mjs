import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BUILDING_TYPES,
    buildingsOverlap,
    createBuilding,
    createEditorHistory,
    enterEditor,
    transformBuilding,
    validPolygon
} from '../src/editor/building-editor.js';
import {architectureInFrame, renderBuildingArchitecture} from '../src/buildings/building-architecture.js';
import {area, bounds, rectangle} from '../src/core/geometry.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {renderEditorBuilding} from '../src/rendering/render-edited.js';
import {THEMES} from '../src/rendering/render.js';

const source = generateCity({seed: '1931200012', size: 8});
const kinds = Object.keys(BUILDING_TYPES);

test('new magic towers use a 24 metre footprint in editor architecture', () => {
    const tower = createBuilding({editor: {nextId: 1}}, 'magic_tower', [0, 0]);
    assert.equal(BUILDING_TYPES.magic_tower.width, 24);
    assert.equal(BUILDING_TYPES.magic_tower.height, 24);
    const [x0, y0, x1, y1] = bounds(tower.polygon);
    assert.equal(x1 - x0, 24);
    assert.equal(y1 - y0, 24);
    assert.ok(Math.abs(area(tower.polygon) / area(architectureInFrame('magic_tower', rectangle([0, 0], 16, 16)).polygon) - 2.25) < 1e-8);
});

test('all architectural parts follow affine edits and survive history and project reload', () => {
    const city = enterEditor(source), history = createEditorHistory();
    city.buildings = kinds.map((kind, i) => {
        city.editor.nextId++;
        return createBuilding(city, kind, [i * 100, 0]);
    });
    city.editor.nextId++;
    history.record(city);
    const before = structuredClone(city.buildings);
    city.buildings = city.buildings.map(b => transformBuilding(b, {
        dx: 7,
        dy: -9,
        angle: .63,
        scaleX: 1.4,
        scaleY: .8
    }));
    for (const [i, b] of city.buildings.entries()) {
        assert.ok(validPolygon(b.polygon), b.kind);
        for (const [key, p] of Object.entries(b.parts)) {
            assert.ok(area(p) > 0 && p.flat().every(Number.isFinite), `${b.kind}/${key}`);
            assert.notDeepEqual(p, before[i].parts[key]);
        }
    }
    const changed = structuredClone(city.buildings), restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.buildings, changed);
    history.undo(city);
    assert.deepEqual(city.buildings, before);
    history.redo(city);
    assert.deepEqual(city.buildings, changed);
    for (const palette of Object.values(THEMES)) for (const roofs of [false, true]) {
        for (const b of changed) assert.equal(renderEditorBuilding(b, city, {roofs}, palette), renderEditorBuilding(restored.buildings.find(r => r.id === b.id), restored, {roofs}, palette));
    }
});

test('building architecture follows explicit rotated frames without losing constituent roofs', () => {
    for (const [kind, rule] of Object.entries(BUILDING_TYPES).filter(([, rule]) => ['court', 'fort', 'temple'].includes(rule.shape))) {
        const frame = rectangle([24, -13], rule.width * 1.5, rule.height * .8, .71),
            b = architectureInFrame(kind, frame);
        assert.ok(validPolygon(b.polygon), kind);
        assert.ok(Object.keys(b.parts).some(key => key.startsWith('roof_')) && Object.keys(b.parts).length >= 4, kind);
        const box = bounds(frame);
        for (const p of Object.values(b.parts).flat()) {
            assert.ok(p[0] >= box[0] - 1e-6 && p[0] <= box[2] + 1e-6 && p[1] >= box[1] - 1e-6 && p[1] <= box[3] + 1e-6, kind);
        }
    }
});

test('a smithy lean-to and tavern furniture participate in collision detection', () => {
    const city = enterEditor(source);
    for (const kind of ['smithy', 'tavern']) {
        const b = createBuilding(city, kind, [0, 0]);
        const p = b.parts.awning;
        const point = p.reduce((s, v) => [s[0] + v[0] / 4, s[1] + v[1] / 4], [0, 0]);
        assert.ok(buildingsOverlap(b, {polygon: rectangle(point, 1, 1), parts: {}}), kind);
    }
});

test('old custom rectangles acquire architecture at render time without rewriting their footprint', () => {
    for (const kind of kinds.filter(k => !['house', 'stall'].includes(k))) {
        const b = {kind, custom: true, polygon: rectangle([15, 20], 30, 20, .45), parts: {}};
        const before = structuredClone(b);
        for (const theme of Object.values(THEMES)) {
            const svg = renderBuildingArchitecture(b, {roofs: false}, theme);
            assert.ok(svg.includes(`data-building-architecture="${kind}"`), kind);
            assert.ok(!/NaN|undefined|data-building-symbol/.test(svg), kind);
        }
        assert.deepEqual(b, before);
    }
});

test('project-supplied part names cannot create SVG attributes', () => {
    const b = createBuilding({editor: {nextId: 1}}, 'smithy', [0, 0]);
    b.parts['roof_" onload="alert(1)'] = rectangle([0, 0], 1, 1);
    const svg = renderBuildingArchitecture(b, {roofs: true}, THEMES.atlas);
    assert.ok(!svg.includes(' onload="'));
});
