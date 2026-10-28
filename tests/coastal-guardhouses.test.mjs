import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity} from '../src/generation/interactive-city.js';
import {buildingsOverlap, containsFootprint} from '../src/editor/building-editor.js';
import {footprints, hitsRoad} from '../src/buildings/building-spatial.js';
import {dryFootprint} from '../src/roads/bridge-network.js';
import {connectedCellSets} from '../src/compatible/junctions.js';

for (const size of [34, 100]) test(`coastal city ${size} keeps every mandatory guardhouse on dry mainland`, () => {
    const city = generateCity({
        seed: '1931200012', size, citadel: true, urban_castle: true, plaza: true, temple: true,
        marketCount: 10, templeCount: 10, walls: true, shantytown: true, river: true,
        coast: true, greens: true, hub: true, gates: -1, sea: 0,
        tavernCount: 16, innCount: 5, hotelCount: 3, restaurantCount: 3, cafeCount: 4,
        korchmaCount: 6, barracksCount: 4, parish_schoolCount: 6, schoolCount: 6,
        lyceumCount: 7, gymnasiumCount: 5, collegeCount: 2, universityCount: 1,
        magic_towerCount: 3, smithyCount: 7, workshopCount: 7, warehouseCount: 13,
        guildhallCount: 6, bathhouseCount: 6, hospitalCount: 10, chapelCount: 17,
        windmillCount: 6, farmhouseCount: 8, barnCount: 7, name: 'Усть-Боровск'
    });
    assert.equal(city.options.size, size);
    assert.equal(city.name, 'Усть-Боровск');
    const cells = city.generatedGeometry.cells;
    const vertices = new Map();
    const land = cells.filter(c => !c.water).map(c => ({
        polygon: c.polygon.map(p => {
            const key = p.join(',');
            if (!vertices.has(key)) vertices.set(key, p);
            return vertices.get(key);
        })
    }));
    assert.equal(connectedCellSets(land).length, 1);
    const guards = city.customObjects.filter(b => b.kind === 'guardhouse');
    const districts = city.districts.filter(d => d.kind !== 'park' && d.castleCell === undefined);
    assert.equal(guards.length, districts.length);
    for (const district of districts) {
        const members = guards.filter(b => b.district === district.id);
        assert.equal(members.length, 1, district.name);
        const guard = members[0];
        assert.ok(footprints(guard).every(p => containsFootprint(district, p)));
        assert.ok(footprints(guard).every(p => containsFootprint({polygon: city.terrain.earth}, p)));
        assert.ok(footprints(guard).every(p => dryFootprint(p, [...city.terrain.sea, ...city.terrain.ribbons])));
        assert.ok(footprints(guard).every(p => dryFootprint(p, city.gardens)));
        assert.ok(footprints(guard).every(p => dryFootprint(p, city.fields)));
        assert.ok(!city.streets.some(road => hitsRoad(guard, road)));
        assert.ok(!city.customObjects.some(b => b !== guard && buildingsOverlap(guard, b)));
    }
});
