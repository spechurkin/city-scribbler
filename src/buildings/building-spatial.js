import {area, bounds, clip, cross, dot, inside, segmentSegmentDistance, signedArea, sub} from '../core/geometry.js';

export const footprints = b => [b.polygon, ...Object.entries(b.parts || {}).filter(([key]) => key !== 'court' || b.nativeLandmark).map(([, p]) => p), ...(b.fortification ? [b.fortification.polygon] : [])];
export const boxOf = b => bounds(footprints(b).flat());
export const boxesMeet = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

function convex(polygon) {
    const sign = Math.sign(signedArea(polygon));
    return polygon.every((p, i) => cross(sub(polygon[(i + 1) % polygon.length], p), sub(polygon[(i + 2) % polygon.length], polygon[(i + 1) % polygon.length])) * sign >= -1e-8);
}

function scanIntersectionArea(a, b) {
    const edges = p => p.map((v, i) => [v, p[(i + 1) % p.length]]);
    const all = [...edges(a), ...edges(b)], xs = [...a, ...b].map(p => p[0]);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const [p, q] = all[i], [r, s] = all[j], pq = sub(q, p), rs = sub(s, r), den = cross(pq, rs);
        if (Math.abs(den) < 1e-12) continue;
        const t = cross(sub(r, p), rs) / den, u = cross(sub(r, p), pq) / den;
        if (t > 0 && t < 1 && u > 0 && u < 1) xs.push(p[0] + t * pq[0]);
    }
    xs.sort((x, y) => x - y);
    const slices = (p, x) => edges(p).flatMap(([a, b]) => (a[0] < x) !== (b[0] < x) ? [a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0])] : []).sort((a, b) => a - b);
    let result = 0;
    // Between vertex/crossing events, every filled vertical interval changes linearly.
    for (let n = 1; n < xs.length; n++) {
        const width = xs[n] - xs[n - 1];
        if (width < 1e-10) continue;
        const x = (xs[n] + xs[n - 1]) / 2, left = slices(a, x), right = slices(b, x);
        let i = 0, j = 0, height = 0;
        while (i + 1 < left.length && j + 1 < right.length) {
            height += Math.max(0, Math.min(left[i + 1], right[j + 1]) - Math.max(left[i], right[j]));
            if (left[i + 1] < right[j + 1]) i += 2;
            else j += 2;
        }
        result += width * height;
    }
    return result;
}

function intersectionArea(a, b) {
    if (!boxesMeet(bounds(a), bounds(b))) return 0;
    if (!convex(a) || !convex(b)) return scanIntersectionArea(a, b);
    let intersection = a;
    const sign = Math.sign(signedArea(b));
    for (let i = 0; i < b.length && intersection.length >= 3; i++) {
        const edge = sub(b[(i + 1) % b.length], b[i]), normal = [edge[1] * sign, -edge[0] * sign];
        intersection = clip(intersection, normal, dot(normal, b[i]));
    }
    return intersection.length >= 3 ? area(intersection) : 0;
}

export function footprintIntersection(a, b) {
    return footprints(a).reduce((sum, p) => sum + footprints(b).reduce((n, q) => n + intersectionArea(p, q), 0), 0);
}

export function buildingIndex(buildings) {
    const sizes = buildings.map(b => {
        const box = boxOf(b);
        return Math.max(box[2] - box[0], box[3] - box[1]);
    }).sort((a, b) => a - b);
    const size = Math.max(4, sizes[Math.floor(sizes.length / 2)] || 16), cells = new Map(), large = [], all = [];
    const range = box => box.map(n => Math.floor(n / size));
    return {
        add(entry) {
            all.push(entry);
            const [x0, y0, x1, y1] = range(entry.box);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
                large.push(entry);
                return;
            }
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
                const key = `${x},${y}`;
                if (!cells.has(key)) cells.set(key, []);
                cells.get(key).push(entry);
            }
        },
        near(box) {
            const [x0, y0, x1, y1] = range(box);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return all;
            const found = new Set(large);
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const entry of cells.get(`${x},${y}`) || []) found.add(entry);
            return [...found];
        }
    };
}

export function hitsRoad(building, road) {
    const radius = road.width / 2;
    const box = bounds(road.points);
    if (!boxesMeet(boxOf(building), [box[0] - radius, box[1] - radius, box[2] + radius, box[3] + radius])) return false;
    return footprints(building).some(p => road.points.slice(1).some((b, i) => {
        const a = road.points[i];
        return inside(a, p) || inside(b, p) || p.some((q, j) => segmentSegmentDistance(q, p[(j + 1) % p.length], a, b) < radius - 1e-5);
    }));
}


