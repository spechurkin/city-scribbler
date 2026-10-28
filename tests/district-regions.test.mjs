import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildDistrictRegions} from '../src/districts/district-regions.js';
import {Mesh} from '../src/compatible/mesh.js';
import {generateCity as generateModel} from '../src/compatible/city.js';
import {buildDistricts} from '../src/compatible/districts.js';
import {generateStructure, structureGeometry} from '../src/compatible/structure.js';
import {
    cityFromGeometry,
    generateCity,
    normalizeOptions,
    recipeFromOptions
} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {area, inside} from '../src/core/geometry.js';
import {renderMap} from '../src/rendering/render.js';

function assertPartition(terrain, regions) {
    const byCell = new Map(), urban = terrain.cells.filter(cell => cell.urban);
    for (const region of regions) for (const id of region.cellIds) {
        assert.equal(byCell.has(id), false, `cell ${id} assigned twice`);
        byCell.set(id, region.id);
    }
    assert.deepEqual([...byCell.keys()].sort((a, b) => a - b), urban.map(cell => cell.id).sort((a, b) => a - b));
    const byGroup = new Map();
    for (const cell of urban) if (cell.group) {
        const district = byCell.get(cell.id);
        if (byGroup.has(cell.group)) assert.equal(byGroup.get(cell.group), district, 'district boundary cuts a housing group');
        byGroup.set(cell.group, district);
    }
    for (const edge of [...terrain.walls.flatMap(w => w.edges), ...terrain.rivers.flatMap(r => r.course)]) {
        if (byCell.has(edge.cell.id) && byCell.has(edge.twin?.cell.id)) assert.notEqual(byCell.get(edge.cell.id), byCell.get(edge.twin.cell.id), 'district crosses a wall or river');
    }
    const inner = new Set(terrain.urban);
    for (const region of regions) {
        const cells = urban.filter(cell => region.cellIds.includes(cell.id)), members = new Set(cells),
            visited = new Set([cells[0]]), queue = [cells[0]];
        for (let index = 0; index < queue.length; index++) for (const edge of terrain.mesh.cycle(queue[index])) {
            const next = edge.twin?.cell;
            if (members.has(next) && !visited.has(next)) {
                visited.add(next);
                queue.push(next);
            }
        }
        assert.equal(visited.size, cells.length, 'disconnected district');
        if (terrain.options.walls) assert.equal(new Set(cells.map(cell => inner.has(cell))).size, 1, 'district combines inner city and outskirts');
        const covered = area(region.rings[0]) - region.rings.slice(1).reduce((sum, ring) => sum + area(ring), 0);
        const expected = Math.abs(cells.reduce((sum, cell) => sum + cell.polygon.reduce((sum, p, i) => {
            const q = cell.polygon[(i + 1) % cell.polygon.length];
            return sum + p[0] * q[1] - q[0] * p[1];
        }, 0) / 2, 0)) * 16;
        assert.ok(Math.abs(covered - expected) < 1e-6 * Math.max(1, expected), 'district loses or overlaps cell area');
    }
}

function grid(width = 3, height = 3) {
    const points = Array.from({length: height + 1}, (_, y) => Array.from({length: width + 1}, (_, x) => [x * 10, y * 10])),
        cells = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push({
        id: cells.length,
        urban: true,
        polygon: [points[y][x], points[y][x + 1], points[y + 1][x + 1], points[y + 1][x]]
    });
    return {
        mesh: new Mesh(cells),
        cells,
        urban: cells,
        options: {walls: false},
        walls: [],
        rivers: [],
        districts: [{id: 0, cells, type: 'regular'}]
    };
}

test('a bent river divides a district even when bridges overwrite edge kinds', () => {
    const terrain = grid(), {mesh} = terrain;
    terrain.rivers = [{course: [mesh.edgeBetween(terrain.cells[1].polygon[0], terrain.cells[1].polygon[3]), mesh.edgeBetween(terrain.cells[4].polygon[0], terrain.cells[4].polygon[1]), mesh.edgeBetween(terrain.cells[5].polygon[0], terrain.cells[5].polygon[3]), mesh.edgeBetween(terrain.cells[8].polygon[0], terrain.cells[8].polygon[3])]}];
    for (const edge of terrain.rivers[0].course) {
        edge.kind = 'road';
        edge.twin.kind = 'road';
    }
    const regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 2);
    assertPartition(terrain, regions);
});

test('a closed wall splits an enclosed district and preserves the hole in the surrounding district', () => {
    const terrain = grid(), enclosed = terrain.cells[4];
    terrain.walls = [{edges: terrain.mesh.cycle(enclosed)}];
    terrain.urban = [enclosed];
    terrain.options.walls = true;
    const regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 2);
    const outer = regions.find(r => !r.cellIds.includes(enclosed.id));
    assert.equal(outer.rings.length, 2);
    assertPartition(terrain, regions);
    assert.deepEqual(buildDistrictRegions(terrain), regions);
});

test('districts without barriers keep their original connected membership', () => {
    const terrain = grid(), regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 1);
    assert.deepEqual(regions[0].cellIds.slice().sort((a, b) => a - b), terrain.cells.map(cell => cell.id));
});

test('a small interior district joins its land neighbor without leaving a hole or shifting the mesh', () => {
    const terrain = grid();
    terrain.options.walls = true;
    terrain.districts = [{id: 0, type: 'bridge', cells: [terrain.cells[4]]}, {
        id: 1,
        type: 'regular',
        cells: terrain.cells.filter(cell => cell.id !== 4)
    }];
    const polygons = terrain.cells.map(cell => structuredClone(cell.polygon)), regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 1);
    assert.equal(regions[0].id, 1);
    assert.deepEqual(regions[0].sourceDistricts, [1, 0]);
    assert.equal(regions[0].rings.length, 1);
    assertPartition(terrain, regions);
    assert.deepEqual(terrain.cells.map(cell => cell.polygon), polygons);
});

test('small parks and citadels retain their own districts, and unwalled districts keep their size', () => {
    for (const ward of ['park', 'castle', null]) {
        const terrain = grid();
        terrain.options.walls = Boolean(ward);
        terrain.cells[4].ward = ward;
        terrain.districts = [{id: 0, type: ward || 'bridge', cells: [terrain.cells[4]]}, {
            id: 1,
            type: 'regular',
            cells: terrain.cells.filter(cell => cell.id !== 4)
        }];
        assert.equal(buildDistrictRegions(terrain).length, 2);
    }
});

test('a small district prefers the neighbor with the longest shared land boundary', () => {
    const terrain = grid();
    terrain.options.walls = true;
    const left = [0, 3, 6], small = [1], right = [2, 4, 5, 7, 8];
    terrain.districts = [{id: 0, type: 'regular', cells: left.map(id => terrain.cells[id])}, {
        id: 1,
        type: 'bridge',
        cells: small.map(id => terrain.cells[id])
    }, {id: 2, type: 'regular', cells: right.map(id => terrain.cells[id])}];
    const regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 2);
    assert.ok(regions.find(r => r.id === 2).cellIds.includes(1));
    assert.deepEqual(regions.find(r => r.id === 0).cellIds.slice().sort((a, b) => a - b), left);
    assertPartition(terrain, regions);
});

test('an oversized district splits into balanced connected districts without creating tiny fragments', () => {
    for (const walls of [false, true]) {
        const terrain = grid(6, 6);
        terrain.options.walls = walls;
        const polygons = terrain.cells.map(cell => structuredClone(cell.polygon)),
            regions = buildDistrictRegions(terrain);
        assert.ok(regions.length >= 4);
        assert.ok(regions.every(region => region.cellIds.length >= 3 && region.cellIds.length <= 10));
        assert.equal(new Set(regions.map(region => String(region.id))).size, regions.length);
        assertPartition(terrain, regions);
        assert.deepEqual(terrain.cells.map(cell => cell.polygon), polygons);
        assert.deepEqual(buildDistrictRegions(terrain), regions);
    }
});

test('area also limits a district made of unusually large cells', () => {
    const terrain = grid(8, 4), points = new Set(terrain.cells.flatMap(cell => cell.polygon));
    for (const p of points) p[0] = p[0] <= 30 ? p[0] * 4 : p[0] + 90;
    terrain.districts = [{id: 0, type: 'regular', cells: terrain.cells.filter(cell => cell.id % 8 < 3)}, {
        id: 1,
        type: 'regular',
        cells: terrain.cells.filter(cell => cell.id % 8 >= 3)
    }];
    const regions = buildDistrictRegions(terrain), largeParts = regions.filter(region => region.sourceDistrict === 0);
    assert.ok(largeParts.length >= 2);
    assert.ok(largeParts.every(region => area(region.polygon) <= 1300 * 16 + 1e-6));
    assertPartition(terrain, regions);
});

test('main streets divide a large district into three natural sectors before balancing area', () => {
    const terrain = grid(6, 6);
    for (const edge of terrain.mesh.edges) if (edge.point[0] === edge.next.point[0] && [20, 40].includes(edge.point[0])) edge.kind = 'road';
    const regions = buildDistrictRegions(terrain);
    assert.ok(regions.length >= 3);
    for (const region of regions) {
        const columns = new Set(region.cellIds.map(id => Math.floor((id % 6) / 2)));
        assert.equal(columns.size, 1, 'a district crosses one of the two main streets');
    }
    assertPartition(terrain, regions);
});

test('a main street also divides a district below the large-district threshold', () => {
    const terrain = grid(2, 3);
    for (const edge of terrain.mesh.edges) if (edge.point[0] === 10 && edge.next.point[0] === 10) edge.kind = 'road';
    const regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 2);
    assert.deepEqual(regions.map(region => region.cellIds.length), [3, 3]);
    for (const region of regions) assert.equal(new Set(region.cellIds.map(id => id % 2)).size, 1);
    assertPartition(terrain, regions);
});

test('small fragments merge with another district on the same side instead of undoing the street division', () => {
    const terrain = grid(4, 3);
    terrain.options.walls = true;
    terrain.districts = [{id: 0, type: 'gate', cells: terrain.cells.slice(0, 4)}, {
        id: 1,
        type: 'regular',
        cells: terrain.cells.slice(4)
    }];
    for (const edge of terrain.mesh.edges) if (edge.point[0] === 20 && edge.next.point[0] === 20) edge.kind = 'road';
    const regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 2);
    assert.deepEqual(regions.map(region => region.cellIds.length), [6, 6]);
    for (const region of regions) assert.equal(new Set(region.cellIds.map(id => (id % 4) < 2)).size, 1);
    assertPartition(terrain, regions);
});

test('large parks and citadels are not divided into administrative districts', () => {
    for (const ward of ['park', 'castle']) {
        const terrain = grid(6, 6);
        for (const cell of terrain.cells) cell.ward = ward;
        assert.equal(buildDistrictRegions(terrain).length, 1);
    }
});

test('a housing group is indivisible even when it exceeds the preferred district size', () => {
    const terrain = grid(6, 6), group = {cells: terrain.cells};
    for (const cell of terrain.cells) cell.group = group;
    const regions = buildDistrictRegions(terrain);
    assert.equal(regions.length, 1);
    assertPartition(terrain, regions);
});

test('arbitrary seeds, gates, citadels and custom water partition every urban cell without mutating compatible geometry', () => {
    let changedCount = 0;
    for (const size of [6, 37, 90]) for (const seed of [42, 720156492783]) for (const coast of [false, true]) for (const walls of [false, true]) {
        const terrain = buildDistricts(generateStructure({
            seed,
            size,
            coast,
            walls,
            river: true,
            shantytown: true,
            citadel: true,
            urban_castle: coast,
            plaza: coast,
            hub: true,
            sea: .73,
            riverWidthScale: coast ? 1.7 : .7,
            riverCurvature: coast ? .6 : 1.4,
            coastOffset: coast ? .04 : 0
        }));
        const before = structureGeometry(terrain), regions = buildDistrictRegions(terrain);
        assertPartition(terrain, regions);
        assert.deepEqual(structureGeometry(terrain), before);
        if (regions.length !== terrain.districts.length || regions.some(r => r.sourceDistricts.length > 1)) changedCount++;
    }
    assert.ok(changedCount > 0);
});

test('the app overlay leaves every compatible layer, retry and random checkpoint identical to the underlying generator', () => {
    const input = {seed: '865334241', size: 27, river: true, coast: true, shantytown: true}, city = generateCity(input);
    const {options} = normalizeOptions(input),
        baseline = structureGeometry(generateModel(recipeFromOptions(options), {forests: true}));
    const actual = structuredClone(city.generatedGeometry), regions = actual.experimental.districtRegions;
    delete actual.experimental.districtRegions;
    delete actual.experimental.districtLandmarks;
    delete actual.experimental.customObjects;
    delete actual.experimental.portLayout;
    assert.deepEqual(actual, baseline);
    assert.equal(city.districts.length, regions.length);
    assert.equal(new Set(city.districts.map(d => d.id)).size, regions.length);
    const split = city.districts.find(d => d.id.includes('-')) || city.districts[0];
    split.name = 'Посад за стеной';
    const restored = parseProject(serializeProject(city, {theme: 'districts'})).city;
    assert.deepEqual(restored.generatedGeometry, city.generatedGeometry);
    assert.equal(restored.districts.find(d => d.id === split.id).name, split.name);
    assert.deepEqual(restored.buildings, city.buildings);
    const legacy = structuredClone(city.generatedGeometry);
    delete legacy.experimental.districtRegions;
    assert.equal(cityFromGeometry(legacy, city.options).districts.length, legacy.experimental.districts.length);
});

test('all MFCG reference recipes retain their compatible details under the app overlay', async () => {
    const fixtures = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
    for (const fixture of fixtures) {
        const {options} = normalizeOptions({seed: fixture.url}), model = generateModel(recipeFromOptions(options)),
            before = structureGeometry(model), regions = buildDistrictRegions(model);
        assertPartition(model, regions);
        assert.deepEqual(structureGeometry(model), before, fixture.name);
        if (fixture.name === 'Palwe') {
            const parts = regions.filter(region => region.sourceDistricts.includes(2));
            assert.ok(parts.length >= 3, 'the large Palwe district from the screenshot must have at least three parts');
            assert.ok(parts.every(region => region.cellIds.length >= 3));
        }
    }
});

test('district holes exclude buildings and remain holes in shading, selection and hit areas', () => {
    const city = generateCity({seed: '42', size: 6, river: false, coast: false, citadel: false, walls: false}),
        geometry = structuredClone(city.generatedGeometry), terrain = grid();
    terrain.walls = [{edges: terrain.mesh.cycle(terrain.cells[4])}];
    const regions = buildDistrictRegions(terrain);
    geometry.experimental.districtRegions = regions;
    geometry.experimental.housing = [[[50, -50], [58, -50], [58, -58], [50, -58]], [[10, -10], [18, -10], [18, -18], [10, -18]]];
    const displayed = cityFromGeometry(geometry, city.options), inner = regions.find(r => r.cellIds.length === 1),
        outer = regions.find(r => r.cellIds.length > 1);
    assert.equal(displayed.buildings[0].district, String(inner.id));
    assert.equal(displayed.buildings[1].district, String(outer.id));
    const svg = renderMap(displayed, {theme: 'districts'}, {interactive: true, selected: String(outer.id)});
    const outerPath = displayed.districts.find(d => d.id === String(outer.id)).rings.map(ring => `M${ring.map(p => p.join(',')).join('L')}Z`).join('');
    assert.equal(svg.split(`d="${outerPath}" fill-rule="evenodd"`).length - 1, 3);
    assert.equal(inside([54, 54], displayed.districts.find(d => d.id === String(outer.id)).rings[1]), true);
});
