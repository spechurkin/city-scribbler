const separation = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function referenceConsistency(reference, data) {
    const features = new Map(data.features.map(f => [f.id, f])), mismatches = [];
    for (const [flag, present] of [
        ['river', Boolean(features.get('rivers')?.geometries.length)],
        ['plaza', Boolean(features.get('squares')?.coordinates.length)],
        ['coast', Boolean(features.get('water')?.coordinates.length)]
    ]) if (reference.flags[flag] !== undefined && reference.flags[flag] !== present) mismatches.push({
        parameter: flag,
        url: reference.flags[flag],
        geojson: present
    });
    if (reference.flags.walls !== undefined && reference.flags.citadel !== undefined) {
        const expected = Number(reference.flags.walls) + Number(reference.flags.citadel),
            actual = features.get('walls')?.geometries.length || 0;
        if (expected !== actual) mismatches.push({parameter: 'fortifications', url: expected, geojson: actual});
    }
    return {comparable: mismatches.length === 0, mismatches};
}

export function comparePath(actual, expected, {closed = false, tolerance = .001} = {}) {
    if (actual.length !== expected.length) return {
        match: false,
        expectedPoints: expected.length,
        actualPoints: actual.length,
        matchedPoints: 0,
        maxError: null,
        meanError: null
    };
    if (!actual.length) return {
        match: true,
        expectedPoints: 0,
        actualPoints: 0,
        matchedPoints: 0,
        maxError: 0,
        meanError: 0
    };
    let best = null;
    for (const direction of [1, -1]) for (let start = 0; start < (closed ? actual.length : 1); start++) {
        const errors = expected.map((point, index) => {
            const position = closed ? (start + direction * index + actual.length) % actual.length : direction === 1 ? index : actual.length - 1 - index;
            return separation(point, actual[position]);
        });
        const sum = errors.reduce((a, b) => a + b, 0);
        if (!best || sum < best.sum) best = {sum, errors, direction, start};
    }
    return {
        match: best.errors.every(e => e <= tolerance),
        expectedPoints: expected.length,
        actualPoints: actual.length,
        matchedPoints: best.errors.filter(e => e <= tolerance).length,
        maxError: Math.max(...best.errors),
        meanError: best.sum / expected.length
    };
}

export function comparePaths(actual, expected, options = {}) {
    const remaining = new Set(actual.map((_, i) => i)), parts = [];
    for (const path of expected) {
        let chosen = null;
        for (const index of remaining) {
            const comparison = comparePath(actual[index], path, options);
            const score = (comparison.match ? 0 : 1e9) + (comparison.meanError ?? 1e8) + Math.abs(comparison.actualPoints - comparison.expectedPoints) * 1e6;
            if (!chosen || score < chosen.score) chosen = {index, score, comparison};
        }
        if (chosen) {
            remaining.delete(chosen.index);
            parts.push(chosen.comparison);
        } else parts.push({
            match: false,
            expectedPoints: path.length,
            actualPoints: 0,
            matchedPoints: 0,
            maxError: null,
            meanError: null
        });
    }
    return {
        match: actual.length === expected.length && parts.every(p => p.match),
        expectedPaths: expected.length,
        actualPaths: actual.length,
        expectedPoints: parts.reduce((s, p) => s + p.expectedPoints, 0),
        actualPoints: actual.flat().length,
        matchedPoints: parts.reduce((s, p) => s + p.matchedPoints, 0),
        maxError: parts.some(p => p.maxError === null) ? null : Math.max(0, ...parts.map(p => p.maxError)),
        parts
    };
}

export function compareGeometry(generated, reference, {tolerance = .001} = {}) {
    const features = new Map(reference.features.map(f => [f.id, f]));
    return {
        earth: comparePaths([generated.earth], features.get('earth').coordinates, {closed: true, tolerance}),
        water: comparePaths(generated.water.length ? [generated.water] : [], features.get('water')?.coordinates.map(p => p[0]) || [], {
            closed: true,
            tolerance
        }),
        walls: comparePaths(generated.walls.map(w => w.polygon), features.get('walls').geometries.map(g => g.coordinates[0]), {
            closed: true,
            tolerance
        }),
        mainRoads: comparePaths(generated.roads, features.get('roads').geometries.filter(g => g.width === 8).map(g => g.coordinates), {tolerance}),
        riverCourse: comparePaths(generated.rivers, features.get('rivers').geometries.map(g => g.coordinates), {tolerance}),
        planks: comparePaths(generated.planks, features.get('planks').geometries.map(g => g.coordinates), {tolerance}),
        riverWidth: {
            match: generated.riverWidths.length === features.get('rivers').geometries.length && generated.riverWidths.every((w, i) => Math.abs(w - features.get('rivers').geometries[i].width) < 1e-9),
            expectedPoints: features.get('rivers').geometries.length,
            matchedPoints: generated.riverWidths.filter((w, i) => Math.abs(w - (features.get('rivers').geometries[i]?.width ?? Infinity)) < 1e-9).length
        }
    };
}

export function matchPathSubset(actual, expected, {closed = false, tolerance = .001} = {}) {
    const center = path => path.reduce((sum, p) => [sum[0] + p[0] / path.length, sum[1] + p[1] / path.length], [0, 0]);
    const index = new Map(), used = new Set();
    for (let i = 0; i < expected.length; i++) {
        const c = center(expected[i]), key = `${Math.round(c[0])}:${Math.round(c[1])}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(i);
    }
    for (const path of actual) {
        const c = center(path);
        let found = false;
        for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) {
            const candidates = index.get(`${Math.round(c[0]) + dx}:${Math.round(c[1]) + dy}`) || [];
            for (const candidate of candidates) if (!used.has(candidate) && comparePath(path, expected[candidate], {
                closed,
                tolerance
            }).match) {
                used.add(candidate);
                found = true;
                break;
            }
        }
    }
    return {
        fullyMatched: actual.length === expected.length && used.size === actual.length,
        matched: used.size,
        actual: actual.length,
        expected: expected.length,
        tolerance
    };
}
