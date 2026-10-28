import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStreets} from '../src/roads/street-groups.js';
import {renderStreetSelection} from '../src/rendering/render-street-selection.js';

test('a straighter side branch does not join an existing bend or its selection', () => {
    for (const reverse of [false, true]) {
        const streets = [
            {id: 'main', points: [[0, 0], [10, 0], [15, 10]]},
            {id: 'branch', points: [[10, 0], [20, 0]]},
            {id: 'continuation', points: [[15, 10], [20, 20]]}
        ];
        if (reverse) streets.forEach(road => road.points.reverse());
        const geometry = streets.map(road => structuredClone(road.points));
        groupStreets(streets);
        assert.notEqual(streets[0].streetId, streets[1].streetId);
        assert.equal(streets[0].streetId, streets[2].streetId);
        const overlay = renderStreetSelection({streets}, {accent: 'red'}, 'main', String);
        const selection = overlay.slice(overlay.indexOf('<g id="street-selection"'));
        assert.equal((selection.match(/<path /g) || []).length, 2);
        assert.ok(!selection.includes('M10,0 L20,0'));
        assert.deepEqual(streets.map(road => road.points), geometry);
    }
});

test('split pieces with one route id also keep a side branch independent', () => {
    const streets = [
        {id: 'main', points: [[0, 0], [10, 0]]},
        {id: 'main', points: [[10, 0], [15, 10]]},
        {id: 'branch', points: [[10, 0], [20, 0]]}
    ];
    groupStreets(streets);
    assert.equal(streets[0].streetId, streets[1].streetId);
    assert.notEqual(streets[0].streetId, streets[2].streetId);
});
