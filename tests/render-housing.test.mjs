import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHousing} from '../src/rendering/render-compatible.js';
import {THEMES} from '../src/rendering/render.js';

test('housing batches retain every footprint, paint and roof without changing model geometry', () => {
    const buildings = Array.from({length: 1300}, (_, i) => ({
        polygon: [[i * 10, 0], [i * 10 + 6, 0], [i * 10 + 6, 4], [i * 10, 4]],
        wealth: i % 2 ? 'rich' : 'poor', fill: i % 2 ? '#abc' : '#def'
    }));
    const original = JSON.stringify(buildings);
    for (const roofs of [false, true]) {
        const svg = renderHousing(buildings, b => b, {roofs}, THEMES.atlas);
        const bodies = [...svg.matchAll(/<path d="([^"]+)"\/>/g)].map(match => match[1]);
        assert.equal(bodies.reduce((n, path) => n + (path.match(/Z/g) || []).length, 0), buildings.length);
        assert.ok(bodies.every(path => (path.match(/Z/g) || []).length <= 256));
        for (const building of buildings) {
            const path = `M${building.polygon.map(p => p.join(',')).join('L')}Z`;
            const group = [...svg.matchAll(/<g\b[^>]*>(.*?)<\/g>/g)].find(match => match[1].includes(path))?.[0];
            assert.ok(group, path);
            assert.ok(group.includes(`data-building-wealth="${building.wealth}"`));
            assert.ok(group.includes(`fill="${building.fill}"`));
        }
        const roofPaths = [...svg.matchAll(/<path d="([^"]+)" fill="none"/g)];
        assert.equal(roofPaths.reduce((n, match) => n + (match[1].match(/M/g) || []).length, 0), roofs ? buildings.length : 0);
        assert.ok((svg.match(/<g /g) || []).length < 10);
    }
    assert.equal(JSON.stringify(buildings), original);
});
