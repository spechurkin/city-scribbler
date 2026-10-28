import {
    add,
    area,
    bounds,
    centroid,
    cross,
    distance,
    dot,
    inside,
    lerp,
    mul,
    segmentDistance,
    segmentsIntersect,
    signedArea,
    sub
} from '../core/geometry.js';
import {largestPolygon, polygonBoolean} from '../compatible/polygons.js';

const EPS = 1e-7;
const unit = v => mul(v, 1 / (Math.hypot(...v) || 1));
const normal = v => [-v[1], v[0]];

function riverBanks(points, width) {
    const sides = [[], []];
    points.forEach((p, i) => {
        const before = unit(sub(p, points[Math.max(0, i - 1)])),
            after = unit(sub(points[Math.min(points.length - 1, i + 1)], p));
        const n = normal(unit(add(before, after))), edge = normal(i ? before : after);
        const offset = mul(n, Math.min(width * 1.5, width / 2 / Math.max(.25, Math.abs(dot(n, edge)))));
        sides[0].push(add(p, offset));
        sides[1].push(sub(p, offset));
    });
    return sides;
}

function normalizeRibbon(ribbon) {
    const folded = ribbon.some((a, i) => ribbon.some((b, j) => j > i + 1 && !(i === 0 && j === ribbon.length - 1) && segmentsIntersect(a, ribbon[(i + 1) % ribbon.length], b, ribbon[(j + 1) % ribbon.length])));
    return folded ? largestPolygon(polygonBoolean(ribbon, ribbon, 'union')) : ribbon;
}

export function riverRibbon(points, width) {
    const [a, b] = riverBanks(points, width);
    return normalizeRibbon([...a, ...b.slice().reverse()]);
}

function openRiverMouths(banks, river, sea) {
    const mouths = [];
    if (!sea.length) return mouths;
    for (const end of [0, -1]) {
        const origin = river.points.at(end), next = river.points.at(end === 0 ? 1 : -2);
        if (!next || Math.min(...sea.flatMap(poly => poly.map((p, i) => segmentDistance(origin, p, poly[(i + 1) % poly.length])))) > .01) continue;
        const cap = banks.map(bank => bank.at(end)), forward = unit(sub(origin, next)),
            overlap = Math.max(.001, river.width * .025);
        const forwardAngle = Math.atan2(forward[1], forward[0]);
        const seaAngles = sea.map(poly => {
            const direction = sub(centroid(poly), origin);
            return Math.atan2(direction[1], direction[0]) - forwardAngle;
        });
        let joined = null;
        for (const angle of [0, ...Array.from({length: 12}, (_, i) => [(i + 1) * Math.PI / 12, -(i + 1) * Math.PI / 12]).flat(), ...seaAngles]) {
            const direction = [forward[0] * Math.cos(angle) - forward[1] * Math.sin(angle), forward[0] * Math.sin(angle) + forward[1] * Math.cos(angle)];
            const samples = [0, .25, .5, .75, 1].map(t => lerp(cap[0], cap[1], t));
            const hits = [0, ...samples.flatMap(p => sea.flatMap(poly => intersections(p, add(p, direction), poly, true)).filter(t => t >= 0 && t < river.width * 32))].sort((a, b) => a - b);
            const extensions = hits.flatMap((hit, i) => [hit + overlap, ...(i + 1 < hits.length ? [(hit + hits[i + 1]) / 2] : [])]);
            for (const extension of extensions) {
                const points = cap.map(p => add(p, mul(direction, extension)));
                if (!samples.every(p => sea.some(poly => inside(add(p, mul(direction, extension)), poly)))) continue;
                if (dryPieces(points, sea).some(p => distance(p[0], p.at(-1)) > EPS)) continue;
                joined = {end, origin, direction, extension, cap: points};
                break;
            }
            if (joined) break;
        }
        if (!joined) throw new Error('Не удалось раскрыть устье реки в водоём.');
        for (let side = 0; side < 2; side++) if (end === 0) banks[side].unshift(joined.cap[side]); else banks[side].push(joined.cap[side]);
        mouths.push(joined);
    }
    return mouths;
}

function intersections(a, b, polygon, infinite = false) {
    const direction = sub(b, a), values = [];
    polygon.forEach((c, i) => {
        const edge = sub(polygon[(i + 1) % polygon.length], c), den = cross(direction, edge);
        if (Math.abs(den) < EPS) return;
        const t = cross(sub(c, a), edge) / den, u = cross(sub(c, a), direction) / den;
        if (u >= -EPS && u <= 1 + EPS && (infinite || t > EPS && t < 1 - EPS)) values.push(t);
    });
    return values.sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > EPS);
}

const waterPolygon = region => Array.isArray(region) ? region : region.polygon;
const waterRings = region => [waterPolygon(region), ...(region.holes || [])];
const inWater = (point, region) => inside(point, waterPolygon(region)) && !(region.holes || []).some(h => inside(point, h));

export function dryPieces(points, water) {
    const result = [];
    let current = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i],
            ts = [0, ...water.flatMap(region => waterRings(region).flatMap(poly => intersections(a, b, poly))), 1].sort((a, b) => a - b);
        for (let j = 1; j < ts.length; j++) {
            if (ts[j] - ts[j - 1] < EPS) continue;
            if (water.some(region => inWater(lerp(a, b, (ts[j] + ts[j - 1]) / 2), region))) {
                if (current.length > 1) result.push(current);
                current = [];
                continue;
            }
            const start = lerp(a, b, ts[j - 1]), end = lerp(a, b, ts[j]);
            if (current.length && distance(current.at(-1), start) > EPS) {
                result.push(current);
                current = [];
            }
            if (!current.length) current.push(start);
            if (distance(current.at(-1), end) > EPS) current.push(end);
        }
    }
    if (current.length > 1) result.push(current);
    return result;
}

export function dryFootprint(polygon, water) {
    const boundary = [...polygon, polygon[0]],
        perimeter = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
    return !water.some(wet => waterPolygon(wet).some(p => inside(p, polygon))) && Math.abs(dryPieces(boundary, water).reduce((sum, p) => sum + perimeter(p), 0) - perimeter(boundary)) < 1e-5;
}

export function anchorPiersToBanks(piers, water) {
    return piers.map(points => {
        const a = points[0], direction = unit(sub(a, points.at(-1))), b = add(a, direction),
            hits = [0, ...water.flatMap(region => waterRings(region).flatMap(polygon => intersections(a, b, polygon, true))).filter(t => t > EPS)].sort((a, b) => a - b);
        for (let i = 0; i < hits.length; i++) {
            const t = hits[i], next = hits[i + 1] ?? t + 1;
            if (next - t < EPS || water.some(region => inWater(add(a, mul(direction, (t + next) / 2)), region))) continue;
            return t > EPS ? [add(a, mul(direction, t)), ...points.slice(1)] : points;
        }
        return points;
    });
}

const clear = (a, b, water) => distance(a, b) < EPS ? !water.some(region => inWater(a, region)) : dryPieces([a, b], water).reduce((sum, p) => sum + distance(p[0], p.at(-1)), 0) >= distance(a, b) - 1e-5;

function routeOnLand(a, b, water) {
    if (clear(a, b, water)) return [a, b];
    // Offset bank vertices give the visibility graph dry corners around a bend.
    const corners = water.flatMap(waterRings).flatMap(poly => poly.flatMap((p, i) => {
        const tangent = unit(sub(poly[(i + 1) % poly.length], poly[(i + poly.length - 1) % poly.length])),
            n = normal(tangent);
        return [add(p, mul(n, 1.5)), sub(p, mul(n, 1.5))].filter(p => !water.some(w => inWater(p, w)));
    })).filter(p => distance(a, p) + distance(p, b) < distance(a, b) * 4 + 100);
    const nodes = [a, b, ...corners], costs = nodes.map(() => Infinity), previous = [], closed = new Set();
    costs[0] = 0;
    for (let step = 0; step < nodes.length; step++) {
        let at = -1;
        for (let i = 0; i < nodes.length; i++) if (!closed.has(i) && (at < 0 || costs[i] < costs[at])) at = i;
        if (at < 0 || !Number.isFinite(costs[at])) return [];
        if (at === 1) {
            const path = [];
            for (let i = 1; i !== undefined; i = previous[i]) path.unshift(nodes[i]);
            return path;
        }
        closed.add(at);
        for (let i = 0; i < nodes.length; i++) {
            if (closed.has(i)) continue;
            const next = costs[at] + distance(nodes[at], nodes[i]);
            if (next < costs[i] && clear(nodes[at], nodes[i], water)) {
                costs[i] = next;
                previous[i] = at;
            }
        }
    }
    return [];
}

function crossingHits(roads, river) {
    const found = [];
    for (const road of roads.filter(r => !r.landOnly)) for (let i = 1; i < road.points.length; i++) for (let j = 1; j < river.length; j++) {
        const a = road.points[i - 1], b = road.points[i], c = river[j - 1], d = river[j], ab = sub(b, a),
            cd = sub(d, c), den = cross(ab, cd);
        if (Math.abs(den) < EPS) continue;
        const t = cross(sub(c, a), cd) / den, u = cross(sub(c, a), ab) / den;
        if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
        const point = lerp(a, b, t);
        if (distance(point, river[0]) < EPS || distance(point, river.at(-1)) < EPS) continue;
        const vertex = t < EPS ? i - 1 : t > 1 - EPS ? i : -1;
        if (vertex > 0 && vertex < road.points.length - 1 && cross(cd, sub(road.points[vertex - 1], point)) * cross(cd, sub(road.points[vertex + 1], point)) >= 0) continue;
        found.push({point, pedestrian: !road.major});
    }
    return found;
}

function mergeCrossings(explicit, roads, river, planks, width) {
    const result = [];
    const addCrossing = c => {
        const existing = result.find(other => distance(other.point, c.point) < .01);
        if (existing) {
            if (!c.pedestrian) existing.pedestrian = false;
            return;
        }
        result.push({...c});
    };
    explicit.forEach(addCrossing);
    crossingHits(roads, river).forEach(addCrossing);
    crossingHits(planks.map((points, i) => ({id: `plank-${i}`, points, major: false})), river).forEach(addCrossing);
    const position = p => {
        let travel = 0, best = Infinity, along = 0;
        for (let i = 1; i < river.length; i++) {
            const a = river[i - 1], b = river[i], ab = sub(b, a), length = distance(a, b),
                t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
            const gap = distance(p, lerp(a, b, t));
            if (gap < best) {
                best = gap;
                along = travel + t * length;
            }
            travel += length;
        }
        return along;
    };
    const sorted = result.map(c => ({...c, along: position(c.point)})).sort((a, b) => a.along - b.along), groups = [];
    for (const crossing of sorted) {
        const group = groups.at(-1);
        if (group && crossing.along - group.at(-1).along < width * .65 && crossing.along - group[0].along < width * 1.25) group.push(crossing);
        else groups.push([crossing]);
    }
    return groups.map(group => {
        const middle = (group[0].along + group.at(-1).along) / 2,
            representative = group.reduce((best, c) => Math.abs(c.along - middle) < Math.abs(best.along - middle) ? c : best);
        return {...representative, pedestrian: group.every(c => c.pedestrian), origins: group.map(c => c.point)};
    });
}

function bridgeAxis(crossing, river, roads) {
    const p = crossing.point;
    let index = 0;
    for (let i = 1; i < river.length; i++) if (distance(p, river[i]) < distance(p, river[index])) index = i;
    const tangent = unit(sub(river[Math.min(river.length - 1, index + 1)], river[Math.max(0, index - 1)]));
    const directions = [];
    for (const road of roads.filter(r => !r.landOnly)) for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i], ab = sub(b, a), t = dot(sub(p, a), ab) / (dot(ab, ab) || 1);
        if (t < -EPS || t > 1 + EPS || distance(p, lerp(a, b, t)) > .01) continue;
        let direction = unit(ab);
        if (directions.length && dot(direction, directions[0]) < 0) direction = mul(direction, -1);
        directions.push(direction);
    }
    const candidate = directions.length ? unit(directions.reduce(add, [0, 0])) : normal(tangent);
    return Math.abs(cross(candidate, tangent)) > .25 ? candidate : normal(tangent);
}

function planBridge(crossing, river, polygon, roads, id, axis = bridgeAxis(crossing, river, roads)) {
    const p = crossing.point;
    const hits = intersections(p, add(p, axis), polygon, true), low = hits.filter(t => t < 0).at(-1),
        high = hits.find(t => t > 0);
    if (low === undefined || high === undefined) return null;
    const width = crossing.pedestrian ? 4.8 : 8, a = add(p, mul(axis, low)), b = add(p, mul(axis, high)),
        side = mul(normal(axis), width / 2);
    const rails = [side, mul(side, -1)].map(offset => {
        const origin = add(p, offset), hits = intersections(origin, add(origin, axis), polygon, true);
        const lo = hits.filter(t => t < 0).at(-1), hi = hits.find(t => t > 0);
        return lo === undefined || hi === undefined ? null : [add(origin, mul(axis, lo)), add(origin, mul(axis, hi))];
    });
    if (rails.some(r => !r)) return null;
    const before = Math.min(...rails.map(r => dot(sub(r[0], p), axis)), low) - 1,
        after = Math.max(...rails.map(r => dot(sub(r[1], p), axis)), high) + 1;
    const start = add(p, mul(axis, before)), end = add(p, mul(axis, after)),
        strip = [add(start, side), add(end, side), sub(end, side), sub(start, side)];
    const shapes = polygonBoolean(strip, polygon, 'intersection'), shape = shapes.find(poly => inside(p, poly));
    if (!shape) return null;
    return {id, a, b, width, axis, origin: p, pedestrian: crossing.pedestrian, polygon: shape, rails};
}

function bridgesOverlap(a, b) {
    const first = bounds(a.polygon), second = bounds(b.polygon);
    if (first[2] <= second[0] || second[2] <= first[0] || first[3] <= second[1] || second[3] <= first[1]) return false;
    return polygonBoolean(a.polygon, b.polygon, 'intersection').some(p => area(p) > EPS);
}

function naturalBridge(crossing, river, ribbon, roads, id) {
    const aligned = planBridge(crossing, river, ribbon, roads, id),
        across = planBridge(crossing, river, ribbon, [], id);
    if (!aligned) return across;
    if (!across) return aligned;
    return crossing.origins.length > 1 || distance(aligned.a, aligned.b) > distance(across.a, across.b) * 1.2 ? across : aligned;
}

function combineOverlappingBridges(bridges, rivers, ribbons, roads) {
    for (let i = 0; i < bridges.length; i++) for (let j = i + 1; j < bridges.length; j++) {
        const first = bridges[i], second = bridges[j];
        if (first.river !== second.river || !bridgesOverlap(first, second)) continue;
        const origins = [...first.origins, ...second.origins],
            center = mul(origins.reduce(add, [0, 0]), 1 / origins.length);
        const point = origins.reduce((best, p) => distance(p, center) < distance(best, center) ? p : best),
            pedestrian = first.pedestrian && second.pedestrian;
        const bridge = naturalBridge({
            point,
            pedestrian,
            origins
        }, rivers[first.river].points, ribbons[first.river], roads, first.id);
        if (!bridge) throw new Error('Не удалось разместить общую переправу.');
        bridges[i] = {...bridge, river: first.river, origins};
        bridges.splice(j, 1);
        i = -1;
        break;
    }
    return bridges;
}

function quayOffset(points, amount) {
    return points.map((p, i) => {
        const before = unit(sub(p, points[(i + points.length - 1) % points.length])),
            after = unit(sub(points[(i + 1) % points.length], p));
        const n = normal(unit(add(before, after))), edge = normal(before);
        return add(p, mul(n, amount / Math.max(.3, Math.abs(dot(n, edge)))));
    });
}

function buildQuays(ribbons, bridges, urban, width = 4.8) {
    const quays = [];
    ribbons.forEach((bank, river) => {
        const outer = quayOffset(bank, signedArea(bank) > 0 ? -width : width);
        for (let i = 0; i < bank.length; i++) {
            const next = (i + 1) % bank.length, a = bank[i], b = bank[next], ab = sub(b, a), length = distance(a, b),
                middleA = lerp(a, outer[i], .5), middleB = lerp(b, outer[next], .5);
            const intervals = [],
                ts = [0, ...urban.flatMap(p => intersections(middleA, middleB, p)), 1].sort((a, b) => a - b);
            for (let j = 1; j < ts.length; j++) if (!urban.length || urban.some(p => inside(lerp(middleA, middleB, (ts[j - 1] + ts[j]) / 2), p))) intervals.push([ts[j - 1], ts[j]]);
            for (const bridge of bridges.filter(b => b.river === river)) for (const point of [bridge.a, bridge.b, ...bridge.rails.flat()]) {
                const t = dot(sub(point, a), ab) / (dot(ab, ab) || 1);
                if (t < -EPS || t > 1 + EPS || distance(point, lerp(a, b, t)) > .01) continue;
                intervals.push([Math.max(0, t - width / length), Math.min(1, t + width / length)]);
            }
            intervals.sort((a, b) => a[0] - b[0]);
            const merged = [];
            for (const interval of intervals) {
                if (merged.length && interval[0] <= merged.at(-1)[1] + EPS) merged.at(-1)[1] = Math.max(merged.at(-1)[1], interval[1]);
                else merged.push([...interval]);
            }
            for (const [start, end] of merged) if (end - start > EPS) {
                const inner = [lerp(a, b, start), lerp(a, b, end)],
                    out = [lerp(outer[i], outer[next], start), lerp(outer[i], outer[next], end)];
                quays.push({
                    id: `quay-${quays.length}`,
                    river,
                    width,
                    inner,
                    outer: out,
                    polygon: [...inner, ...out.slice().reverse()],
                    points: [lerp(inner[0], out[0], .5), lerp(inner[1], out[1], .5)]
                });
            }
        }
    });
    return quays;
}

function quayConnection(end, quays, water) {
    const candidates = quays.map(q => {
        const d = sub(q.inner[1], q.inner[0]),
            t = Math.max(0, Math.min(1, dot(sub(end, q.inner[0]), d) / (dot(d, d) || 1)));
        return {quay: q, point: lerp(q.points[0], q.points[1], t), gap: distance(end, lerp(q.inner[0], q.inner[1], t))};
    }).filter(c => c.gap < .01).sort((a, b) => a.gap - b.gap);
    for (const c of candidates) if (clear(end, c.point, water)) return {
        points: [end, c.point],
        kind: 'quay',
        quay: c.quay.id
    };
    return {points: [], kind: 'quay'};
}

export function buildBridgeNetwork({
                                       roads,
                                       rivers,
                                       crossings = [],
                                       sea = [],
                                       footbridges = [],
                                       urban = [],
                                       ribbons: suppliedRibbons = null,
                                       excludeSeaBridges = false,
                                       waterRegions = null
                                   }) {
    const banks = rivers.map(r => riverBanks(r.points, r.width));
    const mouths = rivers.flatMap((river, i) => openRiverMouths(banks[i], river, sea).map(m => ({...m, river: i})));
    if (suppliedRibbons && suppliedRibbons.length !== rivers.length) throw new Error('Число контуров берегов не совпадает с числом рек.');
    const ribbons = suppliedRibbons || banks.map(([a, b]) => normalizeRibbon([...a, ...b.slice().reverse()])),
        water = waterRegions || [...ribbons, ...sea.filter(p => p.length > 2)];
    const bridges = combineOverlappingBridges(rivers.flatMap((r, i) => mergeCrossings(crossings[i] || [], roads, r.points, footbridges, r.width).map((c, j) => {
        const bridge = naturalBridge(c, r.points, ribbons[i], roads, `bridge-${i}-${j}`);
        if (!bridge) throw new Error('Не удалось состыковать мост с берегами.');
        return {...bridge, river: i, origins: c.origins};
    })), rivers, ribbons, roads).filter(b => !excludeSeaBridges || dryFootprint(b.polygon, waterRegions?.filter(r => r.kind === 'sea') || sea));
    const landings = bridges.filter(b => b.origins.length > 1).map(b => {
        const [x0, y0, x1, y1] = bounds(b.origins), pad = rivers[b.river].width * .6;
        return [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad], [x0 - pad, y1 + pad]];
    });
    const quays = buildQuays(ribbons, bridges, urban.length ? [...urban, ...landings] : []);
    const streets = roads.flatMap(road => dryPieces(road.points, water).map(points => ({...road, points})));
    const approaches = [];
    for (const bridge of bridges) {
        const routeIds = new Set(roads.filter(r => crossingHits([r], rivers[bridge.river].points).some(c => bridge.origins.some(p => distance(c.point, p) < .01))).map(r => r.id));
        for (const end of [bridge.a, bridge.b]) {
            let connection = null;
            const candidates = streets.filter(r => bridge.origins.length === 1 && routeIds.has(r.id)).flatMap(road => [0, road.points.length - 1].map(index => ({
                road,
                index,
                point: road.points[index]
            }))).sort((a, b) => distance(a.point, end) - distance(b.point, end));
            for (const candidate of candidates) {
                if (distance(end, candidate.point) > bridge.width || dot(sub(candidate.point, bridge.origin), sub(end, bridge.origin)) < 0) continue;
                const previous = candidate.road.points[candidate.index === 0 ? 1 : candidate.index - 1],
                    path = routeOnLand(end, previous, water);
                if (!path.length) continue;
                if (candidate.index === 0) candidate.road.points.splice(0, 2, ...path);
                else candidate.road.points.splice(candidate.index - 1, 2, ...path.slice().reverse());
                connection = {kind: 'road', road: candidate.road.id, points: path};
                break;
            }
            if (!connection) connection = quayConnection(end, quays.filter(q => q.river === bridge.river), water);
            if (!connection.points.length) {
                throw new Error('У моста нет выхода на дорогу или набережную.');
            }
            approaches.push({...connection, width: bridge.width, bridge: bridges.indexOf(bridge), end});
        }
    }
    return {bridges, streets, approaches, ribbons, quays, mouths};
}
