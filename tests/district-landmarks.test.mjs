import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cityFromGeometry,
    generateCity,
    normalizeOptions,
    recipeFromOptions
} from '../src/generation/interactive-city.js';
import {buildDistrictLandmarks, landmarkLimit} from '../src/districts/district-landmarks.js';
import {generateCity as generateModel} from '../src/compatible/city.js';
import {structureGeometry} from '../src/compatible/structure.js';
import {buildDistrictRegions} from '../src/districts/district-regions.js';
import {area, centroid, inside, segmentDistance} from '../src/core/geometry.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {
    generationHash,
    mfcgReferenceUrl,
    readGenerationLocation,
    syncLandmarkControls,
    writeGenerationForm
} from '../src/generation/generation-settings.js';
import {districtNameContexts} from '../src/generation/toponyms.js';
import {parseMfcgReference} from '../src/io/mfcg-reference.js';
import {renderMap} from '../src/rendering/render.js';

const within = (p, polygon) => inside(p, polygon) || polygon.some((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]) < 1e-6);
const base = {seed: '865334241', size: 37, river: true, coast: true, shantytown: true};
const city = generateCity({...base, marketCount: 4, templeCount: 4});

test('a native church uses the available parcel as its ground instead of copying a building silhouette', () => {
    const geometry = city.generatedGeometry;
    for (const site of geometry.experimental.districtLandmarks.sites.filter(s => s.kind === 'temple' && s.native)) {
        const cell = geometry.cells.find(c => c.id === site.cell),
            source = geometry.experimental.specialBuildings.find(b => b.kind === 'temple' && b.cell === site.cell);
        assert.ok(area(site.polygon) > area(source.polygon));
        assert.ok(site.polygon.every(p => within(p, cell.polygon)));
        assert.ok([...site.building, ...site.tower].every(p => within(p, site.polygon)));
        assert.deepEqual(site.housing, []);
    }
});

test('counts change only the overlay, without changing any compatible layer or random checkpoint', () => {
    const one = generateCity({...base, marketCount: 1, templeCount: 1});
    const source = structuredClone(city.generatedGeometry), other = structuredClone(one.generatedGeometry);
    delete source.experimental.districtLandmarks;
    delete other.experimental.districtLandmarks;
    delete source.experimental.customObjects;
    delete other.experimental.customObjects;
    assert.deepEqual(source, other);
    const {options} = normalizeOptions(base), model = generateModel(recipeFromOptions(options), {forests: true});
    const geometry = structureGeometry(model);
    geometry.experimental.districtRegions = buildDistrictRegions(model);
    const before = structuredClone(geometry), modelBefore = structureGeometry(model);
    assert.deepEqual(buildDistrictLandmarks(model, geometry, city.options), city.generatedGeometry.experimental.districtLandmarks);
    assert.deepEqual(geometry, before);
    assert.deepEqual(structureGeometry(model), modelBefore);
    assert.equal(city.markets.length, 4);
    assert.equal(city.special.filter(b => b.kind === 'temple').length, 4);
});

test('each additional landmark replaces all houses in exactly one distinct block and stays inside its district', () => {
    const e = city.generatedGeometry.experimental, sites = e.districtLandmarks.sites,
        additional = sites.filter(s => !s.native);
    assert.equal(additional.length, 6);
    assert.equal(new Set(additional.map(s => s.block)).size, additional.length);
    const removed = additional.flatMap(s => s.housing);
    assert.equal(new Set(removed).size, removed.length);
    const withoutSites = structuredClone(city.generatedGeometry);
    withoutSites.experimental.districtLandmarks.sites = [];
    const available = new Set(cityFromGeometry(withoutSites, city.options).buildings.map(b => JSON.stringify(b.polygon)));
    const expected = e.housing.filter((p, i) => !removed.includes(i) && available.has(JSON.stringify(p.map(([x, y]) => [x, -y]))));
    assert.equal(city.buildings.length, expected.length);
    for (const site of sites) {
        const district = e.districtRegions.find(d => String(d.id) === site.district);
        assert.ok(district);
        assert.ok(within(centroid(site.polygon), district.polygon));
        for (const poly of [...(site.stalls || []), ...(site.building ? [site.building, site.tower] : [])]) for (const p of poly) assert.ok(within(p, site.polygon));
        for (const i of site.housing) assert.ok(within(centroid(e.housing[i]), site.polygon));
        const displayed = site.polygon.map(([x, y]) => [x, -y]);
        assert.ok(!city.buildings.some(b => inside(centroid(b.polygon), displayed)));
        assert.ok(!city.trees.some(t => inside(t.point, displayed)));
        assert.ok(area(site.polygon) > 0);
    }
    assert.deepEqual(city.buildings.map(b => b.polygon), expected.map(p => p.map(([x, y]) => [x, -y])));
});

test('zero and native feature flags remove landmarks and their naming contexts', () => {
    for (const input of [{marketCount: 0, templeCount: 0}, {
        plaza: false,
        temple: false,
        marketCount: 4,
        templeCount: 4
    }]) {
        const empty = generateCity({...base, ...input});
        assert.equal(empty.markets.length, 0);
        assert.equal(empty.temple, null);
        assert.ok(empty.districts.every(d => d.features.length === 0));
        assert.ok(districtNameContexts(empty.generatedGeometry).every(d => !['market', 'temple', 'market-temple'].includes(d.kind)));
        const withoutSites = structuredClone(empty.generatedGeometry);
        delete withoutSites.experimental.districtLandmarks;
        assert.deepEqual(empty.buildings, cityFromGeometry(withoutSites, empty.options).buildings);
    }
});

test('local presence controls names, including districts containing both a market and a temple', () => {
    for (const context of districtNameContexts(city.generatedGeometry)) {
        const d = city.districts.find(d => d.id === context.id);
        if (context.kind === 'market') assert.match(d.name, /купеч|купцов|торгов|торжище|рыноч|базар|ярмар|гостин|коробейник/i);
        if (context.kind === 'temple') assert.match(d.name, /кое(?: подворье .+)?$/);
        if (context.kind === 'market-temple') assert.match(d.name, /кое торжище(?: .+)?$/);
    }
    assert.equal(new Set(city.districts.map(d => d.name)).size, city.districts.length);
    const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const geometry = {
        water: [],
        rivers: [],
        riverWidths: [],
        experimental: {
            districts: [{id: 1, type: 'regular', polygon: square}],
            specialBuildings: [],
            districtLandmarks: {sites: [{kind: 'market', district: '1'}, {kind: 'temple', district: '1'}]}
        }
    };
    assert.equal(districtNameContexts(geometry)[0].kind, 'market-temple');
});

test('limits and form controls clamp counts when size shrinks and disable them with native flags', () => {
    for (const [size, max] of [[6, 1], [34, 4], [61, 7], [200, 20]]) {
        assert.equal(landmarkLimit(size), max);
        assert.equal(normalizeOptions({size, marketCount: 99}).options.marketCount, max);
    }
    for (const value of [-1, 1.5, 'bad']) assert.throws(() => normalizeOptions({marketCount: value}), /Количество/);
    const fields = new Map(Object.keys(city.options).map(key => [key, {}])),
        form = {elements: {namedItem: key => fields.get(key)}};
    writeGenerationForm(form, city.options);
    fields.get('size').value = '6';
    fields.get('temple').checked = false;
    assert.equal(syncLandmarkControls(form), 1);
    assert.equal(fields.get('marketCount').max, '1');
    assert.equal(fields.get('marketCount').value, '1');
    assert.equal(fields.get('templeCount').disabled, true);
});

test('project and shared URL restore quantities, exact placements and manually edited names', () => {
    const renamed = cityFromGeometry(city.generatedGeometry, city.options);
    renamed.districts[0].name = 'Ручное имя';
    const restored = parseProject(serializeProject(renamed, {})).city;
    for (const key of ['generatedGeometry', 'buildings', 'special', 'markets', 'districts', 'options']) assert.deepEqual(restored[key], renamed[key], key);
    const linked = generateCity(readGenerationLocation(new URL(`http://localhost/${generationHash(city)}`)).options);
    assert.deepEqual(linked.generatedGeometry, city.generatedGeometry);
    const ref = parseMfcgReference(mfcgReferenceUrl(city));
    assert.deepEqual(ref.unrecognized, {});
    assert.ok(!Object.hasOwn(recipeFromOptions(city.options), 'marketCount'));
});

test('SVG exports include every market and temple and respect independent layer visibility', () => {
    const svg = renderMap(city, {layers: {market: false, temple: false}});
    assert.equal((svg.match(/data-landmark="market"/g) || []).length, 4);
    assert.equal((svg.match(/data-landmark="temple"/g) || []).length, 4);
    for (const id of ['market', 'temple']) assert.match(svg, new RegExp(`id="layer-${id}"[^>]*display:none`));
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
});
