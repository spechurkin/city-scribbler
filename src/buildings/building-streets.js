import {
    area,
    bounds,
    cross,
    distance,
    dot,
    inside,
    lerp,
    rectangle,
    segmentDistance,
    signedArea,
    sub
} from '../core/geometry.js';
import {footprints, hitsRoad} from './building-spatial.js';
import {waterGeometry} from '../water/water-geometry.js';
import {riverRibbon} from '../roads/bridge-network.js';
import {polygonBoolean} from '../compatible/polygons.js';

const EPS = 1e-6;
const key = p => p.map(n => Math.round(n / EPS)).join(',');
const pointsOf = road => road.originalPoints || road.points || [road.a, road.b];
const manual = b => b.custom || b.name || !['house', 'stall'].includes(b.kind);

function clearance(polygon, gap) {
    let result = polygon;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], d = sub(b, a), length = distance(a, b);
        if (length < EPS) continue;
        const n = [-d[1] * gap / length, d[0] * gap / length];
        const stripe = [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]];
        const previous = sub(a, polygon[(i + polygon.length - 1) % polygon.length]);
        const normals = [Math.atan2(d[0], -d[1]), Math.atan2(previous[0], -previous[1])];
        const angles = [...Array.from({length: 8}, (_, j) => j * Math.PI / 4), ...normals, ...normals.map(a => a + Math.PI)].map(angle => (angle + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b).filter((angle, j, values) => !j || angle - values[j - 1] > EPS);
        const corner = angles.map((angle, j) => {
            const next = angles[(j + 1) % angles.length] + (j === angles.length - 1 ? Math.PI * 2 : 0),
                mid = (angle + next) / 2, radius = gap / Math.cos((next - angle) / 2);
            return [a[0] + Math.cos(mid) * radius, a[1] + Math.sin(mid) * radius];
        });
        for (const part of [stripe, corner]) result = polygonBoolean(result, part, 'union').sort((a, b) => area(b) - area(a))[0];
    }
    return result;
}

// A boundary touch is permitted; entering the buffered polygon is not.
function crossings(a, b, polygon) {
    const ts = [], d = sub(b, a);
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], e = sub(polygon[(i + 1) % polygon.length], p), den = cross(d, e);
        if (Math.abs(den) < EPS) continue;
        const t = cross(sub(p, a), e) / den, u = cross(sub(p, a), d) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    return ts;
}

function crosses(a, b, polygon) {
    const ts = [0, ...crossings(a, b, polygon), 1].sort((x, y) => x - y);
    return ts.slice(1).some((t, i) => t - ts[i] > EPS && within(lerp(a, b, (t + ts[i]) / 2), polygon));
}

const within = (p, polygon) => inside(p, polygon) && polygon.every((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]) > EPS);
const overlapsBox = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function shortestPath(a, b, obstacles, dry, graphs, width) {
    const clear = (p, q) => !obstacles.some(poly => crosses(p, q, poly)) && dry(p, q);
    if (clear(a, b)) return [a, b];
    const graphKey = JSON.stringify([width, obstacles]);
    if (!graphs.has(graphKey)) {
        const nodes = obstacles.flat(), edges = nodes.map(() => []);
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (clear(nodes[i], nodes[j])) {
            const length = distance(nodes[i], nodes[j]);
            edges[i].push([j + 2, length]);
            edges[j].push([i + 2, length]);
        }
        graphs.set(graphKey, {nodes, edges});
    }
    const graph = graphs.get(graphKey), nodes = [a, b, ...graph.nodes],
        edges = [[], [], ...graph.edges.map(e => e.slice())];
    for (const at of [0, 1]) for (let i = 2; i < nodes.length; i++) if (clear(nodes[at], nodes[i])) {
        const length = distance(nodes[at], nodes[i]);
        edges[at].push([i, length]);
        edges[i].push([at, length]);
    }
    const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
    costs[0] = 0;
    for (let step = 0; step < nodes.length; step++) {
        let at = -1;
        for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (at < 0 || costs[i] < costs[at])) at = i;
        if (at < 0 || !Number.isFinite(costs[at])) break;
        if (at === 1) {
            const result = [];
            for (let i = 1; i >= 0; i = previous[i]) result.unshift(nodes[i]);
            return result;
        }
        visited.add(at);
        for (const [i, length] of edges[at]) {
            if (visited.has(i)) continue;
            const cost = costs[at] + length;
            if (cost < costs[i]) {
                costs[i] = cost;
                previous[i] = at;
            }
        }
    }
    throw new Error('Для дороги не осталось сухого прохода вокруг здания. Уменьшите здание или передвиньте его.');
}

export function rerouteBuildingStreets(roads, buildings, water = [], graphs = new Map()) {
    const edited = buildings.filter(b => b.custom);
    if (!edited.length && !roads.some(r => r.originalPoints)) return roads;
    const shape = b => {
        const parts = b.fortification ? [b.fortification.polygon] : b.nativeLandmark && b.kind === 'castle' ? [b.polygon] : b.nativeLandmark && b.parts.court ? [b.parts.court] : footprints(b);
        const outlines = [];
        for (const p of parts.slice().sort((a, b) => area(b) - area(a))) if (!outlines.some(q => !polygonBoolean(p, q, 'difference').some(piece => area(piece) > EPS))) outlines.push(p);
        return outlines;
    };
    const outlines = buildings.filter(manual).map(b => ({building: b, polygons: shape(b)})), widths = new Map();
    const geometry = road => {
        const width = road.width || 4.8;
        if (!widths.has(width)) {
            const gap = width / 2 + 1;
            const barriers = outlines.flatMap(({building: b, polygons}) => {
                const padding = gap + (b.fortification ? 3.7 : b.nativeLandmark && b.kind === 'castle' ? 6.8 : 0);
                return polygons.map(p => ({custom: b.custom, polygon: clearance(p, padding)}));
            });
            widths.set(width, {
                gap,
                blockers: barriers.map(b => b.polygon),
                targets: barriers.filter(b => b.custom).map(b => b.polygon)
            });
        }
        return widths.get(width);
    };
    const entrances = new Map(edited.flatMap(b => (b.fortification?.gateOrigins || []).map((p, i) => [key(p), b.fortification.gates[i]])));
    const vertices = [...new Map(roads.flatMap(pointsOf).map(p => [key(p), p])).values()], moved = new Map(),
        shared = new Map();
    const affected = new Set(), vertexKeys = new Set(vertices.map(key)), vertexBlockers = new Map();
    const blockersAt = (p, local) => {
        const id = key(p);
        if (!vertexKeys.has(id)) return local;
        if (!vertexBlockers.has(id)) {
            // Shared junctions need clearance for every incident road, including unsplit through roads.
            const incident = roads.filter(r => pointsOf(r).slice(1).some((b, i) => segmentDistance(p, pointsOf(r)[i], b) < EPS));
            vertexBlockers.set(id, [...new Set(incident.map(r => geometry(r)))].flatMap(g => g.blockers));
        }
        return vertexBlockers.get(id);
    };
    for (const p of vertices) if (entrances.has(key(p)) && distance(p, entrances.get(key(p))) > EPS) affected.add(key(p));
    const waterIndex = water.map(region => ({region, box: bounds(region.polygon)}));
    const dryRegion = polygon => {
        const box = bounds(polygon), nearby = waterIndex.filter(w => overlapsBox(w.box, box)).map(w => w.region);
        return nearby.every(region => {
            let wet = polygonBoolean(polygon, region.polygon, 'intersection');
            for (const hole of region.holes || []) wet = wet.flatMap(p => polygonBoolean(p, hole, 'difference'));
            return Math.abs(wet.reduce((sum, p) => sum + signedArea(p), 0)) < EPS;
        });
    };
    for (const road of roads) {
        const points = pointsOf(road), {targets} = geometry(road);
        for (let i = 1; i < points.length; i++) if (targets.some(poly => crosses(points[i - 1], points[i], poly) || within(points[i - 1], poly) || within(points[i], poly))) {
            for (const p of vertices) if (segmentDistance(p, points[i - 1], points[i]) < EPS) affected.add(key(p));
        }
    }
    let previousSize;
    do {
        previousSize = affected.size;
        for (const road of roads) {
            const points = pointsOf(road), {blockers} = geometry(road);
            for (let i = 1; i < points.length; i++) if (affected.has(key(points[i - 1])) || affected.has(key(points[i]))) {
                for (const p of [points[i - 1], points[i]]) if (blockers.some(poly => within(p, poly))) affected.add(key(p));
            }
        }
    } while (affected.size > previousSize);
    const dryPoint = p => dryRegion(rectangle(p, .05, .05));
    const relocate = (p, local, force = false) => {
        if (moved.has(key(p))) return moved.get(key(p));
        let result = entrances.get(key(p)) || p;
        const blockers = force || affected.has(key(p)) ? blockersAt(p, local) : [];
        if (blockers.some(poly => within(result, poly))) {
            const candidates = blockers.flatMap(poly => poly.flatMap((a, i) => {
                const b = poly[(i + 1) % poly.length], d = sub(b, a),
                    t = Math.max(0, Math.min(1, dot(sub(result, a), d) / dot(d, d)));
                return [a, lerp(a, b, t)];
            })).filter(q => !blockers.some(poly => within(q, poly)) && dryPoint(q)).sort((a, b) => distance(a, result) - distance(b, result));
            if (!candidates.length) throw new Error('Дорожный узел оказался у воды. Уменьшите здание или передвиньте его.');
            result = candidates[0];
        }
        moved.set(key(p), result);
        return result;
    };
    const affectedVertices = vertices.filter(p => affected.has(key(p)));
    return roads.map(road => {
        const original = pointsOf(road), width = road.width || 4.8, result = [];
        const {gap, blockers, targets} = geometry(road);
        for (let i = 1; i < original.length; i++) {
            const a = original[i - 1], b = original[i],
                touched = targets.filter(poly => crosses(a, b, poly) || within(a, poly) || within(b, poly));
            const d = sub(b, a), cuts = touched.flatMap(poly => crossings(a, b, poly).map(t => lerp(a, b, t)));
            const junctions = (touched.length ? vertices : affectedVertices).filter(p => distance(p, a) > EPS && distance(p, b) > EPS && segmentDistance(p, a, b) < EPS);
            const nodes = [a, ...[...cuts, ...junctions].sort((p, q) => dot(sub(p, a), d) - dot(sub(q, a), d)), b];
            for (let j = 1; j < nodes.length; j++) {
                const from = relocate(nodes[j - 1], blockers, touched.length > 0),
                    to = relocate(nodes[j], blockers, touched.length > 0);
                let path = [from, to];
                if (touched.length || distance(from, nodes[j - 1]) > EPS || distance(to, nodes[j]) > EPS) {
                    const box = bounds([from, to, ...touched.flat()]),
                        pad = Math.max(box[2] - box[0], box[3] - box[1], gap * 2);
                    const nearby = blockers.filter(polygon => overlapsBox(bounds(polygon), [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]));
                    const dry = (p, q) => distance(p, q) < EPS || dryRegion(rectangle(lerp(p, q, .5), distance(p, q), width, Math.atan2(q[1] - p[1], q[0] - p[0])));
                    path = shortestPath(from, to, nearby, dry, graphs, width);
                }
                for (const p of path) if (!result.length || distance(result.at(-1), p) > EPS) {
                    if (!shared.has(key(p))) shared.set(key(p), p);
                    result.push(shared.get(key(p)));
                }
            }
        }
        if (result.length < 2) result.push([...result[0]]);
        const {originalPoints, ...base} = road;
        const changed = result.length !== original.length || result.some((p, i) => distance(p, original[i]) > EPS);
        if (!changed && !originalPoints) return road;
        const points = changed ? result : original;
        return {
            ...base, points, ...(road.a ? {
                a: points[0],
                b: points.at(-1)
            } : {}), ...(changed ? {originalPoints: original} : {})
        };
    });
}

export function planBuildingStreets(city, buildings) {
    const water = waterGeometry(city), graphs = new Map(),
        streets = rerouteBuildingStreets(city.streets, buildings, water, graphs);
    const sourceRoads = rerouteBuildingStreets(city.editor.water.source.roads, buildings, water, graphs);
    const changed = streets.flatMap((r, i) => JSON.stringify(r.points || [r.a, r.b]) !== JSON.stringify(city.streets[i]?.points || [city.streets[i]?.a, city.streets[i]?.b]) ? [{
        road: r,
        before: city.streets[i]
    }] : []);
    const removed = buildings.filter(b => !manual(b) && changed.some(({road}) => hitsRoad(b, road))).map(b => b.id);
    const polygons = changed.flatMap(({
                                          road,
                                          before
                                      }) => [riverRibbon(road.points, road.width || 4.8), riverRibbon(before.points || [before.a, before.b], before.width || 4.8)]);
    return {streets, sourceRoads, removed, polygons};
}
