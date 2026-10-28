import test from 'node:test';
import assert from 'node:assert/strict';
import {azgaarCityLink, parseAzgaarWorld} from '../scripts/lib/azgaar-world.mjs';

function world() {
    return {
        seed: '724813059',
        options: {units: {population: {scale: 1000, urbanization: {rate: 1, density: 10}}}},
        cells: [{i: 0, p: [0, 0], haven: 0, r: 0, biome: 7, routes: {}}],
        routes: []
    };
}

const burg = (overrides = {}) => ({
    i: 27,
    cell: 0,
    name: 'Test town',
    population: 20,
    port: 0,
    citadel: 0,
    plaza: 0,
    walls: 0,
    shanty: 0,
    temple: 0, ...overrides
});
const params = (w, b) => new URL(azgaarCityLink(w, b).url).searchParams;

test('saved city links retain their original seed and settings when world population or features change', () => {
    const w = world(), link = 'https://watabou.github.io/city-generator/?seed=1947&size=53&plaza=1&future=keep';
    assert.deepEqual(azgaarCityLink(w, burg({link, population: 999, citadel: 1})), {
        url: link,
        origin: 'stored-link',
        uncertainties: []
    });
});

test('world seed concatenation pads burg identifiers without arithmetic addition or truncation', () => {
    const w = world();
    assert.equal(params(w, burg()).get('seed'), '7248130590027');
    assert.equal(params(w, burg({i: 12037})).get('seed'), '72481305912037');
    assert.equal(params(w, burg({MFCG: '81062951'})).get('seed'), '81062951');
});

test('population display and settlement size use separate urbanization rate and density settings', () => {
    const w = world(), p = params(w, burg());
    assert.equal(p.get('population'), '20000');
    w.options.units.population.urbanization.rate = 2;
    assert.equal(params(w, burg()).get('population'), '40000');
    assert.equal(params(w, burg()).get('size'), p.get('size'));
    w.options.units.population.urbanization.density = 20;
    assert.ok(Number(params(w, burg()).get('size')) < Number(p.get('size')));
    assert.equal(params(w, burg({population: 0})).get('size'), '6');
    assert.equal(params(w, burg({population: 1e9})).get('size'), '100');
});

test('coast angles follow all four compass directions while an inland river port stays inland', () => {
    const w = world();
    w.cells.push({i: 1, p: [1, 0]});
    w.cells[0].haven = 1;
    const directions = [[[1, 0], null], [[0, -1], '0.5'], [[-1, 0], '1'], [[0, 1], '1.5']];
    for (const [point, sea] of directions) {
        w.cells[1].p = point;
        const p = params(w, burg({port: 1}));
        assert.equal(p.get('sea'), sea);
        assert.equal(p.get('coast'), '1');
    }
    w.cells[0].haven = 0;
    w.cells[0].r = 3;
    const p = params(w, burg({port: 1}));
    assert.equal(p.get('coast'), '0');
    assert.equal(p.get('river'), '1');
    assert.equal(p.get('sea'), null);
});

test('crossroads distinguish roads and ferries and retain route identifier zero', () => {
    const w = world();
    w.cells[0].routes = {1: 0, 2: 1, 3: 2};
    w.routes = [{i: 0, group: 'roads'}, {i: 1, group: 'roads'}, {i: 2, group: 'roads'}];
    assert.equal(params(w, burg()).get('hub'), '1');
    w.routes = w.routes.map(r => ({...r, group: 'searoutes'}));
    assert.equal(params(w, burg()).get('hub'), '0');
    w.cells[0].routes[4] = 2;
    assert.equal(params(w, burg()).get('hub'), '1');
});

test('the calculated Frampton recipe equals the URL read from the live Azgaar preview', () => {
    const w = world();
    w.seed = '110906030';
    w.cells[0].biome = 12;
    const input = burg({i: 112, name: 'Frampton', population: 30.047});
    const actual = azgaarCityLink(w, input);
    assert.equal(actual.url, 'https://watabou.github.io/city-generator/?name=Frampton&population=30047&size=47&seed=1109060300112&river=0&coast=0&farms=0&citadel=0&urban_castle=0&hub=0&plaza=0&greens=0&temple=0&walls=0&shantytown=0&style=natural');
    assert.deepEqual(actual.uncertainties, []);
});

function mapText() {
    const w = world(), sections = Array(54).fill('');
    sections[0] = `1.156.0|File can be loaded in azgaar.github.io/Fantasy-Map-Generator|2026-10-25|${w.seed}|20|20|0`;
    sections[1] = JSON.stringify({
        ...w.options,
        seed: w.seed,
        graph: {sampling: 'square', jitter: .9},
        lore: {name: 'Synthetic world'}
    });
    sections[5] = '<svg>\n<script>throw new Error("Do not execute map SVG")</script>\n</svg>';
    sections[6] = JSON.stringify({
        spacing: 10,
        points: [[0, 0], [10, 0], [0, 10], [10, 10]],
        boundary: [[-20, -20], [30, -20], [30, 30], [-20, 30]],
        features: [0, {type: 'island'}]
    });
    sections[7] = '40,40,40,40';
    sections[9] = '1,1,1,1';
    sections[10] = '0,0,0,0';
    sections[15] = JSON.stringify([0, burg({i: 1})]);
    sections[16] = '7,7,7,7';
    sections[22] = '0,0,0,0';
    sections[36] = '{}';
    sections[37] = '[]';
    return sections;
}

test('map section parsing preserves embedded SVG newlines and rebuilds graph data without executing SVG', () => {
    const parsed = parseAzgaarWorld(mapText().join('\r\n'));
    assert.equal(parsed.cells.length, 4);
    assert.equal(parsed.name, 'Synthetic world');
    assert.equal(parsed.legacy, false);
    assert.ok(parsed.cells.every(c => c.h === 40 && c.haven === 0));
    assert.equal(params(parsed, parsed.burgs[1]).get('seed'), '7248130590001');
});

test('legacy population units are read from their saved positions and missing burg flags remain explicit', () => {
    const sections = mapText(), legacy = Array(27).fill('');
    legacy[12] = '3220';
    legacy[13] = '1.1';
    legacy[24] = '10';
    legacy[20] = 'Legacy world';
    sections[1] = legacy.join('|');
    sections[15] = JSON.stringify([0, {i: 1, cell: 0, name: 'Old city', population: 10, port: 0}]);
    const parsed = parseAzgaarWorld(sections.join('\r\n'));
    assert.equal(parsed.legacy, true);
    assert.equal(params(parsed, parsed.burgs[1]).get('population'), '35420');
    assert.deepEqual(azgaarCityLink(parsed, parsed.burgs[1]).uncertainties, ['missing-citadel', 'missing-plaza', 'missing-temple', 'missing-walls', 'missing-shanty']);
});

test('a world whose restored point count disagrees with saved cell data is rejected', () => {
    const sections = mapText();
    sections[16] = '7,7,7';
    assert.throws(() => parseAzgaarWorld(sections.join('\r\n')), /Восстановлено 4 ячеек вместо 3/);
    assert.throws(() => parseAzgaarWorld('not a map'), /Ожидается/);
});
