import test from 'node:test';
import assert from 'node:assert/strict';
import {
    additionalPorts,
    applyPort,
    bankSites,
    inhabitedBank,
    planPort,
    portContext,
    portCount
} from '../src/water/ports.js';
import {dryPieces} from '../src/roads/bridge-network.js';
import {distance, inside, lerp, segmentSegmentDistance} from '../src/core/geometry.js';
import {generateCity} from '../src/generation/interactive-city.js';
import {createEditorHistory, enterEditor} from '../src/editor/building-editor.js';
import {parseProject, serializeProject} from '../src/io/city-project.js';

const sea = [[0, -1000], [1000, -1000], [1000, 1000], [0, 1000]];
const context = {water: [sea], docks: [], bridges: [], walls: []};
const homes = (start, end) => Array.from({length: Math.ceil((end - start) / 20)}, (_, i) => ({
    kind: 'house',
    polygon: [[-35, start + i * 20], [-25, start + i * 20], [-25, start + i * 20 + 10], [-35, start + i * 20 + 10]]
}));

test('ports snap to exposed banks and keep their decks over water', () => {
    const plan = planPort(context, [-12, 0], {count: 6});
    assert.ok(plan.ok);
    assert.equal(plan.docks.length, 6);
    for (const d of plan.docks) {
        assert.equal(d.points[0][0], 0);
        assert.equal(dryPieces(d.points, context.water).length, 0);
    }
    assert.equal(planPort(context, [-100, 0]).ok, false);
    const river = [[-40, -200], [40, -200], [40, 200], [-40, 200]];
    const sites = bankSites([sea, river]);
    assert.ok(sites.some(s => s.point[0] === -40));
    assert.ok(!sites.some(s => s.point[0] === 0 && Math.abs(s.point[1]) < 199));
});

test('ports avoid bridges, walls, existing piers, and narrow channels', () => {
    const bridge = {a: [-30, 0], b: [60, 0], width: 12};
    const plan = planPort({...context, bridges: [bridge]}, [0, 0]);
    assert.ok(plan.ok);
    for (const d of plan.docks) assert.ok(segmentSegmentDistance(...d.points, bridge.a, bridge.b) >= 14);
    assert.equal(planPort({
        ...context,
        walls: [{polygon: [[-2, -200], [-2, 200], [-4, 200], [-4, -200]]}]
    }, [0, 0]).ok, false);
    assert.equal(planPort({water: [[[0, -100], [8, -100], [8, 100], [0, 100]]]}, [0, 0]).ok, false);
    const second = planPort({...context, docks: plan.docks}, [0, 0]);
    if (second.ok) for (const a of plan.docks) for (const b of second.docks) assert.ok(segmentSegmentDistance(...a.points, ...b.points) >= 14);
});

test('larger cities receive more separate ports along inhabited waterfronts', () => {
    const urban = [[[-100, -900], [0, -900], [0, 900], [-100, 900]]];
    const city = size => ({
        options: {size},
        terrain: {sea: [sea], ribbons: []},
        buildings: homes(-900, 900),
        docks: [],
        bridges: [],
        walls: []
    });
    const small = additionalPorts(city(16), urban), big = additionalPorts(city(100), urban);
    assert.ok(portCount(big) > portCount(small));
    assert.equal(portCount(big), 4);
    assert.deepEqual(additionalPorts(city(100), urban), big);
    assert.deepEqual(additionalPorts(city(100), []), []);
    assert.deepEqual(additionalPorts({...city(100), buildings: []}, urban), [], 'empty outskirts are not a settlement');
    const limited = {...city(100), buildings: homes(-100, 100)};
    const occupied = inhabitedBank(limited.buildings);
    assert.ok(additionalPorts(limited, urban).every(d => occupied(d.points[0])));
    assert.deepEqual(additionalPorts({...city(100), terrain: {sea: [], ribbons: []}}, urban), []);
});

test('outside-wall settlements receive fishing ports of three or four piers', () => {
    for (const size of [40, 100]) {
        const urban = [[[-100, -400], [0, -400], [0, 400], [-100, 400]], [[-100, 600], [0, 600], [0, 900], [-100, 900]]];
        const wall = {polygon: [[-150, -500], [10, -500], [10, 500], [-150, 500]]};
        const city = {
            options: {size},
            terrain: {sea: [sea], ribbons: []},
            buildings: [...homes(-400, 400), ...homes(600, 900)],
            docks: [],
            bridges: [],
            walls: [wall]
        };
        const docks = additionalPorts(city, urban), fishing = docks.filter(d => d.portKind === 'fishing');
        assert.ok(fishing.length >= 3);
        assert.ok(fishing.length <= (size >= 60 ? 8 : 3));
        for (const dock of fishing) assert.ok(dock.points[0][1] >= 565 && dock.points[0][1] <= 935);
        assert.ok(fishing.every(d => !inside(d.points[0], wall.polygon)));
    }
});

test('Ust-Borovsk gains autonomous ports; generated and edited projects preserve them', () => {
    const city = generateCity({seed: '1931200012', size: 100, shantytown: true});
    assert.ok(city.generatedGeometry.experimental.portLayout.docks.length >= 3);
    const occupied = inhabitedBank(city.buildings);
    assert.ok(city.docks.every(d => occupied(d.points[0])), 'all generated piers have houses nearby');
    assert.deepEqual(parseProject(serializeProject(city, {})).city.docks, city.docks);
    const edited = enterEditor(generateCity({size: 16})), history = createEditorHistory();
    let plan;
    const ctx = portContext(edited);
    const sites = bankSites(ctx.water);
    for (const site of sites) {
        const candidate = planPort(ctx, site.point, {maxDistance: 1, sites});
        if (candidate.ok) {
            plan = candidate;
            break;
        }
    }
    assert.ok(plan?.ok);
    for (const d of plan.docks) {
        const [a, b] = d.points;
        assert.ok(!ctx.water.some(p => inside(lerp(a, b, -.001 / distance(a, b)), p.polygon || p)));
        assert.equal(dryPieces(d.points, ctx.water).length, 0);
    }
    const before = structuredClone(edited.docks);
    history.record(edited);
    applyPort(edited, plan);
    const after = structuredClone(edited.docks);
    assert.equal(after.length, before.length + plan.docks.length);
    history.undo(edited);
    assert.deepEqual(edited.docks, before);
    history.redo(edited);
    assert.deepEqual(edited.docks, after);
    const reopened = parseProject(serializeProject(edited, {})).city;
    assert.deepEqual(reopened.docks, after);
    assert.deepEqual(reopened.editor.water.source.docks, after);
});
