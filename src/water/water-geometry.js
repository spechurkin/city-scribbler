import {distance, inside, segmentDistance, segmentsIntersect} from '../core/geometry.js';
import {dryFootprint, dryPieces, riverRibbon} from '../roads/bridge-network.js';

export const waterPoint = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9);
const openRing = points => points.length > 2 && distance(points[0], points.at(-1)) < 1e-7 ? points.slice(0, -1) : points;

function simplify(points, tolerance) {
    if (points.length <= 2) return points.slice();
    let farthest = 0, gap = tolerance;
    for (let i = 1; i < points.length - 1; i++) {
        const d = segmentDistance(points[i], points[0], points.at(-1));
        if (d > gap) {
            farthest = i;
            gap = d;
        }
    }
    return farthest ? [...simplify(points.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplify(points.slice(farthest), tolerance)] : [points[0], points.at(-1)];
}

function controls(points, closed, tolerance) {
    const original = closed ? [...openRing(points), points[0]] : points;
    let result = original;
    while (result.length > 100) {
        result = simplify(original, tolerance);
        tolerance *= 1.6;
    }
    return structuredClone(closed ? openRing(result) : result);
}

export function smoothWaterPoints(points, closed = false) {
    if (points.length < 3) return points.map(p => [...p]);
    const count = closed ? points.length : points.length - 1, result = [];
    const at = i => closed ? points[(i + points.length) % points.length] : points[Math.max(0, Math.min(points.length - 1, i))];
    for (let i = 0; i < count; i++) {
        const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        for (let j = 0; j < 6; j++) {
            const t = j / 6, t2 = t * t, t3 = t2 * t;
            result.push([0, 1].map(axis => .5 * (2 * b[axis] + (-a[axis] + c[axis]) * t + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t2 + (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t3)));
        }
    }
    if (!closed) result.push([...points.at(-1)]);
    return result;
}

export function waterBodyGeometry(body) {
    const points = body.smooth ? smoothWaterPoints(body.points, body.kind === 'sea') : body.points;
    const polygon = body.outline || (body.kind === 'river' ? riverRibbon(points, body.width) : points);
    return {id: body.id, kind: body.kind, points, width: body.width, polygon, holes: body.holes || []};
}

export function waterGeometry(city) {
    return city.editor.water.bodies.map(waterBodyGeometry);
}

export function pointInWater(point, regions) {
    return regions.some(r => inside(point, r.polygon) && !(r.holes || []).some(h => inside(point, h)));
}

export function footprintDryInWater(polygon, regions) {
    const wet = regions.filter(r => !(r.holes || []).some(h => polygon.every(p => inside(p, h)) && !polygon.some((p, i) => h.some((q, j) => segmentsIntersect(p, polygon[(i + 1) % polygon.length], q, h[(j + 1) % h.length]))))).map(r => r.polygon);
    return dryFootprint(polygon, wet);
}

export function ensureEditorWater(city) {
    if (city.editor.water) return city.editor.water;
    const format = city.editor.baseFormat, tolerance = city.viewBox.width / 1000;
    const rivers = format === 'mfcg' ? city.imported.rivers : format === 'legacy' ? city.terrain.riverPath?.length ? [{
        points: city.terrain.riverPath,
        width: city.terrain.riverWidth
    }] : [] : city.terrain.rivers;
    const sea = format === 'mfcg' ? city.imported.water : format === 'legacy' ? city.terrain.sea?.length ? [[city.terrain.sea]] : [] : city.terrain.sea.map(p => [p]);
    let nextId = 1;
    const bodies = [...(rivers || []).map((r, i) => ({
        id: `water-${nextId++}`,
        kind: 'river',
        points: controls(r.points, false, tolerance),
        width: r.width,
        smooth: false,
        outline: structuredClone(format === 'legacy' ? city.terrain.riverPolygon : format === 'compatible' ? city.terrain.ribbons[i] : riverRibbon(r.points, r.width))
    })), ...sea.map(rings => ({
        id: `water-${nextId++}`,
        kind: 'sea',
        points: controls(rings[0], true, tolerance),
        outline: structuredClone(openRing(rings[0])),
        holes: rings.slice(1).map(openRing),
        smooth: false
    }))];
    const roads = (city.streets || []).map((r, i) => ({
        id: `water-road-${i}`,
        points: structuredClone(r.points || [r.a, r.b]),
        width: r.width,
        major: !!r.major
    }));
    for (const [i, b] of (city.bridges || []).entries()) if (!b.pedestrian) roads.push({
        id: `water-crossing-${i}`,
        points: [b.a, b.b].map(p => [...p]),
        width: b.width,
        major: true
    });
    const footbridges = (city.bridges || []).filter(b => b.pedestrian).map(b => [b.a, b.b]);
    let docks = structuredClone(city.docks || []);
    if (format === 'mfcg') {
        const riverWater = bodies.filter(b => b.kind === 'river').map(waterBodyGeometry);
        docks = docks.filter(d => {
            const total = d.points.slice(1).reduce((sum, p, i) => sum + distance(p, d.points[i]), 0),
                dry = dryPieces(d.points, riverWater.map(r => r.polygon)).reduce((sum, p) => sum + p.slice(1).reduce((n, q, i) => n + distance(q, p[i]), 0), 0);
            if (dry < total - 1e-5) {
                footbridges.push(d.points);
                return false;
            }
            return true;
        });
    }
    footbridges.forEach((points, i) => roads.push({
        id: `water-footpath-${i}`,
        points: structuredClone(points),
        width: 4.8,
        major: false
    }));
    city.editor.water = {
        version: 1,
        nextId,
        bodies,
        dirty: false,
        source: {roads, footbridges: structuredClone(footbridges), docks}
    };
    return city.editor.water;
}
