import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {labelBoxesOverlap, layoutDistrictLabels, renderDistrictLabels} from '../src/rendering/label-layout.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacyCity} from '../src/generation/generator.js';
import {importMfcgGeoJson} from '../src/io/mfcg-geojson.js';
import {inside} from '../src/core/geometry.js';
import {renderMap, THEMES} from '../src/rendering/render.js';

const box = {x: 0, y: 0, width: 600, height: 400};
const district = (id, name, x, y, width = 120, height = 100) => ({
    id,
    name,
    polygon: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
});
const options = {box, fontSize: 16, strokeWidth: 4};

function assertClear(labels, frame = box, obstacles = []) {
    for (const [index, label] of labels.entries()) {
        const rect = label.box;
        assert.ok(rect.x >= frame.x && rect.y >= frame.y && rect.x + rect.width <= frame.x + frame.width && rect.y + rect.height <= frame.y + frame.height, 'label leaves map');
        for (const other of [...labels.slice(index + 1).map(label => label.box), ...obstacles]) assert.equal(labelBoxesOverlap(rect, other), false, `${label.district.name} overlaps another label`);
    }
}

test('neighboring long names wrap or move without losing names, changing geometry or overlapping halos', () => {
    const districts = [district('a', 'Зелёный берег', 100, 100), district('b', 'Георгиевское торжище Рыбаков', 210, 100), district('c', 'Сторожевая крепость', 160, 20), district('d', 'Гостевая набережная', 280, 20)];
    const before = structuredClone(districts), labels = layoutDistrictLabels(districts, options);
    assert.equal(labels.length, districts.length);
    assert.ok(labels.some(label => label.lines.length > 1));
    for (const label of labels) assert.equal(label.lines.join(' '), label.district.name);
    assertClear(labels);
    assert.deepEqual(districts, before);
    assert.deepEqual(layoutDistrictLabels(districts, options), labels);
});

test('concave districts and holes use an interior anchor even if their centroid is outside', () => {
    const districts = [{
        id: 'concave',
        name: 'Старая слобода',
        polygon: [[30, 30], [240, 30], [240, 75], [75, 75], [75, 240], [30, 240]]
    }, {
        ...district('hole', 'Новая слобода', 300, 30, 240, 240),
        rings: [[[300, 30], [540, 30], [540, 270], [300, 270]], [[350, 80], [490, 80], [490, 220], [350, 220]]]
    }];
    const labels = layoutDistrictLabels(districts, options);
    assert.equal(labels.length, 2);
    assertClear(labels);
    for (const label of labels) {
        const center = [label.x, label.box.y + label.box.height / 2];
        assert.ok(inside(center, label.district.polygon));
        for (const hole of label.district.rings?.slice(1) || []) assert.equal(inside(center, hole), false);
    }
});

test('map edges, reserved title area and renaming are included in layout', () => {
    const districts = [district('a', 'Западный район', 0, 0), district('b', 'Восточный район', 480, 0)];
    const obstacles = [{x: 0, y: 0, width: 600, height: 32}];
    const first = layoutDistrictLabels(districts, {...options, obstacles});
    assert.equal(first.length, 2);
    assertClear(first, box, obstacles);
    districts[0].name = 'Очень длинное новое название слободы ремесленников';
    const renamed = layoutDistrictLabels(districts, {...options, obstacles});
    assert.equal(renamed.length, 2);
    assertClear(renamed, box, obstacles);
    assert.equal(renamed[0].lines.join(' '), districts[0].name);
});

test('a long unbroken name wraps without truncation and crowded labels never paint over each other', () => {
    const name = 'Ж'.repeat(80), districts = [district('a', name, 80, 80, 420, 220)];
    const labels = layoutDistrictLabels(districts, options);
    assert.equal(labels.length, 1);
    assert.equal(labels[0].lines.join(''), name);
    assertClear(labels);
    const crowded = Array.from({length: 20}, (_, id) => district(String(id), 'Слобода ремесленников', 240, 180, 20, 20));
    const placed = layoutDistrictLabels(crowded, options);
    assert.ok(placed.length > 0 && placed.length < crowded.length);
    assertClear(placed);
});

test('layout scales with the map instead of depending on absolute SVG coordinates', () => {
    const districts = [district('a', 'Слобода Рыбаков', 100, 100), district('b', 'Рудная слобода', 210, 100)];
    const labels = layoutDistrictLabels(districts, options), factor = 3;
    const scaled = districts.map(d => ({
        ...d,
        polygon: d.polygon.map(([x, y]) => [x * factor - 200, y * factor - 100])
    }));
    const frame = {x: -200, y: -100, width: 1800, height: 1200};
    const large = layoutDistrictLabels(scaled, {box: frame, fontSize: 48, strokeWidth: 12});
    assert.equal(large.length, labels.length);
    assertClear(large, frame);
    large.forEach((label, index) => {
        assert.deepEqual(label.lines, labels[index].lines);
        assert.ok(Math.abs(label.x - (labels[index].x * factor - 200)) < 1e-8);
        assert.ok(Math.abs(label.y - (labels[index].y * factor - 100)) < 1e-8);
    });
});

test('all renderers use collision placement, escaped full names and self-contained multiline SVG', async () => {
    const generated = generateCity({seed: '1931200012', size: 34});
    const native = JSON.parse(await readFile(new URL('fixtures/mfcg/palwe.json', import.meta.url)));
    const imported = importMfcgGeoJson(native);
    const legacy = generateLegacyCity({seed: 'labels'});
    for (const city of [generated, imported, legacy]) {
        city.districts[0].name = 'Название <&> "района"';
        for (const theme of ['atlas', 'ink', 'districts']) {
            const svg = renderMap(city, {theme}, {interactive: true});
            assert.match(svg, /data-label-district=/);
            assert.match(svg, /<tspan[^>]+textLength=/);
            assert.ok(svg.includes('Название &lt;&amp;&gt; &quot;района&quot;'));
            assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
        }
    }
    const text = renderDistrictLabels([district('id<&>', 'Имя <&>', 100, 100)], {...options, theme: THEMES.atlas});
    assert.ok(text.includes('data-label-district="id&lt;&amp;&gt;"'));
});

test('different generated seeds and native imports retain every district label without collisions', async () => {
    const cities = [...['1931200012', '865334241', '38760091', '9867431223'].map(seed => generateCity({
        seed,
        size: 43,
        river: true,
        coast: true
    }))];
    for (const name of ['palwe', 'mugyoma', 'goldbrook', 'mpiyanga', 'woma', 'frampton', 'berford', 'hrošev']) {
        cities.push(importMfcgGeoJson(JSON.parse(await readFile(new URL(`fixtures/mfcg/${name}.json`, import.meta.url)))));
    }
    for (const city of cities) {
        const frame = city.viewBox, k = frame.width / 1600;
        const labels = layoutDistrictLabels(city.districts, {box: frame, fontSize: 13 * k, strokeWidth: 3 * k});
        assert.equal(labels.length, city.districts.length, city.name);
        assertClear(labels, frame);
    }
});
