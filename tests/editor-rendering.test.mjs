import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacy} from '../src/generation/generator.js';
import {
    applyBuildingPlan,
    buildingsOverlap,
    createEditorHistory,
    enterEditor,
    planBuildingReplacement,
    removeEditorBuilding,
    transformBuilding,
    validatePlacement
} from '../src/editor/building-editor.js';
import {centroid, rectangle} from '../src/core/geometry.js';
import {importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {renderMap, THEMES} from '../src/rendering/render.js';
import {renderEditorBuilding} from '../src/rendering/render-edited.js';

function svgGroup(svg, attribute) {
    const attributeAt = svg.indexOf(attribute);
    assert.ok(attributeAt >= 0, attribute);
    const start = svg.lastIndexOf('<g', attributeAt), tags = /<\/?g\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0, match;
    while ((match = tags.exec(svg))) {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (depth === 0) return svg.slice(start, tags.lastIndex);
    }
    assert.fail(`Unclosed group ${attribute}`);
}

const original = generateCity({seed: '1931200012', size: 34});
const imported = importMfcgGeoJson(JSON.parse(await readFile(new URL('fixtures/mfcg/berford.json', import.meta.url))));
const legacy = generateLegacy({seed: 'label-overlay', size: 'village'});

for (const source of [original, imported, legacy]) {
    const format = source.source?.format || 'legacy';
    test(`${format}: all annotations remain above selection and editor overlays, also after undo and reload`, () => {
        const city = enterEditor(source), history = createEditorHistory(), building = city.buildings[0];
        const assertTop = (city, editing) => {
            const svg = renderMap(city, {}, {
                interactive: true,
                selected: city.districts[0]?.id,
                selectedBuilding: building.id
            });
            const annotations = svgGroup(svg, 'id="map-annotations"');
            assert.match(annotations, /pointer-events="none"/);
            assert.match(annotations, /data-layer="labels"/);
            assert.ok(svg.endsWith(`${annotations}</svg>`));
            if (editing) {
                assert.ok(svg.indexOf('id="editor-buildings"') < svg.indexOf('id="map-annotations"'));
                assert.ok(svg.indexOf('id="editor-selection"') < svg.indexOf('id="map-annotations"'));
                assert.ok(svg.indexOf('id="editor-preview"') < svg.indexOf('id="map-annotations"'));
            }
            return svg;
        };
        const initial = assertTop(city, true);
        history.record(city);
        city.buildings[0] = transformBuilding(building, {dx: 15, scaleX: 2});
        assertTop(city, true);
        history.undo(city);
        assert.equal(assertTop(city, true), initial);
        assert.equal(assertTop(parseProject(serializeProject(city, {})).city, true), initial);
        assertTop(source, false);
    });
}

for (const theme of ['atlas', 'ink']) {
    for (const roofs of [false, true]) {
        test(`${theme}, roofs=${roofs}: native castle, temples and market stalls keep original paint through undo and JSON`, () => {
            const city = enterEditor(original), history = createEditorHistory(), view = {theme, roofs},
                palette = THEMES[theme], sourceBefore = serializeProject(original, view);
            const checkPaint = city => {
                const svg = renderMap(city, view, {interactive: true});
                for (const kind of ['castle', 'temple']) {
                    const source = svgGroup(renderMap(original, view), `data-landmark="${kind}"`);
                    const building = city.buildings.find(b => b.kind === kind);
                    const edited = svgGroup(svg, `data-building="${building.id}"`);
                    const sourceBody = source.slice(source.indexOf('</title>') >= 0 ? source.indexOf('</title>') + 8 : source.indexOf('>') + 1, -4);
                    const ground = building.parts.court ? sourceBody.match(/^<path\b[^>]*\/>/)?.[0] : '';
                    assert.ok(edited.includes(ground ? sourceBody.slice(ground.length) : sourceBody), kind);
                    if (ground) assert.ok(svgGroup(svg, 'id="editor-grounds"').includes(ground));
                    assert.ok(edited.includes(`fill="${palette.roof[1]}"`));
                    for (const colors of Object.values(palette.wealthRoof)) for (const color of colors) assert.ok(!edited.includes(`fill="${color}"`), `${kind}: ${color}`);
                }
                const markets = city.buildings.filter(b => b.kind === 'market');
                for (const [at, market] of original.markets.entries()) for (let i = 0; i < market.stalls.length; i++) {
                    const body = svgGroup(svg, `data-building="${markets[at].id}"`);
                    assert.ok(body.includes(`fill="${palette.roof[i % palette.roof.length]}"`), `market stall ${i}`);
                }
                assert.equal(svgGroup(svg, 'id="layer-labels"'), svgGroup(renderMap(original, view), 'id="layer-labels"'));
                return svg;
            };
            const initial = checkPaint(city);
            history.record(city);
            city.buildings[0] = transformBuilding(city.buildings[0], {dx: 10});
            history.undo(city);
            assert.equal(checkPaint(city), initial);
            assert.equal(checkPaint(parseProject(serializeProject(city, view)).city), initial);
            assert.equal(serializeProject(original, view), sourceBefore);
        });
    }
}

test('older editor projects combine native stalls and their colors into one persistent market', () => {
    const city = enterEditor(original);
    city.buildings = city.buildings.filter(b => b.kind !== 'market');
    city.markets = structuredClone(original.markets);
    city.squares = structuredClone(original.squares);
    for (const market of city.markets) {
        for (const polygon of market.stalls) city.buildings.push({
            id: `building-${city.editor.nextId++}`, kind: 'stall', polygon, rings: [polygon],
            parts: {}, shade: 0, name: '', district: market.district
        });
        market.stalls = [];
    }
    const restored = parseProject(serializeProject(city, {})).city,
        markets = restored.buildings.filter(b => b.kind === 'market');
    assert.equal(markets.length, original.markets.length);
    assert.ok(!restored.buildings.some(b => b.kind === 'stall'));
    assert.equal(restored.markets.length, 0);
    for (const [i, market] of markets.entries()) {
        assert.deepEqual(market.marketStallShades, original.markets[i].stalls.map((_, n) => n));
        for (const [n, polygon] of original.markets[i].stalls.entries()) assert.deepEqual(market.parts[`stall_${n}`], polygon);
    }
    assert.deepEqual(parseProject(serializeProject(restored, {})).city.buildings, restored.buildings);
});

test('legacy and imported landmarks retain their own palettes instead of adopting district colors', () => {
    for (const source of [legacy, imported]) for (const theme of ['atlas', 'ink']) {
        const city = enterEditor(source), palette = THEMES[theme], svg = renderMap(city, {theme}, {interactive: true});
        for (const b of city.buildings.filter(b => ['castle', 'temple', 'special', 'stall'].includes(b.kind))) {
            const body = svgGroup(svg, `data-building="${b.id}"`);
            const fill = b.kind === 'castle' ? palette.wall : b.kind === 'temple' ? palette.roof[2] : b.kind === 'special' ? palette.ink : [palette.accent, palette.green[0], palette.roof[2]][b.shade % 3];
            assert.ok(body.includes(`fill="${fill}"`), `${city.editor.baseFormat}: ${b.kind}`);
        }
    }
});

test('native palace edits carry its walls, towers and gates through resize, rotation, move, undo and JSON', () => {
    const city = enterEditor(original), history = createEditorHistory();
    city.buildings = city.buildings.filter(b => b.kind !== 'temple');
    const palace = city.buildings.find(b => b.kind === 'castle'), initial = serializeProject(city, {}),
        outerWalls = structuredClone(city.walls);
    assert.ok(palace.fortification);
    const change = {scaleX: 1.15, scaleY: 1.15, angle: .1, dx: 3, dy: -2};
    const candidate = transformBuilding(palace, change), origin = centroid(palace.polygon);
    for (const key of ['polygon', 'towers', 'gates']) palace.fortification[key].forEach(([x, y], i) => {
        const px = (x - origin[0]) * 1.15, py = (y - origin[1]) * 1.15;
        assert.deepEqual(candidate.fortification[key][i], [origin[0] + 3 + px * Math.cos(.1) - py * Math.sin(.1), origin[1] - 2 + px * Math.sin(.1) + py * Math.cos(.1)]);
    });
    const plan = planBuildingReplacement(city, candidate);
    assert.ok(plan.ok, plan.message);
    history.record(city);
    const edited = applyBuildingPlan(city, plan);
    assert.deepEqual(edited.fortification, candidate.fortification);
    assert.deepEqual(city.walls, outerWalls);
    const svg = renderMap(city, {}, {interactive: true});
    const wallPath = `M${edited.fortification.polygon[0].join(',')}L${edited.fortification.polygon[1].join(',')}`;
    assert.ok(svgGroup(svg, 'id="layer-walls"').includes(wallPath));
    assert.ok(renderEditorBuilding(edited, city, {roofs: true}, THEMES.atlas).includes(wallPath), 'drag preview carries the fortification too');
    assert.match(svgGroup(svg, `data-building="${edited.id}"`), /data-building-architecture="castle"/);
    const changed = serializeProject(city, {});
    assert.equal(renderMap(parseProject(changed).city, {}, {interactive: true}), svg);
    history.undo(city);
    assert.equal(serializeProject(city, {}), initial);
    history.redo(city);
    assert.equal(serializeProject(city, {}), changed);
    removeEditorBuilding(city, edited.id);
    assert.ok(!svgGroup(renderMap(city, {}), 'id="layer-walls"').includes(wallPath));
});

for (const source of [original, legacy]) test(`${source.source?.format || 'legacy'}: editing a native church preserves its ground and every original body part`, () => {
    const city = enterEditor(source), church = city.buildings.find(b => b.kind === 'temple');
    city.buildings = city.buildings.filter(b => b.kind !== 'market');
    const candidate = transformBuilding(church, {scaleX: 1.15, scaleY: 1.15});
    const plan = planBuildingReplacement(city, candidate);
    assert.ok(plan.ok, plan.message);
    const b = applyBuildingPlan(city, plan);
    assert.equal(b.nativeLandmark, true);
    assert.deepEqual(b.parts, candidate.parts);
    for (const theme of ['atlas', 'ink']) for (const roofs of [false, true]) {
        const svg = renderMap(city, {theme, roofs}, {interactive: true}),
            body = svgGroup(svg, `data-building="${b.id}"`), ground = svgGroup(svg, 'id="editor-grounds"');
        const groundPath = `M${b.parts.court.map(p => p.join(',')).join('L')}Z`;
        assert.ok(ground.includes(groundPath));
        assert.ok(!body.includes(groundPath));
        assert.equal(body.includes('data-building-architecture="temple"'), city.editor.baseFormat === 'compatible');
        assert.ok(svg.indexOf('id="editor-grounds"') < svg.indexOf('id="editor-buildings"'));
        for (const [key, polygon] of Object.entries(b.parts).filter(([key]) => key !== 'court')) assert.ok(body.includes(`M${polygon.map(p => p.join(',')).join('L')}Z`), key);
        assert.equal(renderMap(parseProject(serializeProject(city, {theme, roofs})).city, {
            theme,
            roofs
        }, {interactive: true}), svg);
    }
});

test('native church ground participates in placement clearance and water validation', () => {
    const city = enterEditor(original), church = city.buildings.find(b => b.kind === 'temple');
    const court = rectangle([0, 0], 100, 80), body = rectangle([0, 0], 12, 20);
    const b = {...church, polygon: body, rings: [body], parts: {court, tower: body}};
    assert.ok(buildingsOverlap(b, {polygon: rectangle([40, 0], 5, 5), parts: {}}));
    city.buildings = [];
    city.terrain.sea = [rectangle([40, 0], 5, 5)];
    city.terrain.ribbons = [];
    assert.equal(validatePlacement(city, b).ok, false);
});

test('older edited native landmarks recover their appearance and palace fortification without changing coordinates', () => {
    const city = enterEditor(original), palace = city.buildings.find(b => b.kind === 'castle');
    const wall = structuredClone(palace.fortification);
    city.walls.push(wall);
    delete palace.fortification;
    for (const b of city.buildings.filter(b => ['castle', 'temple'].includes(b.kind))) {
        delete b.nativeLandmark;
        b.custom = true;
    }
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.buildings.find(b => b.id === palace.id).fortification, wall);
    assert.equal(restored.walls.length, city.walls.length - 1);
    for (const b of restored.buildings.filter(b => ['castle', 'temple'].includes(b.kind))) assert.equal(b.nativeLandmark, true);
    assert.deepEqual(parseProject(serializeProject(restored, {})).city, restored);
    const invalid = JSON.parse(serializeProject(restored, {}));
    invalid.city.buildings.find(b => b.id === palace.id).fortification.gates = [[null, 0]];
    assert.throws(() => parseProject(JSON.stringify(invalid)), /укрепления/);
});
