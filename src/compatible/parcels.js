import {centroid, distance, lineParameters, norm} from './math.js';
import {clipSingle, contains, signedArea, stripe} from './polygons.js';

export {lineParameters} from './math.js';

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const along = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t];
const average = (sequence, count) => Array.from({length: count}, () => sequence.next()).reduce((a, b) => a + b, 0) / count;
const area = polygon => Math.abs(signedArea(polygon));

function polygonHull(polygon) {
    if (polygon.length <= 3) return [...polygon];
    const turn = (a, b, c) => cross(subtract(b, a), subtract(c, a));
    const [a, b, c] = polygon;
    const deque = turn(a, b, c) > 0 ? [c, a, b, c] : [c, b, a, c];
    for (const point of polygon.slice(3)) {
        if (turn(point, deque[0], deque[1]) >= 0 && turn(deque.at(-2), deque.at(-1), point) >= 0) continue;
        while (deque.length >= 2 && turn(deque.at(-2), deque.at(-1), point) < 0) deque.pop();
        deque.push(point);
        while (deque.length >= 2 && turn(point, deque[0], deque[1]) < 0) deque.shift();
        deque.unshift(point);
    }
    if (deque[0] === deque.at(-1)) deque.pop();
    return deque;
}

export function orientedBounds(polygon) {
    const hull = polygonHull(polygon);
    let chosen = null, smallest = Infinity;
    for (let index = 0; index < hull.length; index++) {
        const direction = subtract(hull[(index + 1) % hull.length], hull[index]), size = norm(direction);
        if (!size) continue;
        const inverse = 1 / size, x = direction[0] * inverse, y = direction[1] * inverse;
        const projected = hull.map(p => [p[0] * x + p[1] * y, p[1] * x - p[0] * y]);
        const xs = projected.map(p => p[0]), ys = projected.map(p => p[1]), left = Math.min(...xs),
            right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys),
            sizeArea = (right - left) * (bottom - top);
        if (sizeArea < smallest) {
            smallest = sizeArea;
            chosen = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([u, v]) => [u * x - v * y, v * x + u * y]);
        }
    }
    if (!chosen) throw new Error('Невозможно определить габариты участка.');
    return chosen;
}

function rotatedBounds(polygon, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle),
        points = polygon.map(([x, y]) => [x * cos - y * sin, y * cos + x * sin]);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]), left = Math.min(...xs), right = Math.max(...xs),
        top = Math.min(...ys), bottom = Math.max(...ys);
    return [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => [x * cos + y * sin, y * cos - x * sin]);
}

export function splitParcel(polygon, fromEdge, toEdge, chain) {
    const arc = (start, end) => {
        const points = [];
        for (let i = (start + 1) % polygon.length; ; i = (i + 1) % polygon.length) {
            points.push(polygon[i]);
            if (i === end) break;
        }
        return points;
    };
    return [[...arc(fromEdge, toEdge), ...chain.slice().reverse()], [...arc(toEdge, fromEdge), ...chain]];
}

export function cutPolygon(polygon, from, to, gap = 0) {
    const direction = subtract(to, from), hits = [];
    for (let edge = 0; edge < polygon.length; edge++) {
        const hit = lineParameters(from, direction, polygon[edge], subtract(polygon[(edge + 1) % polygon.length], polygon[edge]));
        if (hit && hit[1] >= 0 && hit[1] <= 1) hits.push({edge, t: hit[0]});
    }
    hits.sort((a, b) => a.t - b.t);
    if (hits.length < 2) return [polygon];
    const [a, b] = hits, first = along(from, direction, a.t), second = along(from, direction, b.t);
    const arc = (start, end) => {
        const points = [];
        for (let index = (start + 1) % polygon.length; ; index = (index + 1) % polygon.length) {
            points.push(polygon[index]);
            if (index === end) break;
        }
        return points;
    };
    const parts = [[first, ...arc(a.edge, b.edge), second], [second, ...arc(b.edge, a.edge), first]];
    if (gap > 0) {
        const peel = (part, point) => {
            const after = part[(part.indexOf(point) + 1) % part.length], edge = subtract(after, point),
                scale = (gap / 2) / norm(edge), normal = [-edge[1] * scale, edge[0] * scale];
            const origin = along(point, normal, 1), end = along(after, normal, 1);
            return cutPolygon(part, origin, end, 0)[0];
        };
        parts[0] = peel(parts[0], second);
        parts[1] = peel(parts[1], first);
    }
    const edge = subtract(polygon[(a.edge + 1) % polygon.length], polygon[a.edge]);
    return cross(direction, edge) > 0 ? parts : parts.reverse();
}

export class ParcelDivider {
    constructor(polygon, {
        minimumArea,
        variance = 10,
        minimumTurnOffset = 1,
        gap = null,
        processCut = null,
        isAtomic = null
    }, sequence) {
        this.polygon = polygon;
        this.minimumArea = minimumArea;
        this.variance = variance;
        this.minimumOffset = Math.sqrt(minimumArea);
        this.minimumTurnOffset = minimumTurnOffset;
        this.gap = gap;
        this.sequence = sequence;
        this.processCut = processCut;
        this.atomic = isAtomic;
        this.cuts = [];
    }

    partition() {
        let count = 0;
        const visit = (polygon, depth) => {
            if (++count > 30000 || depth > 200) throw new Error('Превышен предел деления участков.');
            const atomic = this.atomic ? this.atomic(polygon) : signedArea(polygon) < this.minimumArea * Math.pow(this.variance, Math.abs(average(this.sequence, 4) * 2 - 1));
            if (atomic) return [polygon];
            const parts = this.cut(polygon);
            return parts.length === 1 ? [polygon] : parts.flatMap(p => visit(p, depth + 1));
        };
        return visit(this.polygon, 0);
    }

    accept(polygon, from, to, chain) {
        const result = splitParcel(polygon, from, to, chain);
        this.cuts.push(chain);
        if (this.gap !== null) {
            const strip = stripe(chain, this.gap / 2);
            return result.map(part => clipSingle(part, strip, 'difference') || part);
        }
        return result;
    }

    cut(polygon) {
        for (let attempt = 0; attempt <= 10; attempt++) {
            const bounds = attempt ? rotatedBounds(polygon, attempt / 10 * Math.PI * 2) : orientedBounds(polygon);
            const origin = bounds[0];
            let long = subtract(bounds[1], origin), short = subtract(bounds[3], origin);
            if (norm(long) < norm(short)) [long, short] = [short, long];
            const length = norm(long), projection = dot(long, subtract(centroid(polygon), origin)) / (length * length),
                fraction = (projection + average(this.sequence, 3)) / 2;
            const initial = along(origin, long, fraction);
            let anchor = null, anchorEdge = -1, inward = null, score = 0;
            for (let index = 0; index < polygon.length; index++) {
                const edge = subtract(polygon[(index + 1) % polygon.length], polygon[index]), length = norm(edge);
                if (length < 1e-10) continue;
                const hit = lineParameters(initial, short, polygon[index], edge);
                if (!hit || hit[1] <= 0 || hit[1] >= 1) continue;
                const inverse = 1 / length, unit = [edge[0] * inverse, edge[1] * inverse],
                    alignment = Math.abs(dot(long, unit));
                if (alignment > score) {
                    score = alignment;
                    anchor = along(polygon[index], edge, hit[1]);
                    anchorEdge = index;
                    inward = [-unit[1], unit[0]];
                }
            }
            if (!anchor) continue;
            let exit = -1, travel = Infinity, terminal = null;
            for (let index = 0; index < polygon.length; index++) if (index !== anchorEdge) {
                const edge = subtract(polygon[(index + 1) % polygon.length], polygon[index]);
                if (norm(edge) < 1e-10) continue;
                const hit = lineParameters(anchor, inward, polygon[index], edge);
                if (hit && hit[0] > 0 && hit[0] < travel && hit[1] > 0 && hit[1] < 1) {
                    exit = index;
                    travel = hit[0];
                    terminal = edge;
                }
            }
            // Tangencies and collapsed edges can leave no forward exit after rounding.
            // Try another local cut instead of discarding the entire seeded city.
            if (exit < 0) continue;
            const ratio = parts => Math.max(area(parts[0]) / area(parts[1]), area(parts[1]) / area(parts[0]));
            const sine = cross(inward, terminal) ** 2 / dot(inward, inward) / dot(terminal, terminal);
            if (sine > .99) {
                const chain = [anchor, along(anchor, inward, travel)];
                if (ratio(splitParcel(polygon, anchorEdge, exit, chain)) < 2 * this.variance) return this.accept(polygon, anchorEdge, exit, chain);
            }
            const minimum = this.minimumOffset / travel,
                bendFraction = minimum > .5 ? .5 : minimum + (1 - 2 * minimum) * average(this.sequence, 3),
                bend = along(anchor, inward, travel * bendFraction);
            let end = null, endEdge = -1, bestAlignment = -Infinity;
            for (let index = 0; index < polygon.length; index++) if (index !== anchorEdge) {
                const edge = subtract(polygon[(index + 1) % polygon.length], polygon[index]), length = norm(edge);
                if (length < 1e-10) continue;
                const normal = [edge[1], -edge[0]], hit = lineParameters(bend, normal, polygon[index], edge),
                    alignment = cross(inward, edge) / length;
                if (!hit || hit[0] <= 0 || hit[1] <= 0 || hit[1] >= 1 || alignment <= bestAlignment) continue;
                let clear = true;
                for (let other = 0; other < polygon.length; other++) if (other !== index && other !== anchorEdge) {
                    const direction = subtract(polygon[(other + 1) % polygon.length], polygon[other]);
                    if (norm(direction) < 1e-10) continue;
                    const collision = lineParameters(bend, normal, polygon[other], direction);
                    if (collision && collision[0] >= 0 && collision[0] <= 1 && collision[1] >= 0 && collision[1] <= 1) {
                        clear = false;
                        break;
                    }
                }
                if (clear) {
                    end = along(polygon[index], edge, hit[1]);
                    endEdge = index;
                    bestAlignment = alignment;
                }
            }
            if (!end) continue;
            const raw = [anchor, bend, end];
            let chain = this.processCut ? this.processCut(raw) : area(raw) / distance(anchor, end) < this.minimumTurnOffset ? [anchor, end] : raw;
            for (let i = 1; i < chain.length - 2; i++) if (!contains(polygon, chain[i])) {
                chain = raw;
                break;
            }
            if (ratio(splitParcel(polygon, anchorEdge, endEdge, chain)) > 2 * this.variance) continue;
            return this.accept(polygon, anchorEdge, endEdge, chain);
        }
        return [polygon];
    }
}
