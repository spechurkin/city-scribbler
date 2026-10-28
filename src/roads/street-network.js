import {distance, lerp, segmentDistance} from '../core/geometry.js';

const EPS = 1e-6;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];

// Split junctions before pruning, so a branch can end on the middle of another road.
export function connectedStreets(streets, destinations = [], terminals = [], {allowTerminal = () => true} = {}) {
    const segments = [], pointAnchors = [];
    const add = (points, road, anchored, rooted = anchored) => {
        if (anchored && points.length === 1) pointAnchors.push({point: points[0], rooted});
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            if (distance(a, b) > EPS) segments.push({a, b, road, anchored, rooted, cuts: [0, 1]});
        }
    };
    streets.forEach(road => add(road.points, road, road.major));
    destinations.forEach(points => add(points, null, true));
    terminals.forEach(points => add(points, null, true, false));
    for (const {point} of pointAnchors) for (const segment of segments) {
        if (segmentDistance(point, segment.a, segment.b) > EPS) continue;
        const d = sub(segment.b, segment.a),
            t = ((point[0] - segment.a[0]) * d[0] + (point[1] - segment.a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2);
        segment.cuts.push(Math.max(0, Math.min(1, t)));
    }
    const ordered = segments.map(segment => ({
        segment,
        minX: Math.min(segment.a[0], segment.b[0]), maxX: Math.max(segment.a[0], segment.b[0]),
        minY: Math.min(segment.a[1], segment.b[1]), maxY: Math.max(segment.a[1], segment.b[1])
    })).sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
        const left = ordered[i], right = ordered[j];
        if (right.minX > left.maxX + EPS) break;
        if (left.maxY + EPS < right.minY || right.maxY + EPS < left.minY) continue;
        const first = left.segment, second = right.segment;
        if (first.anchored && second.anchored) continue;
        const {a, b} = first, {a: c, b: d} = second;
        if (Math.max(a[0], b[0]) + EPS < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + EPS < Math.min(a[0], b[0]) ||
            Math.max(a[1], b[1]) + EPS < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + EPS < Math.min(a[1], b[1])) continue;
        const ab = sub(b, a), cd = sub(d, c), denominator = cross(ab, cd);
        if (Math.abs(denominator) > EPS * distance(a, b) * distance(c, d)) {
            const t = cross(sub(c, a), cd) / denominator, u = cross(sub(c, a), ab) / denominator;
            if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
                first.cuts.push(Math.max(0, Math.min(1, t)));
                second.cuts.push(Math.max(0, Math.min(1, u)));
            }
        } else {
            for (const [segment, points] of [[first, [c, d]], [second, [a, b]]]) for (const point of points) {
                if (segmentDistance(point, segment.a, segment.b) > EPS) continue;
                const direction = sub(segment.b, segment.a), offset = sub(point, segment.a),
                    t = (offset[0] * direction[0] + offset[1] * direction[1]) / (direction[0] ** 2 + direction[1] ** 2);
                segment.cuts.push(Math.max(0, Math.min(1, t)));
            }
        }
    }
    const nodes = new Map(), pieces = [], edges = new Set();
    const node = point => {
        const key = point.map(value => Math.round(value / EPS)).join(',');
        if (!nodes.has(key)) nodes.set(key, {key, point, links: new Set(), anchored: false, rooted: false});
        return nodes.get(key);
    };
    for (const segment of segments) {
        const cuts = [...new Set(segment.cuts)].sort((a, b) => a - b);
        for (let i = 1; i < cuts.length; i++) {
            const a = node(lerp(segment.a, segment.b, cuts[i - 1])), b = node(lerp(segment.a, segment.b, cuts[i]));
            if (a === b) continue;
            if (segment.anchored) {
                for (const end of [a, b]) if (segment.road?.major || allowTerminal(end.point)) {
                    end.anchored = true;
                    end.rooted ||= segment.rooted;
                }
            } else {
                const key = [a.key, b.key].sort().join('|');
                if (edges.has(key)) continue;
                edges.add(key);
                const piece = {a, b, road: segment.road};
                a.links.add(piece);
                b.links.add(piece);
                pieces.push(piece);
            }
        }
    }
    for (const {point, rooted} of pointAnchors) {
        if (!allowTerminal(point)) continue;
        const end = node(point);
        end.anchored = true;
        end.rooted ||= rooted;
    }
    const queue = [...nodes.values()].filter(n => !n.anchored && n.links.size < 2);
    for (let i = 0; i < queue.length; i++) for (const piece of [...queue[i].links]) {
        piece.removed = true;
        for (const end of [piece.a, piece.b]) {
            end.links.delete(piece);
            if (!end.anchored && end.links.size === 1) queue.push(end);
        }
    }
    // A wall can receive an alley, but cannot connect otherwise isolated roads.
    const reachable = new Set([...nodes.values()].filter(n => n.rooted)), visit = [...reachable];
    for (let i = 0; i < visit.length; i++) for (const piece of visit[i].links) for (const end of [piece.a, piece.b]) {
        if (!reachable.has(end)) {
            reachable.add(end);
            visit.push(end);
        }
    }
    const result = streets.filter(road => road.major);
    let previous = null, path = null;
    for (const piece of pieces) {
        if (piece.removed || !reachable.has(piece.a)) {
            previous = null;
            continue;
        }
        if (previous === piece.road && path.points.at(-1) === piece.a.point) path.points.push(piece.b.point);
        else {
            path = {...piece.road, points: [piece.a.point, piece.b.point]};
            result.push(path);
        }
        previous = piece.road;
    }
    return result;
}
