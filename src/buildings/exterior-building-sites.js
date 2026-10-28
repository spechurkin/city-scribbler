import {bounds, distance, rectangle} from '../core/geometry.js';
import {buildingIndex} from './building-spatial.js';
import {pointInRegions, regionMasks} from './building-placement-rules.js';

export function exteriorBuildingSites(city, roads, rng, urban) {
    const [x0, y0, x1, y1] = bounds(city.districts.flatMap(d => d.polygon)),
        margin = Math.max(150, Math.min(600, Math.max(x1 - x0, y1 - y0) * .35)),
        frame = rectangle([(x0 + x1) / 2, (y0 + y1) / 2], x1 - x0 + margin * 2, y1 - y0 + margin * 2),
        region = {polygon: frame}, candidates = [], seen = new Set();
    const index = buildingIndex([]);
    for (const mask of [...urban, ...regionMasks(city.fields)]) index.add({mask, box: bounds(mask.polygon)});
    const water = [...city.terrain.sea, ...city.terrain.ribbons].map(polygon => ({polygon}));
    const add = point => {
        if (point[0] < x0 - margin || point[0] > x1 + margin || point[1] < y0 - margin || point[1] > y1 + margin) return;
        const key = point.map(n => Math.round(n / 5)).join(':');
        if (seen.has(key)) return;
        seen.add(key);
        if (pointInRegions(point, index.near([point[0] - 1, point[1] - 1, point[0] + 1, point[1] + 1]).map(e => e.mask)) || pointInRegions(point, water)) return;
        candidates.push({point, region, district: null});
    };
    for (const cell of city.generatedGeometry?.cells || []) if (!cell.urban && !cell.water && cell.ward !== 'farm') {
        const points = cell.polygon.map(([x, y]) => [x, -y]);
        add(points.reduce((sum, p) => sum.map((n, i) => n + p[i] / points.length), [0, 0]));
    }
    for (const road of roads) {
        const [a, b] = road.points, length = distance(a, b);
        if (!length) continue;
        const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length],
            steps = Math.min(150, Math.max(1, Math.ceil(length / 36)));
        for (let i = 0; i <= steps; i++) for (const offset of [18, 30, 50, 75]) for (const side of [-1, 1]) {
            add(a.map((n, axis) => n + (b[axis] - n) * i / steps + normal[axis] * (offset + road.width / 2) * side));
        }
    }
    for (const d of city.districts) for (const ring of d.rings || [d.polygon]) ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length], length = distance(a, b);
        if (!length) return;
        const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
        for (const fraction of [.25, .5, .75]) for (const offset of [25, 55, 100]) for (const side of [-1, 1]) {
            add(a.map((n, axis) => n + (b[axis] - n) * fraction + normal[axis] * offset * side));
        }
    });
    for (let i = 0; i < 600; i++) add([rng.range(x0 - margin, x1 + margin), rng.range(y0 - margin, y1 + margin)]);
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates;
}
