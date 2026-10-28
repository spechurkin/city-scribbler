import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {generateStructure, structureGeometry} from '../src/compatible/structure.js';
import {compareGeometry, comparePath, comparePaths} from '../src/compatible/compare.js';
import {parseMfcgReference} from '../src/io/mfcg-reference.js';
import {Mesh, optimizeMesh} from '../src/compatible/mesh.js';
import {Sequence} from '../src/compatible/sequence.js';
import {Triangulation} from '../src/compatible/triangulation.js';

const cases = JSON.parse(await readFile(new URL('fixtures/mfcg-reference-cases.json', import.meta.url)));
const files = (await readdir(new URL('fixtures/mfcg/', import.meta.url))).filter(f => f.endsWith('.json'));
const sources = await Promise.all(files.map(async file => ({
    file,
    data: JSON.parse(await readFile(new URL(`fixtures/mfcg/${file}`, import.meta.url)))
})));
const associations = [];
for (const fixture of cases) {
    const reference = {...parseMfcgReference(fixture.url), name: fixture.name};
    const terrain = generateStructure({
        seed: reference.seed,
        size: reference.size, ...reference.flags, ...reference.optional
    });
    const generated = structureGeometry(terrain);
    const matches = sources.filter(source => comparePath(generated.earth, source.data.features.find(f => f.id === 'earth').coordinates[0], {closed: true}).match);
    associations.push({seed: reference.seed, matches: matches.map(source => source.file)});
    const comparison = matches.length === 1 ? compareGeometry(generated, matches[0].data) : null;
    const paired = comparison ? {} : {skip: 'No unique export associated by geometry; filenames are not used as matching keys'};
    test(`${reference.name}: ordered earth, water, fortification and river coordinates match native export within 1 mm`, paired, () => {
        for (const layer of ['earth', 'water', 'walls', 'riverCourse', 'planks', 'riverWidth']) assert.equal(comparison[layer].match, true, JSON.stringify({layer, ...comparison[layer]}));
        assert.equal(generated.completeness.buildings, false);
        assert.equal(generated.completeness.fullySeedCompatible, false);
    });
    const reviewed = fixture.reviewedRoadLayout ? JSON.parse(await readFile(new URL(`fixtures/${fixture.reviewedRoadLayout}`, import.meta.url))) : null;
    test(`${reference.name}: ordered major road paths match ${reviewed ? 'visually reviewed layout' : 'native export'} within 1 mm`, paired, () => {
        const roads = reviewed ? comparePaths(generated.roads, reviewed.roads) : comparison.mainRoads;
        if (reviewed) assert.equal(reviewed.referenceUrl, fixture.url);
        assert.equal(roads.match, true, `${roads.matchedPoints}/${roads.expectedPoints} ordered road points; see tmp/compatible/report.json`);
    });
    if (reviewed) test(`${reference.name}: reviewed roads connect every gate to the square through continuous mesh edges`, () => {
        assert.deepEqual(terrain.unroutedGates, []);
        assert.equal(terrain.streets.length, terrain.gates.length);
        for (const street of terrain.streets) {
            assert.ok(terrain.plaza.polygon.includes(street[0].point));
            assert.ok(terrain.gates.includes(street.at(-1).next.point));
            for (let i = 0; i < street.length; i++) {
                const edge = street[i];
                assert.ok(terrain.mesh.edges.includes(edge));
                assert.ok(Math.hypot(edge.point[0] - edge.next.point[0], edge.point[1] - edge.next.point[1]) > 0);
                if (i) assert.equal(street[i - 1].next.point, edge.point);
            }
        }
    });
}

test('all eight reference/export associations are unique with filenames ignored', () => {
    assert.equal(associations.filter(a => a.matches.length === 1).length, cases.length);
    assert.ok(associations.every(a => a.matches.length <= 1));
    const matched = associations.flatMap(a => a.matches);
    assert.equal(new Set(matched).size, matched.length);
});

test('geometry comparison rejects reordered vertices and an extra repeated point', () => {
    const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
    assert.equal(comparePath(polygon, [...polygon.slice(2), ...polygon.slice(0, 2)], {closed: true}).match, true);
    assert.equal(comparePath(polygon, [polygon[0], polygon[2], polygon[1], polygon[3]], {closed: true}).match, false);
    assert.equal(comparePath([...polygon, polygon[0]], polygon, {closed: true}).match, false);
    assert.equal(comparePath([[0, 0], [1, 0]], [[1, 0], [0, 0]]).match, true);
});

test('Berford retries advance the sequence and keep the requested recipe unchanged', () => {
    const fixture = cases.find(f => f.name === 'Berford'), r = parseMfcgReference(fixture.url);
    const t = generateStructure({seed: r.seed, size: r.size, ...r.flags, ...r.optional});
    assert.ok(t.attempts.length > 0);
    assert.equal(t.attempts[0].stage, 'river');
    assert.equal(t.options.seed, r.seed);
    assert.notEqual(t.attemptStart.state, Number(r.seed));
});

test('structural generation is deterministic for an arbitrary seed outside the reference fixtures', () => {
    const recipe = {
        seed: '720156492783',
        size: 37,
        coast: true,
        sea: .73,
        river: false,
        citadel: true,
        urban_castle: true,
        plaza: false,
        gates: 4
    };
    const first = structureGeometry(generateStructure(recipe)), second = structureGeometry(generateStructure(recipe));
    assert.deepEqual(first, second);
    assert.equal(first.recipe.size, 37);
    assert.equal(first.recipe.seed, recipe.seed);
    assert.equal(first.walls.length, 2);
    assert.equal(first.rivers.length, 0);
    assert.ok(first.cells.length > 37);
});

test('mesh splitting maintains reciprocal twins, shared points and the sequence of new cell seeds', () => {
    const a = [0, 0], b = [4, 0], c = [4, 4], d = [0, 4], e = [8, 0], f = [8, 4];
    const left = {id: 0, polygon: [a, b, c, d]}, right = {id: 1, polygon: [b, e, f, c]}, mesh = new Mesh([left, right]);
    const shared = mesh.edgeBetween(b, c), inserted = mesh.splitEdge(shared), sequence = new Sequence(7);
    assert.deepEqual(inserted.point, [4, 2]);
    const parts = mesh.splitCell(left, a, c, sequence);
    assert.equal(sequence.draws, 2);
    assert.equal(mesh.edgeBetween(a, c).cell, parts[0]);
    assert.equal(mesh.edgeBetween(c, a).cell, parts[1]);
    assert.equal(parts[0].seed, 337897);
    assert.equal(parts[1].seed, sequence.state);
    assert.equal(mesh.cells.length, 3);
    for (const edge of mesh.edges) {
        assert.ok(edge.cell.polygon.includes(edge.point));
        if (edge.twin) {
            assert.equal(edge.twin.twin, edge);
            assert.equal(edge.point, edge.twin.next.point);
        }
    }
    assert.equal(mesh.boundary(mesh.cells).length, 6);
});

test('mesh optimization keeps all faces closed and every surviving interior twin reciprocal', () => {
    const t = generateStructure({
        seed: '1931200012',
        size: 25,
        coast: false,
        walls: false,
        citadel: false,
        plaza: true,
        river: false
    });
    optimizeMesh(t.mesh);
    for (const cell of t.mesh.cells) {
        const edges = t.mesh.cycle(cell);
        assert.equal(edges.length, cell.polygon.length);
        assert.ok(edges.length >= 4);
        assert.ok(new Set(edges.map(e => e.point)).size === edges.length);
        for (const edge of edges) if (edge.twin) {
            assert.equal(edge.twin.twin, edge);
            assert.equal(edge.twin.next.point, edge.point);
        }
    }
});

test('triangulation gives reciprocal halfedges and satisfies the empty circumcircle property', () => {
    const points = Array.from({length: 31}, (_, i) => [Math.cos(i * 2.399) * (10 + i), Math.sin(i * 2.399) * (10 + i)]);
    const result = new Triangulation(points), {triangles, halfedges} = result;
    for (let edge = 0; edge < halfedges.length; edge++) if (halfedges[edge] >= 0) assert.equal(halfedges[halfedges[edge]], edge);
    for (let triangle = 0; triangle < triangles.length; triangle += 3) {
        const indices = [triangles[triangle], triangles[triangle + 1], triangles[triangle + 2]];
        for (let i = 0; i < points.length; i++) if (!indices.includes(i)) {
            const [a, b, c] = indices.map(index => [points[index][0] - points[i][0], points[index][1] - points[i][1]]);
            const det = (a[0] * a[0] + a[1] * a[1]) * (b[0] * c[1] - b[1] * c[0]) - (b[0] * b[0] + b[1] * b[1]) * (a[0] * c[1] - a[1] * c[0]) + (c[0] * c[0] + c[1] * c[1]) * (a[0] * b[1] - a[1] * b[0]);
            const orientation = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            assert.ok(det * Math.sign(orientation) <= 1e-7);
        }
    }
});

test('triangulation skips an initially collinear third candidate and uses a finite seed circle', () => {
    const points = [[0, 0], [1, 0], [-1, 0], [0, 2], [0, -2], [3, 3], [-3, -3]],
        triangulation = new Triangulation(points);
    assert.ok(triangulation.triangles.length > 0);
    assert.ok(triangulation.seed.center.every(Number.isFinite));
    for (let edge = 0; edge < triangulation.halfedges.length; edge++) {
        const twin = triangulation.halfedges[edge];
        if (twin >= 0) assert.equal(triangulation.halfedges[twin], edge);
    }
});

test('structural options reject unsupported values instead of coercing to preset sizes', () => {
    for (const options of [{size: '61'}, {size: 0}, {size: 201}, {seed: '0'}, {seed: '9007199254740992'}, {sea: Infinity}, {gates: -2}, {coast: '1'}]) {
        assert.throws(() => generateStructure({seed: '1234', size: 25, coast: false, ...options}));
    }
});
