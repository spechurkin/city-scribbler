import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_TYPES, enterEditor} from '../src/editor/building-editor.js';
import {buildingLegendSymbol, renderMapLegend} from '../src/map/map-legend.js';
import {DEFAULT_VIEW, normalizeView, THEMES} from '../src/rendering/render.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';

test('legend names and illustrates every building type exactly once', () => {
    const html = renderMapLegend();
    for (const [kind, rule] of Object.entries(BUILDING_TYPES)) {
        assert.equal(html.split(`data-legend-kind="${kind}"`).length - 1, 1, kind);
        assert.ok(html.includes(`<span>${rule.label}</span>`), kind);
        const row = html.match(new RegExp(`<li data-legend-kind="${kind}">([\\s\\S]*?)</li>`))[1];
        assert.match(row, /<svg[^>]*>[\s\S]*<(path|polygon)/, kind);
    }
    for (const kind of ['sea', 'river', 'street', 'bridge', 'port', 'wall', 'tower', 'gate', 'square', 'fountain', 'fields', 'greens', 'forest', 'conifer']) {
        assert.ok(html.includes(`data-legend-kind="${kind}"`), kind);
    }
    assert.doesNotMatch(html, /NaN|undefined|data-building="|tabindex=/);
});

test('legend symbols use the map architecture and follow theme and roof settings', () => {
    for (const theme of Object.values(THEMES)) {
        const view = {roofs: true, layers: {}};
        const tavern = buildingLegendSymbol('tavern', view, theme);
        assert.match(tavern, /data-building-architecture="tavern"/);
        assert.ok(tavern.includes(theme.roofLine));
        assert.notEqual(tavern, buildingLegendSymbol('tavern', {...view, roofs: false}, theme));
        assert.notEqual(tavern, buildingLegendSymbol('inn', view, theme));
        assert.match(buildingLegendSymbol('windmill', view, theme), /data-building-part="sail_/);
    }
    assert.notEqual(renderMapLegend({theme: 'atlas'}), renderMapLegend({theme: 'ink'}));
});

test('legend remains a complete key when map layers are hidden', () => {
    assert.equal(renderMapLegend({layers: {fields: false, buildings: false}}), renderMapLegend());
    assert.equal(DEFAULT_VIEW.legend, true);
    assert.equal(normalizeView({}).legend, true);
    assert.equal(normalizeView({legend: false}).legend, false);
});

test('legend visibility survives saving generated and edited projects', () => {
    const city = generateCity({seed: '1931200012', size: 6});
    for (const current of [city, enterEditor(city)]) for (const legend of [true, false]) {
        const view = normalizeView({legend});
        assert.equal(normalizeView(parseProject(serializeProject(current, view)).view).legend, legend);
    }
});
