import test from 'node:test';
import assert from 'node:assert/strict';
import {fitsFootprint, footprintFrame} from '../src/buildings/footprint-size.js';
import {cityFromGeometry, generateCity} from '../src/generation/interactive-city.js';
import {rectangle} from '../src/core/geometry.js';

test('minimum footprints check usable width and depth, including rotated and thin plots', () => {
    for (const angle of [0, .7, 2.4]) {
        for (const [kind, width, depth] of [['house', 8, 4], ['farmhouse', 8, 6], ['castle', 24, 16], ['temple', 32, 24], ['market', 36, 24]]) {
            assert.equal(fitsFootprint(rectangle([120, -75], width, depth, angle), kind), true, kind);
            assert.equal(fitsFootprint(rectangle([120, -75], width, depth * .4, angle), kind), false, kind);
        }
        assert.equal(fitsFootprint(rectangle([0, 0], 1000, 2, angle), 'market'), false, 'area alone must not admit a sliver');
    }
});

test('tiny houses and special buildings are excluded without enlarging them across their plot boundaries', () => {
    const city = generateCity({
        seed: '42',
        size: 6,
        river: false,
        coast: false,
        citadel: false,
        plaza: false,
        temple: false
    });
    const g = structuredClone(city.generatedGeometry);
    g.experimental.housing = [rectangle([0, 0], 2, 2), rectangle([20, 0], 100, .5), rectangle([40, 0], 12, 8)];
    g.experimental.specialBuildings = [{kind: 'farmhouse', polygon: rectangle([0, 20], 1, 1)}, {
        kind: 'farmhouse',
        polygon: rectangle([40, 20], 12, 8)
    }];
    const original = structuredClone(g), displayed = cityFromGeometry(g, city.options);
    assert.equal(displayed.buildings.length, 1);
    assert.deepEqual(displayed.buildings[0].polygon, g.experimental.housing[2].map(([x, y]) => [x, -y]));
    assert.equal(displayed.special.length, 1);
    assert.deepEqual(g, original);
});

test('reported tiny market is relocated to a usable plot and the requested landmark counts remain present', () => {
    const city = generateCity({
        seed: '2867488715',
        size: 34,
        coast: false,
        riverWidthScale: 3,
        riverCurvature: 1.09,
        greens: true,
        shantytown: true,
        marketCount: 2,
        templeCount: 4
    });
    const sites = city.generatedGeometry.experimental.districtLandmarks.sites;
    assert.equal(sites.filter(s => s.kind === 'market').length, 2);
    assert.equal(sites.filter(s => s.kind === 'temple').length, 4);
    for (const site of sites) {
        const {width, height} = footprintFrame(site.polygon);
        assert.ok(width >= (site.kind === 'market' ? 36 : 32) - 1e-7);
        assert.ok(height >= 24 - 1e-7);
    }
});
