export const EPS = 1e-6;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (p, k) => [p[0] * k, p[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const length = p => Math.hypot(...p);
export const distance = (a, b) => length(sub(a, b));
export const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const pointKey = p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
export const edgeKey = (a, b) => [pointKey(a), pointKey(b)].sort().join('|');

export function signedArea(poly) {
    return poly.reduce((sum, a, i) => sum + cross(a, poly[(i + 1) % poly.length]), 0) / 2;
}

export const area = poly => Math.abs(signedArea(poly));

export function centroid(poly) {
    const twiceArea = signedArea(poly) * 2;
    if (Math.abs(twiceArea) < EPS) return poly.reduce((s, p) => add(s, mul(p, 1 / poly.length)), [0, 0]);
    let c = [0, 0];
    poly.forEach((p, i) => {
        const q = poly[(i + 1) % poly.length];
        c = add(c, mul(add(p, q), cross(p, q)));
    });
    return mul(c, 1 / (3 * twiceArea));
}

export function clip(poly, normal, limit) {
    const result = [];
    if (!poly.length) return result;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const da = dot(a, normal) - limit, db = dot(b, normal) - limit;
        if (da <= EPS) result.push(a);
        if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) result.push(lerp(a, b, da / (da - db)));
    }
    return result.filter((p, i) => distance(p, result[(i + 1) % result.length]) > EPS);
}

export function inset(poly, amount) {
    let result = poly;
    const sign = signedArea(poly) >= 0 ? 1 : -1;
    for (let i = 0; i < poly.length && result.length > 2; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], d = sub(b, a);
        const n = mul([d[1], -d[0]], sign / length(d));
        result = clip(result, n, dot(a, n) - amount);
    }
    return result.length > 2 && area(result) > 1 ? result : [];
}

export function inside(p, poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
}

export function segmentDistance(p, a, b) {
    const ab = sub(b, a), denom = dot(ab, ab);
    return distance(p, lerp(a, b, denom ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / denom)) : 0));
}

export function pathDistance(p, path) {
    let d = Infinity;
    for (let i = 1; i < path.length; i++) d = Math.min(d, segmentDistance(p, path[i - 1], path[i]));
    return d;
}

export function segmentsIntersect(a, b, c, d) {
    const ab = sub(b, a), cd = sub(d, c), denom = cross(ab, cd);
    if (Math.abs(denom) < EPS) return false;
    const t = cross(sub(c, a), cd) / denom, u = cross(sub(c, a), ab) / denom;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
}

export function segmentSegmentDistance(a, b, c, d) {
    return segmentsIntersect(a, b, c, d) ? 0 : Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b));
}

export function bounds(poly) {
    return poly.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
}

export function rectangle(center, w, h, angle = 0) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => add(center, [x * c - y * s, x * s + y * c]));
}

export function voronoi(sites, bbox) {
    return sites.map((site, i) => {
        let poly = bbox;
        for (let j = 0; j < sites.length && poly.length > 2; j++) {
            if (i === j) continue;
            const other = sites[j], n = sub(other, site);
            poly = clip(poly, n, (dot(other, other) - dot(site, site)) / 2);
        }
        return poly;
    });
}

export function splitLots(poly, rng, target = 180, depth = 0) {
    if (poly.length < 3 || area(poly) < 32) return [];
    if (area(poly) < target * rng.range(0.8, 1.4) || depth >= 12) return [poly];
    let longest = [poly[0], poly[1]];
    for (let i = 0; i < poly.length; i++) if (distance(poly[i], poly[(i + 1) % poly.length]) > distance(...longest)) longest = [poly[i], poly[(i + 1) % poly.length]];
    const normal = mul(sub(longest[1], longest[0]), 1 / distance(...longest));
    const projections = poly.map(p => dot(p, normal));
    const offset = Math.min(...projections) + (Math.max(...projections) - Math.min(...projections)) * rng.range(0.38, 0.62);
    return [clip(poly, normal, offset), clip(poly, mul(normal, -1), -offset)].flatMap(p => splitLots(p, rng, target, depth + 1));
}

export function shortestPath(nodes, adjacency, start, finish) {
    const costs = new Map([[start, 0]]), previous = new Map(), open = new Set([start]);
    while (open.size) {
        let current;
        for (const id of open) if (current === undefined || costs.get(id) < costs.get(current)) current = id;
        if (current === finish) break;
        open.delete(current);
        for (const edge of adjacency.get(current) || []) {
            const cost = costs.get(current) + edge.cost;
            if (cost < (costs.get(edge.to) ?? Infinity)) {
                costs.set(edge.to, cost);
                previous.set(edge.to, {from: current, edge: edge.id});
                open.add(edge.to);
            }
        }
    }
    if (!costs.has(finish)) return [];
    const path = [];
    for (let at = finish; at !== start;) {
        const p = previous.get(at);
        if (!p) return [];
        path.unshift(p.edge);
        at = p.from;
    }
    return path;
}
