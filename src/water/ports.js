import {
    area,
    centroid,
    distance,
    inside,
    lerp,
    rectangle,
    segmentDistance,
    segmentSegmentDistance
} from '../core/geometry.js';
import {dryPieces} from '../roads/bridge-network.js';
import {waterGeometry} from './water-geometry.js';

const polygon = r => r.polygon || r;
const rings = r => [polygon(r), ...(r.holes || [])];
const wet = (p, water) => water.some(r => inside(p, polygon(r)) && !(r.holes || []).some(h => inside(p, h)));
const segments = p => p.map((a, i) => [a, p[(i + 1) % p.length]]);

export function inhabitedBank(buildings, radius = 60) {
    const grid = new Map(), key = (x, y) => `${x},${y}`;
    for (const building of buildings) {
        if (!building.polygon || building.kind && building.kind !== 'house') continue;
        const p = centroid(building.polygon), cell = key(Math.floor(p[0] / radius), Math.floor(p[1] / radius));
        if (!grid.has(cell)) grid.set(cell, []);
        grid.get(cell).push(p);
    }
    return point => {
        const x = Math.floor(point[0] / radius), y = Math.floor(point[1] / radius);
        let homes = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const p of grid.get(key(x + dx, y + dy)) || []) {
            if (distance(point, p) <= radius && ++homes >= 2) return true;
        }
        return false;
    };
}

export function portCount(docks) {
    const remaining = new Set(docks.map((_, i) => i));
    let count = 0;
    while (remaining.size) {
        const queue = [remaining.values().next().value];
        remaining.delete(queue[0]);
        count++;
        for (const i of queue) for (const j of remaining) if (distance(docks[i].points[0], docks[j].points[0]) < 85) {
            remaining.delete(j);
            queue.push(j);
        }
    }
    return count;
}

export function portContext(city) {
    const water = city.editor?.water ? waterGeometry(city) : [...city.terrain.sea, ...city.terrain.ribbons];
    return {water, docks: city.docks, bridges: city.bridges, walls: city.walls};
}

// Sample exposed banks of the water union: internal river/sea seams cannot host a port.
export function bankSites(water) {
    const result = [];
    for (const region of water) for (const ring of rings(region)) for (const [a, b] of segments(ring)) {
        const length = distance(a, b);
        if (length < 1e-6) continue;
        const tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
        const steps = Math.max(1, Math.ceil(length / 12));
        for (let i = 0; i < steps; i++) {
            const point = lerp(a, b, (i + .5) / steps);
            for (const sign of [1, -1]) {
                const normal = [-tangent[1] * sign, tangent[0] * sign];
                const at = d => [point[0] + normal[0] * d, point[1] + normal[1] * d];
                if (!wet(at(-1), water) && wet(at(1), water)) result.push({point, normal});
            }
        }
    }
    return result;
}

function pierAt(site, {water, docks = [], bridges = [], walls = []}) {
    const {point: a, normal: n} = site;
    const back = [a[0] - n[0] * 8, a[1] - n[1] * 8];
    if (walls.some(w => (w.polygon ? segments(w.polygon) : [[w.a, w.b]]).some(([p, q], i) => p && q && w.segments?.[i] !== false && segmentSegmentDistance(back, a, p, q) < 3))) return null;
    for (const length of [32, 24, 16]) {
        const b = [a[0] + n[0] * length, a[1] + n[1] * length];
        if (dryPieces([a, b], water).length || !wet(b, water)) continue;
        const side = [-n[1] * 2.4, n[0] * 2.4];
        if ([-1, 1].some(sign => dryPieces([[a[0] + side[0] * sign + n[0], a[1] + side[1] * sign + n[1]], [b[0] + side[0] * sign, b[1] + side[1] * sign]], water).length)) continue;
        if (bridges.some(bridge => segmentSegmentDistance(a, b, bridge.a, bridge.b) < bridge.width / 2 + 8)) continue;
        if (docks.some(d => d.points && segmentSegmentDistance(a, b, d.points[0], d.points.at(-1)) < 14)) continue;
        return {points: [a, b], width: 4.8};
    }
    return null;
}

export function planPort(context, point, {count = 4, maxDistance = 65, sites = bankSites(context.water)} = {}) {
    const nearby = sites.filter(s => distance(point, s.point) <= maxDistance).sort((a, b) => distance(point, a.point) - distance(point, b.point));
    for (const site of nearby) {
        const first = pierAt(site, context);
        if (!first) continue;
        const docks = [first];
        for (const candidate of sites.filter(s => distance(s.point, site.point) <= count * 13 && s.normal[0] * site.normal[0] + s.normal[1] * site.normal[1] > .7).sort((a, b) => distance(a.point, site.point) - distance(b.point, site.point))) {
            const pier = pierAt(candidate, {...context, docks: [...(context.docks || []), ...docks]});
            if (pier) docks.push(pier);
            if (docks.length >= count) break;
        }
        if (docks.length >= 2) return {ok: true, docks};
    }
    return {
        ok: false,
        message: 'Нет свободного берега для порта. Выберите участок ближе к воде, вдали от мостов, стен и других причалов.'
    };
}

export function additionalPorts(city, urban) {
    const context = portContext(city), added = [];
    let target = portCount(city.docks) + Math.max(0, Math.ceil(city.options.size / 24) - 1);
    const inhabited = inhabitedBank(city.buildings || []);
    const sites = bankSites(context.water).filter(s => inhabited(s.point) && urban.some(p => inside(s.point, p) || segments(p).some(([a, b]) => segmentDistance(s.point, a, b) < 35)));
    const wall = city.options.walls !== false && context.walls.filter(w => w.polygon).sort((a, b) => area(b.polygon) - area(a.polygon))[0];
    const outside = wall ? urban.filter(p => !inside(centroid(p), wall.polygon)) : [];
    const fishing = sites.filter(s => !inside(s.point, wall?.polygon || []) && outside.some(p => inside(s.point, p) || segments(p).some(([a, b]) => segmentDistance(s.point, a, b) < 35)));
    let count = portCount(context.docks);
    let fishingLeft = fishing.length ? Math.max(1, Math.ceil(city.options.size / 60)) : 0;
    target = Math.max(target, count + fishingLeft);
    while (count < target) {
        const docks = [...context.docks, ...added];
        const fishingPort = fishingLeft > 0;
        const available = fishingPort ? fishing : sites;
        const ranked = available.map(s => ({
            site: s,
            clearance: Math.min(Infinity, ...docks.filter(d => d.points).map(d => distance(s.point, d.points[0])))
        })).filter(s => s.clearance > (fishingPort ? 100 : 150)).sort((a, b) => b.clearance - a.clearance);
        let plan;
        for (const {site} of ranked) {
            const candidate = planPort({...context, docks}, site.point, {
                sites: available,
                count: fishingPort ? 3 + Number(city.options.size >= 60) : 3 + Math.floor(city.options.size / 50),
                maxDistance: 1
            });
            if (fishingPort && candidate.ok && candidate.docks.length < 3) continue;
            if (candidate.ok) {
                plan = candidate;
                break;
            }
        }
        if (!plan) {
            if (fishingPort) {
                fishingLeft = 0;
                continue;
            }
            break;
        }
        added.push(...plan.docks);
        if (fishingPort) for (const dock of plan.docks) dock.portKind = 'fishing';
        if (fishingPort) fishingLeft--;
        count++;
    }
    return added;
}

export function applyPort(city, plan) {
    if (!plan.ok) throw new Error(plan.message);
    const docks = structuredClone(plan.docks);
    if (city.editor.baseFormat === 'legacy') for (const d of docks) {
        const [a, b] = d.points;
        d.origin = a;
        d.tip = b;
        d.angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        d.polygon = rectangle(lerp(a, b, .5), distance(a, b), d.width, d.angle);
    }
    city.docks.push(...docks);
    city.editor.water.source.docks.push(...structuredClone(docks));
    if (city.imported) city.imported.planks.push(...structuredClone(docks));
}
