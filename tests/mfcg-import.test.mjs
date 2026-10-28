import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {
    exportMfcgGeoJson,
    geometryFingerprint,
    importMfcgGeoJson,
    validateMfcgGeoJson
} from '../src/io/mfcg-geojson.js';
import {parseProject, serializeProject} from '../src/generation/generator.js';
import {renderMap} from '../src/rendering/render.js';

for (const name of ['palwe', 'mugyoma', 'goldbrook', 'mpiyanga', 'woma', 'frampton', 'berford', 'hrošev']) {
    test(`${name}: original coordinates and all source layers survive import and project round trip`, async () => {
        const source = JSON.parse(await readFile(new URL(`./fixtures/mfcg/${name}.json`, import.meta.url), 'utf8'));
        const city = importMfcgGeoJson(source, {name});
        assert.deepEqual(city.source.geojson, source);
        assert.deepEqual(exportMfcgGeoJson(city), source);
        const buildings = source.features.find(f => f.id === 'buildings');
        assert.equal(city.buildings.length, buildings.coordinates.length);
        for (let i = 0; i < city.buildings.length; i++) assert.deepEqual(city.buildings[i].rings, buildings.coordinates[i].map(r => r.map(p => [p[0], -p[1]])));
        const {city: restored} = parseProject(serializeProject(city, {theme: 'ink', layers: {fields: false}}));
        assert.equal(geometryFingerprint(restored), geometryFingerprint(city));
        assert.equal(createHash('sha256').update(JSON.stringify(restored.source.geojson)).digest('hex'), createHash('sha256').update(JSON.stringify(source)).digest('hex'));
        const svg = renderMap(city, {layers: {fields: false}});
        assert.match(svg, /id="layer-fields"[^>]*display:none/);
        for (const id of ['terrain', 'sea', 'river', 'fields', 'districts', 'greens', 'streets', 'buildings', 'market', 'castle', 'port', 'walls', 'forest', 'labels']) assert.ok(svg.includes(`id="layer-${id}"`), id);
        assert.ok(!svg.includes('NaN'));
        assert.ok(!svg.includes('Infinity'));
    });
}

const synthetic = {
    type: 'FeatureCollection', features: [
        {type: 'Feature', id: 'values', generator: 'mfcg', version: 'test', roadWidth: 8},
        {
            type: 'MultiPolygon',
            id: 'buildings',
            coordinates: [[[[0, 0], [20.1234567, 0], [20, 10], [10, 10], [10, 20], [0, 20]], [[2, 2], [5, 2], [5, 5], [2, 5]]]]
        },
        {
            type: 'GeometryCollection',
            id: 'districts',
            geometries: [{
                type: 'Polygon',
                name: '<script>alert(1)</script>',
                coordinates: [[[0, 0], [30, 0], [30, 30], [0, 30]]]
            }]
        }
    ]
};
test('generic non-fixture import retains holes, concavity, precision and escaped names', () => {
    const city = importMfcgGeoJson(synthetic, {name: '<img onerror="bad">'}), svg = renderMap(city, {theme: 'ink'});
    assert.equal(city.buildings[0].rings.length, 2);
    assert.equal(city.buildings[0].polygon.length, 6);
    assert.ok(svg.includes('20.1234567'));
    assert.ok(svg.includes('fill-rule="evenodd"'));
    assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('<img '));
    assert.ok(svg.includes('&lt;script&gt;'));
});
test('import rejects invalid source shapes and nonfinite or nonnumeric coordinates', () => {
    for (const value of [null, {}, {
        type: 'FeatureCollection',
        features: []
    }]) assert.throws(() => validateMfcgGeoJson(value));
    for (const coordinate of [NaN, Infinity, '3', null, 1e12]) {
        const value = structuredClone(synthetic);
        value.features[1].coordinates[0][0][0][0] = coordinate;
        assert.throws(() => importMfcgGeoJson(value));
    }
    const invalid = structuredClone(synthetic);
    invalid.features.push({
        id: 'roads',
        type: 'GeometryCollection',
        geometries: [{type: 'Point', coordinates: [0, 0]}]
    });
    assert.throws(() => importMfcgGeoJson(invalid));
});
test('raw GeoJSON opens through the same project loader as saved projects', () => {
    const result = parseProject(JSON.stringify(synthetic), {name: 'Any future city.json'});
    assert.equal(result.city.name, 'Any future city');
    assert.equal(result.city.source.format, 'mfcg');
    assert.equal(result.city.options.seed, null);
    assert.equal(result.city.statistics.bridges, null);
});
test('renaming a district changes only its native name when re-exported', () => {
    const city = importMfcgGeoJson(synthetic);
    city.districts[0].name = 'Новое имя';
    const result = exportMfcgGeoJson(city), expected = structuredClone(synthetic);
    expected.features.find(f => f.id === 'districts').geometries[0].name = 'Новое имя';
    assert.deepEqual(result, expected);
    assert.deepEqual(city.source.geojson, synthetic);
});
test('long original district names remain unchanged after a project round trip', () => {
    const source = structuredClone(synthetic);
    source.features[2].geometries[0].name = 'A'.repeat(240);
    const restored = parseProject(serializeProject(importMfcgGeoJson(source))).city;
    assert.deepEqual(exportMfcgGeoJson(restored), source);
});
