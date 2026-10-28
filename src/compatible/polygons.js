import {distance, lineParameters} from './math.js';

const EPSILON = 1e-8;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function signedArea(polygon) {
    let sum = 0, previous = polygon.at(-1);
    for (const point of polygon) {
        sum += cross(previous, point);
        previous = point;
    }
    return sum * .5;
}

export function contains(polygon, point) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

function edges(polygon) {
    return polygon.map((a, i) => ({a, b: polygon[(i + 1) % polygon.length], cuts: [0, 1], hits: []}));
}

function intersect(a, b) {
    const first = subtract(a.b, a.a), second = subtract(b.b, b.a), offset = subtract(b.a, a.a),
        denominator = cross(first, second);
    if (Math.abs(denominator) > 1e-12) {
        const [t, u] = lineParameters(a.a, first, b.a, second);
        if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
            a.cuts.push(Math.max(0, Math.min(1, t)));
            b.cuts.push(Math.max(0, Math.min(1, u)));
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                a.hits.push(t);
                b.hits.push(u);
            }
        }
    } else if (Math.abs(cross(offset, first)) < EPSILON) {
        for (const [edge, other] of [[a, b], [b, a]]) {
            const direction = subtract(edge.b, edge.a), length = direction[0] ** 2 + direction[1] ** 2;
            if (!length) continue;
            for (const point of [other.a, other.b]) {
                const from = subtract(point, edge.a), t = (from[0] * direction[0] + from[1] * direction[1]) / length;
                if (t >= 0 && t <= 1) edge.cuts.push(t);
            }
        }
    }
}

export function polygonBoolean(subject, clip, operation = 'difference') {
    if (!['difference', 'intersection', 'union'].includes(operation)) throw new Error('Неизвестная операция с многоугольниками.');
    if (subject.length < 3 || clip.length < 3) return operation === 'intersection' ? [] : subject.length ? [subject] : [];
    if (operation === 'difference' && signedArea(clip) > 0) clip = clip.slice().reverse();
    const a = edges(subject), b = edges(clip);
    for (const first of a) for (const second of b) intersect(first, second);
    const nodes = new Map(), directed = new Map();
    const node = point => {
        const key = `${Math.round(point[0] / EPSILON)}:${Math.round(point[1] / EPSILON)}`;
        if (!nodes.has(key)) nodes.set(key, {point, key, outgoing: []});
        return nodes.get(key);
    };
    const filled = point => {
        const left = contains(subject, point), right = contains(clip, point);
        return operation === 'difference' ? left && !right : operation === 'intersection' ? left && right : left || right;
    };
    for (const edge of [...a, ...b]) {
        const cuts = [...new Set(edge.cuts)].sort((x, y) => x - y);
        for (let i = 1; i < cuts.length; i++) {
            const at = t => t === 0 ? edge.a : t === 1 ? edge.b : lerp(edge.a, edge.b, t);
            let start = node(at(cuts[i - 1])), end = node(at(cuts[i]));
            if (start === end) continue;
            const middle = lerp(start.point, end.point, .5), direction = subtract(end.point, start.point),
                length = distance(start.point, end.point);
            const probe = Math.min(length * 1e-5, 1e-6),
                normal = [-direction[1] / length * probe, direction[0] / length * probe];
            const left = filled([middle[0] + normal[0], middle[1] + normal[1]]),
                right = filled([middle[0] - normal[0], middle[1] - normal[1]]);
            if (left === right) continue;
            if (!left) [start, end] = [end, start];
            const key = `${start.key}>${end.key}`;
            if (!directed.has(key)) {
                const segment = {start, end, used: false};
                directed.set(key, segment);
                start.outgoing.push(segment);
            }
        }
    }
    const polygons = [];
    for (const first of directed.values()) if (!first.used) {
        const polygon = [];
        let edge = first;
        for (let step = 0; step <= directed.size; step++) {
            if (edge.used) throw new Error('Граница булевой операции пересекает саму себя.');
            edge.used = true;
            polygon.push(edge.start.point);
            if (edge.end === first.start) break;
            const candidates = edge.end.outgoing.filter(e => !e.used);
            if (!candidates.length) throw new Error('Незамкнутая граница булевой операции.');
            const incoming = subtract(edge.end.point, edge.start.point);
            const angle = next => {
                const outgoing = subtract(next.end.point, next.start.point);
                return Math.atan2(cross(incoming, outgoing), incoming[0] * outgoing[0] + incoming[1] * outgoing[1]);
            };
            edge = candidates.reduce((best, e) => angle(e) > angle(best) ? e : best);
            if (step === directed.size) throw new Error('Булева операция не завершилась.');
        }
        if (polygon.length >= 3 && Math.abs(signedArea(polygon)) > EPSILON) {
            let rotation = -1;
            for (const edge of a) {
                for (const t of edge.hits.sort((x, y) => x - y)) {
                    const point = lerp(edge.a, edge.b, t), index = polygon.findIndex(p => distance(p, point) < EPSILON);
                    if (index >= 0) {
                        rotation = index;
                        break;
                    }
                }
                if (rotation >= 0) break;
            }
            polygons.push(rotation > 0 ? [...polygon.slice(rotation), ...polygon.slice(0, rotation)] : polygon);
        }
    }
    return polygons;
}

export function largestPolygon(polygons) {
    const outer = polygons.filter(p => signedArea(p) > 0);
    return outer.length ? outer.reduce((best, p) => signedArea(p) > signedArea(best) ? p : best) : null;
}

export function clipSingle(subject, clip, operation = 'difference') {
    if (!['difference', 'intersection'].includes(operation)) throw new Error('Неподдерживаемая операция для одного контура.');
    if (operation === 'difference' && signedArea(clip) > 0) clip = clip.slice().reverse();
    const rings = [subject, clip], events = rings.map(p => p.map(() => []));
    for (let i = 0; i < subject.length; i++) for (let j = 0; j < clip.length; j++) {
        const a = subject[i], b = subject[(i + 1) % subject.length], c = clip[j], d = clip[(j + 1) % clip.length];
        const hit = lineParameters(a, subtract(b, a), c, subtract(d, c));
        if (hit && hit.every(t => t >= 0 && t <= 1)) {
            const crossing = {point: lerp(a, b, hit[0]), parameters: hit};
            events[0][i].push(crossing);
            events[1][j].push(crossing);
        }
    }
    if (!events[0].some(list => list.length)) {
        if (contains(subject, clip[0])) return operation === 'difference' ? subject : clip;
        if (contains(clip, subject[0])) return operation === 'difference' ? null : subject;
        return operation === 'difference' ? subject : null;
    }
    const augmented = rings.map((ring, side) => ring.flatMap((point, i) => [point, ...events[side][i].sort((a, b) => a.parameters[side] - b.parameters[side]).map(e => e.point)]));
    const crossingPoints = new Set(events[0].flatMap(list => list.map(event => event.point))),
        start = augmented[0].findIndex(p => crossingPoints.has(p));
    const keep = point => operation === 'difference' ? !contains(clip, point) : contains(clip, point);
    let side = keep(lerp(augmented[0][start], augmented[0][(start + 1) % augmented[0].length], .5)) ? 0 : 1;
    const first = augmented[0][start], result = [];
    let index = augmented[side].indexOf(first);
    for (let steps = 0; steps < augmented[0].length + augmented[1].length + 1; steps++) {
        result.push(augmented[side][index]);
        const next = (index + 1) % augmented[side].length, point = augmented[side][next];
        if (point === first) return result;
        if (crossingPoints.has(point)) {
            side = 1 - side;
            index = augmented[side].indexOf(point);
        } else index = next;
    }
    return largestPolygon(polygonBoolean(subject, clip, operation));
}

function lineIntersection(a, d, b, e) {
    const denominator = cross(d, e);
    if (Math.abs(denominator) < 1e-12) return null;
    const [t] = lineParameters(a, d, b, e);
    return [a[0] + d[0] * t, a[1] + d[1] * t];
}

export function stripe(points, halfWidth) {
    if (points.length < 2) throw new Error('У полосы должны быть хотя бы две точки.');
    const directions = points.slice(1).map((p, i) => {
        const d = subtract(p, points[i]), inverse = 1 / distance(p, points[i]);
        return [d[0] * inverse, d[1] * inverse];
    });
    const side = sign => points.map((p, i) => {
        const direction = directions[Math.min(i, directions.length - 1)],
            tangent = [direction[0] * halfWidth, direction[1] * halfWidth],
            normal = [-tangent[1] * sign, tangent[0] * sign];
        if (i === 0 || i === points.length - 1) {
            const cap = i === 0 ? -1 : 1;
            return [p[0] + tangent[0] * cap + normal[0], p[1] + tangent[1] * cap + normal[1]];
        }
        const before = directions[i - 1], dot = before[0] * direction[0] + before[1] * direction[1],
            sum = [before[0] + direction[0], before[1] + direction[1]];
        const bisector = [-sum[1], sum[0]], target = halfWidth * Math.sqrt(2 / (1 + dot)),
            scale = target / Math.sqrt(bisector[0] * bisector[0] + bisector[1] * bisector[1]);
        return [p[0] + bisector[0] * scale * sign, p[1] + bisector[1] * scale * sign];
    });
    return [...side(-1), ...side(1).reverse()];
}

export function variableInset(polygon, offsets) {
    if (polygon.length !== offsets.length) throw new Error('Количество отступов не соответствует рёбрам.');
    if (offsets.every(offset => offset === 0)) return polygon;
    let result = polygon;
    let start = offsets.findIndex((offset, i) => offset !== offsets[(i + offsets.length - 1) % offsets.length]);
    if (start < 0) start = 0;
    let index = start;
    do {
        const width = offsets[index], chain = [polygon[index]];
        do {
            index = (index + 1) % polygon.length;
            chain.push(polygon[index]);
        } while (index !== start && offsets[index] === width);
        if (width > 0) {
            const parts = chain[0] === chain.at(-1) ? [chain.slice(0, 2), chain.slice(1)] : [chain];
            for (const part of parts) {
                const next = clipSingle(result, stripe(part, width), 'difference');
                if (next) result = next;
            }
        }
    } while (index !== start);
    return result;
}
