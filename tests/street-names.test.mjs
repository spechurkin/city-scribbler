import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureStreetNames, renameStreet} from '../src/roads/street-names.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {generateCity as generateLegacy} from '../src/generation/generator.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';
import {renderMap, THEMES} from '../src/rendering/render.js';
import {renderStreetSelection} from '../src/rendering/render-street-selection.js';

test('street names are stable, unique per road id and shared by split pieces', () => {
    const city = {options: {seed: 'streets'}, streets: Array.from({length: 2000}, (_, i) => ({id: `road-${i}`}))};
    city.streets.push({id: 'road-0'});
    const copy = structuredClone(city);
    ensureStreetNames(city);
    ensureStreetNames(copy);
    assert.deepEqual(city, copy);
    assert.equal(new Set(city.streets.map(r => r.name)).size, 2000);
    assert.ok(city.streets.every(r => /^(?:Улица|\d+-я улица) \S+$/.test(r.name)));
    assert.ok(city.streets.some(r => r.name.startsWith('2-я улица ')));
    assert.ok(city.streets.some(r => r.name.startsWith('3-я улица ')));
    renameStreet(city, 'road-0', 'Улица мастеров');
    ensureStreetNames(city);
    assert.equal(city.streets[0].name, city.streets.at(-1).name);
    assert.equal(city.streets[0].name, 'Улица мастеров');
});

test('straight continuations share selection and renaming across junctions, but branches do not', () => {
    const road = (id, points) => ({id, points, width: 4});
    const city = {
        options: {seed: 'street-groups'}, streets: [
            road('lower', [[0, 20], [0, 10]]), road('upper', [[0, 10], [-1, 0]]),
            road('branch', [[0, 10], [15, 10]]), road('separate', [[50, 20], [50, 0]])
        ]
    };
    const points = city.streets.map(r => structuredClone(r.points));
    ensureStreetNames(city);
    assert.equal(city.streets[0].streetId, city.streets[1].streetId);
    assert.equal(city.streets[0].name, city.streets[1].name);
    assert.notEqual(city.streets[0].streetId, city.streets[2].streetId);
    assert.notEqual(city.streets[0].streetId, city.streets[3].streetId);
    renameStreet(city, 'upper', 'Улица Вязов');
    assert.equal(city.streets[0].name, 'Улица Вязов');
    assert.equal(city.streets[1].name, 'Улица Вязов');
    const overlay = renderStreetSelection(city, THEMES.atlas, 'upper', value => value);
    assert.equal((overlay.match(/data-street="lower"/g) || []).length, 2);
    assert.equal((overlay.match(/stroke-opacity=".65"/g) || []).length, 2);
    assert.deepEqual(city.streets.map(r => r.points), points);
});

test('a branch ending in the middle of a through road stays independent', () => {
    const city = {
        streets: [
            {id: 'main', points: [[0, 0], [0, 20]]},
            {id: 'branch', points: [[10, 10], [0, 10]]}
        ]
    };
    ensureStreetNames(city);
    assert.notEqual(city.streets[0].streetId, city.streets[1].streetId);
});

test('street selection, hidden layers, export and project round trips', () => {
    for (const generate of [generateCity, generateLegacy]) {
        const city = generate({seed: '1931200012', size: 16});
        ensureStreetNames(city);
        const id = String(city.streets[0].id);
        renameStreet(city, id, 'Улица <мастеров>');
        for (const theme of ['atlas', 'ink']) {
            const svg = renderMap(city, {theme}, {interactive: true, selectedStreet: id});
            assert.ok(svg.includes(`data-street="${id}"`));
            assert.ok(svg.includes('Улица &lt;мастеров&gt;'));
            assert.ok(svg.includes(`stroke="${THEMES[theme].accent}" stroke-opacity=".65"`));
        }
        assert.ok(!renderMap(city, {}, {}).includes('data-street='));
        assert.ok(!renderMap(city, {layers: {streets: false}}, {
            interactive: true,
            selectedStreet: id
        }).includes('data-street='));
        const restored = parseProject(serializeProject(city, {})).city;
        assert.equal(restored.streets.find(r => String(r.id) === id).name, 'Улица <мастеров>');
        assert.deepEqual(restored.streets.map(r => [r.id, r.streetId, r.name]), city.streets.map(r => [r.id, r.streetId, r.name]));
    }
});
