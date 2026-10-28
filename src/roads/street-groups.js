import {bounds, distance, segmentDistance} from '../core/geometry.js';
import {buildingIndex} from '../buildings/building-spatial.js';

// Only mutually straightest continuations share a name; side branches stay separate.
export function groupStreets(streets) {
    const parents = streets.map((_, i) => i), ids = new Map(), nodes = new Map(), index = buildingIndex([]);
    const root = i => parents[i] === i ? i : (parents[i] = root(parents[i]));
    const join = (a, b) => {
        a = root(a);
        b = root(b);
        parents[Math.max(a, b)] = Math.min(a, b);
    };
    streets.forEach((road, i) => {
        const id = String(road.id);
        if (ids.has(id)) join(i, ids.get(id));
        else ids.set(id, i);
        const points = road.points || (road.a && road.b ? [road.a, road.b] : []);
        for (const point of points) nodes.set(point.map(v => Math.round(v * 1e5)).join(','), point);
        for (let j = 1; j < points.length; j++) if (distance(points[j - 1], points[j]) > 1e-5) {
            index.add({a: points[j - 1], b: points[j], road: i, box: bounds([points[j - 1], points[j]])});
        }
    });
    for (const p of nodes.values()) {
        const rays = [];
        for (const edge of index.near([p[0] - 1e-5, p[1] - 1e-5, p[0] + 1e-5, p[1] + 1e-5])) {
            if (segmentDistance(p, edge.a, edge.b) > 1e-5) continue;
            for (const end of [edge.a, edge.b]) {
                const length = distance(p, end);
                if (length > 1e-5) rays.push({
                    road: edge.road,
                    direction: [(end[0] - p[0]) / length, (end[1] - p[1]) / length]
                });
            }
        }
        const best = rays.map((a, i) => {
            let choice = -1, score = -Math.cos(Math.PI / 4);
            rays.forEach((b, j) => {
                if (i === j) return;
                const dot = a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1];
                if (dot < score) {
                    score = dot;
                    choice = j;
                }
            });
            return choice;
        });
        best.forEach((j, i) => {
            if (j < 0 || best[j] !== i) return;
            const a = rays[i].road, b = rays[j].road;
            // A route passing through this junction already has its continuation.
            if (root(a) !== root(b) && [root(a), root(b)].some(group =>
                rays.filter(ray => root(ray.road) === group).length > 1)) return;
            // Wall circuits are independent routes even when an alley meets them tangentially.
            if (a !== b && /^(outer-)?wall-/.test(streets[a].id) !== /^(outer-)?wall-/.test(streets[b].id)) return;
            join(a, b);
        });
    }
    streets.forEach((road, i) => {
        road.streetId = String(streets[root(i)].id);
    });
}
