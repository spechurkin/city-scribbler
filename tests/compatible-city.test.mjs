import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCity} from '../src/compatible/city.js';
import {generateStructure, structureGeometry} from '../src/compatible/structure.js';
import {CrownCache} from '../src/compatible/trees.js';
import {Sequence} from '../src/compatible/sequence.js';

const recipe = {
    seed: '280498173601',
    size: 29,
    coast: false,
    river: false,
    citadel: true,
    urban_castle: true,
    plaza: true,
    temple: true,
    walls: true,
    greens: true,
    shantytown: true
};

test('complete experimental generation is reproducible without render history and serializes every detail layer', () => {
    const first = structureGeometry(generateCity(recipe, {forests: true}));
    const second = structureGeometry(generateCity(recipe, {forests: true}));
    assert.deepEqual(first, second);
    const detail = first.experimental;
    assert.ok(detail.housing.length > 0 && detail.fields.length > 0);
    assert.ok(detail.specialBuildings.some(b => b.kind === 'castle'));
    assert.ok(detail.specialBuildings.some(b => b.kind === 'temple'));
    assert.equal(detail.monuments.length, 1);
    assert.ok(detail.forests.length > 0 && detail.treeDrawings.length > 0);
    const polygons = [...detail.housing, ...detail.fields, ...detail.specialBuildings.map(b => b.polygon), ...detail.monuments, ...detail.squares, ...detail.forests.flatMap(f => f.polygons)];
    assert.ok(polygons.every(p => p.length >= 3 && p.every(point => point.length === 2 && point.every(Number.isFinite))));
    const trees = [...detail.treeDrawings, ...detail.forests.flatMap(f => f.trees)];
    assert.ok(trees.every(t => t.point.every(Number.isFinite) && Number.isInteger(t.index) && t.index >= 0 && t.index < detail.treeCrowns.length));
    assert.equal(first.completeness.fullySeedCompatible, false);
});

test('external forests leave all previously generated city layers and their random sequence intact', () => {
    const city = structureGeometry(generateCity(recipe)),
        withForests = structureGeometry(generateCity(recipe, {forests: true}));
    const {forests: withoutForest, ...baseDetail} = city.experimental, {
        forests: forest,
        ...forestDetail
    } = withForests.experimental;
    assert.deepEqual(forestDetail, baseDetail);
    assert.deepEqual(city.roads, withForests.roads);
    assert.deepEqual(city.sequence, withForests.sequence);
    assert.equal(withoutForest.length, 0);
    assert.ok(forest.length > 0);
});

test('fresh crown caches consume generation draws, while a full cache consumes only its random selection draw', () => {
    const fresh = new CrownCache(), sequence = new Sequence(31);
    for (let i = 0; i < 20; i++) assert.equal(fresh.next(sequence), i);
    assert.equal(sequence.draws, 20 * 45);
    assert.ok(fresh.palette.every(p => p.length > 6 && p.every(point => point.every(Number.isFinite))));
    const start = sequence.draws, index = fresh.next(sequence);
    assert.equal(sequence.draws - start, 1);
    assert.ok(index >= 0 && index < 20);
    const warmSequence = new Sequence(31), warm = new CrownCache('warm');
    warm.next(warmSequence);
    assert.equal(warmSequence.draws, 1);
});

test('a rejected detailed stage restarts the model from the active local sequence checkpoint', () => {
    let calls = 0, failedAt;
    const stage = () => {
        if (calls++) return;
        const local = new Sequence(417);
        local.next();
        failedAt = local.checkpoint();
        local.checkpointOnError(() => {
            throw new Error('Rejected parcel');
        });
    };
    const terrain = generateStructure({
        ...recipe,
        size: 17,
        river: false,
        coast: false
    }, {additionalStages: [['housing', stage]]});
    assert.equal(calls, 2);
    const failure = terrain.attempts.find(a => a.stage === 'housing');
    assert.deepEqual(failure.end, failedAt);
    assert.deepEqual(terrain.attemptStart, failedAt);
    assert.equal(terrain.options.seed, recipe.seed);
});

test('concave housing without a forward cut exit keeps the original seeded city deterministically', () => {
    const input = {
        seed: '1109060300002',
        size: 100,
        river: false,
        coast: true,
        sea: .75,
        citadel: true,
        urban_castle: true,
        hub: false,
        plaza: true,
        greens: true,
        temple: true,
        walls: true,
        shantytown: true
    };
    const a = structureGeometry(generateCity(input)), b = structureGeometry(generateCity(input));
    assert.equal(a.attempts.length, 0);
    assert.equal(a.recipe.seed, input.seed);
    assert.equal(a.attemptStart.state, Number(input.seed));
    assert.ok(a.experimental.housing.length > 100);
    assert.deepEqual(a, b);
});
