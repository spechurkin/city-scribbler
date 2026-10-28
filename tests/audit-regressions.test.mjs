import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity, normalizeOptions} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {fitsFootprint, footprintFrame} from '../src/buildings/footprint-size.js';
import {dryFootprint, dryPieces} from '../src/roads/bridge-network.js';
import {containsFootprint, enterEditor} from '../src/editor/building-editor.js';
import {generationUiState} from '../src/generation/generation-ui-state.js';
import {renderMap} from '../src/rendering/render.js';
import {castleMapObjects, mapDistricts} from '../src/map/map-selection.js';

test('a usable wing is accepted even when the largest rectangle is too narrow', () => {
    const shape = [[0, 0], [110, 0], [110, 10], [30, 10], [30, 30], [0, 30]];
    assert.ok(footprintFrame(shape).height < 16);
    assert.ok(fitsFootprint(shape, 'castle'));
    const frame = footprintFrame(shape, {width: 24, depth: 16});
    assert.ok(frame.width >= 24 && frame.height >= 16);
    assert.ok(containsFootprint({polygon: shape}, frame.rect));
    assert.equal(fitsFootprint(shape, 'market'), false);
});

for (const seed of ['71237', '641133', '2350821']) test(`castle ${seed} retains a usable dry building inside its original fortification`, () => {
    const city = generateCity({seed, size: 16, coast: false, river: false});
    assert.ok(city.castle);
    assert.ok(fitsFootprint(city.castle.polygon, 'castle'));
    const cell = city.generatedGeometry.cells.find(c => c.id === city.castle.cell);
    const parcel = {polygon: cell.polygon.map(([x, y]) => [x, -y])};
    assert.ok(containsFootprint(parcel, city.castle.polygon));
    assert.ok(dryFootprint(city.castle.polygon, [...city.terrain.sea, ...city.terrain.ribbons]));
    const original = structuredClone(city.generatedGeometry);
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.castle, city.castle);
    assert.deepEqual(city.generatedGeometry, original);
});

test('housing in a castle district can supply a missing temple without replacing the castle', () => {
    const city = generateCity({seed: '1424740', size: 6});
    assert.ok(city.castle && city.temple);
    assert.equal(city.markets.length, 1);
    assert.deepEqual(city.generationWarnings, []);
    assert.ok(dryFootprint(city.temple.court, [city.castle.polygon]));
});

test('impossible landmark quantities are reported in the generation UI and survive project reload', () => {
    const city = generateCity({seed: '4844116', size: 6});
    assert.equal(city.options.marketCount, 1);
    assert.equal(city.markets.length, 0);
    assert.match(generationUiState(city).draftHint, /рынков 0 из 1/);
    const restored = parseProject(serializeProject(city, {})).city;
    assert.deepEqual(restored.generationWarnings, city.generationWarnings);
});

test('a river opens into a small oblique sea across its entire width without changing the recipe', () => {
    const city = generateCity({seed: '569896', size: 6});
    assert.equal(city.terrain.mouths.length, 1);
    const mouth = city.terrain.mouths[0];
    assert.equal(dryPieces(mouth.cap, city.terrain.sea).length, 0);
    assert.deepEqual(city.terrain.rivers[0].points, city.generatedGeometry.rivers[0].map(([x, y]) => [x, -y]));
    assert.doesNotMatch(renderMap(city), /NaN|Infinity|undefined/);
});

test('a castle keep overlapping a river is rebuilt on dry ground within the same castle parcel', () => {
    const city = generateCity({seed: '79510967'});
    assert.ok(city.castle);
    const cell = city.generatedGeometry.cells.find(c => c.id === city.castle.cell);
    assert.ok(containsFootprint({polygon: cell.polygon.map(([x, y]) => [x, -y])}, city.castle.polygon));
    assert.ok(dryFootprint(city.castle.polygon, [...city.terrain.sea, ...city.terrain.ribbons]));
    assert.ok(fitsFootprint(city.castle.polygon, 'castle'));
    assert.deepEqual(parseProject(serializeProject(city, {})).city.castle, city.castle);
});

test('a named castle has its own hit target above district targets and keeps its identity through renaming and editor entry', () => {
    const city = generateCity({seed: '79510967'}), object = castleMapObjects(city)[0];
    assert.equal(object.castle, city.castle);
    assert.ok(containsFootprint(object, city.castle.polygon));
    const svg = renderMap(city, {}, {interactive: true, selectedCastle: object.id});
    assert.match(svg, /data-castle="\d+"[^>]+role="button"[^>]+tabindex="0"/);
    assert.ok(svg.lastIndexOf('data-district=') < svg.indexOf('data-castle='));
    assert.ok(svg.includes(`aria-label="Открыть замок ${city.castle.name}"`));
    assert.doesNotMatch(renderMap(city), /data-castle=/);
    assert.doesNotMatch(renderMap(city, {layers: {castle: false}}, {interactive: true}), /data-castle=/);
    city.castle.name = 'Пограничный городок';
    const restored = parseProject(serializeProject(city, {})).city;
    assert.equal(restored.castle.name, 'Пограничный городок');
    assert.deepEqual(restored.districts, city.districts);
    assert.ok(!mapDistricts(city).some(d => d.castleCell === city.castle.cell));
    const castleDistrict = city.districts.find(d => d.castleCell === city.castle.cell);
    assert.ok(!svg.includes(`data-district="${castleDistrict.id}"`));
    assert.ok(!svg.includes(`data-label-district="${castleDistrict.id}"`));
    assert.ok(enterEditor(restored).buildings.some(b => b.kind === 'castle' && b.name === 'Пограничный городок'));
});

test('invalid numeric settings are rejected before they can enter a form or saved city', () => {
    for (const input of [{size: 'constructor'}, {size: 'toString'}, {size: 5}, {size: 201}, {size: 6.5}, {gates: NaN}, {sea: Infinity}, {coastOffset: .31}, {riverWidthScale: 0}, {riverCurvature: -1}]) {
        assert.throws(() => normalizeOptions(input));
    }
});

const base = generateCity({seed: '42', size: 16});
const saved = JSON.parse(serializeProject(base, {}));

test('current projects preserve deliberately chosen names that resemble old placeholders', () => {
    const city = structuredClone(base);
    city.name = `Город ${city.options.seed}`;
    const district = mapDistricts(city)[0];
    district.name = 'Квартал 1';
    const restored = parseProject(serializeProject(city, {})).city;
    assert.equal(restored.name, city.name);
    assert.equal(restored.districts.find(d => d.id === district.id).name, district.name);
});

test('malformed saved geometry cannot introduce SVG attributes or invalid coordinates', () => {
    const mutations = [
        g => {
            g.experimental.housing[0][0][0] = '0" onload="alert(1)';
        },
        g => {
            g.cells[0].polygon[0] = [null, 0];
        },
        g => {
            g.roads[0] = [];
        },
        g => {
            g.riverWidths[0] = 0;
        },
        g => {
            g.rivers[0][0] = ['1', 2];
        },
        g => {
            g.walls[0].segments[0] = 'true';
        },
        g => {
            g.piers.push([[0, 0], [0, 0]]);
        },
        g => {
            g.experimental.treeDrawings.push({point: [0, 0], index: 1e9});
        },
        g => {
            g.experimental.districtLandmarks.sites[0].polygon = [[1, 2]];
        },
        g => {
            g.experimental.specialBuildings[0].kind = 'castle" onload="alert(1)';
        }
    ];
    for (const mutate of mutations) {
        const project = structuredClone(saved);
        mutate(project.geometry);
        assert.throws(() => parseProject(JSON.stringify(project)), /Некорректная геометрия/);
    }
    assert.throws(() => parseProject('null'), /Этот файл не является проектом/);
});

test('edited projects reject duplicate regions and collapsed bridge or pier axes', () => {
    const project = JSON.parse(serializeProject(enterEditor(base), {}));
    const mutations = [
        c => {
            c.districts.push(structuredClone(c.districts[0]));
        },
        c => {
            c.editor.quarters.push(structuredClone(c.editor.quarters[0]));
        },
        c => {
            c.docks.push({points: [[0, 0], [0, 0]], width: 4.8});
        },
        c => {
            c.docks.push({points: [[0, 0], [10, 0]]});
        },
        c => {
            c.bridges.push({id: 'bridge-bad', polygon: [[0, 0], [10, 0], [10, 10]], a: [0, 0], b: [0, 0], width: 4.8});
        }
    ];
    for (const mutate of mutations) {
        const invalid = structuredClone(project);
        mutate(invalid.city);
        assert.throws(() => parseProject(JSON.stringify(invalid)));
    }
    const restored = parseProject(JSON.stringify(project)).city;
    assert.doesNotMatch(renderMap(restored), /NaN|Infinity|undefined/);
});
