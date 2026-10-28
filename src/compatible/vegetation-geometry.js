import {distance, midpoint, norm, perimeter} from './math.js';

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = point => {
    const size = norm(point), inverse = size ? 1 / size : 0;
    return [point[0] * inverse, point[1] * inverse];
};
const average = sequence => (sequence.next() + sequence.next() + sequence.next()) / 3;

export function directInset(polygon, offsets) {
    return polygon.map((point, i) => {
        const prior = (i + polygon.length - 1) % polygon.length, before = subtract(point, polygon[prior]),
            after = subtract(polygon[(i + 1) % polygon.length], point);
        const cross = before[0] * after[1] - before[1] * after[0];
        if (cross === 0 && before[0] * after[0] + before[1] * after[1] > 0 && offsets[i] === offsets[prior]) {
            const scale = offsets[i] / norm(after);
            return [point[0] - after[1] * scale, point[1] + after[0] * scale];
        }
        const alongBefore = -offsets[i] / (cross / norm(after)), alongAfter = offsets[prior] / (cross / norm(before));
        return [point[0] + before[0] * alongBefore + after[0] * alongAfter, point[1] + before[1] * alongBefore + after[1] * alongAfter];
    });
}

export function resampleClosed(polygon, spacing) {
    const length = perimeter(polygon), count = Math.round(length / spacing);
    if (count < 1) return polygon.slice();
    const step = length / count, result = [polygon.at(-1)];
    let previous = polygon.at(-1), next = step, travelled = 0;
    for (const point of polygon) {
        const segment = distance(previous, point);
        while (travelled + segment > next) {
            const t = (next - travelled) / segment;
            result.push([previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t]);
            next += step;
        }
        travelled += segment;
        previous = point;
    }
    return result;
}

export function fractalBoundary(polygon, sequence, {depth = 2, chaos = .5} = {}) {
    const points = [];
    const split = (a, b, remaining) => {
        if (remaining <= 0) return;
        const middle = midpoint(a, b), normal = [a[1] - b[1], b[0] - a[0]],
            offset = chaos * (average(sequence) * 2 - 1),
            point = [middle[0] + normal[0] * offset, middle[1] + normal[1] * offset];
        split(a, point, remaining - 1);
        points.push(point);
        split(point, b, remaining - 1);
    };
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        points.push(a);
        split(a, b, depth);
    }
    return points;
}

export function smoothClosed(polygon, subdivisions = 5) {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length],
            previous = polygon[(i + polygon.length - 1) % polygon.length], after = polygon[(i + 2) % polygon.length];
        const incoming = unit(subtract(a, previous)), edge = unit(subtract(b, a)), outgoing = unit(subtract(after, b)),
            first = unit([incoming[0] + edge[0], incoming[1] + edge[1]]),
            second = unit([edge[0] + outgoing[0], edge[1] + outgoing[1]]);
        const firstDot = first[0] * edge[0] + first[1] * edge[1], secondDot = second[0] * edge[0] + second[1] * edge[1],
            scale = distance(a, b) * (1 / (1 + firstDot + secondDot));
        const controlA = [a[0] + first[0] * scale, a[1] + first[1] * scale],
            controlB = [b[0] - second[0] * scale, b[1] - second[1] * scale];
        result.push([...a]);
        for (let step = 1; step < subdivisions; step++) {
            const t = step / subdivisions, rest = 1 - t,
                weights = [rest * rest * rest, 3 * rest * rest * t, 3 * rest * t * t, t * t * t],
                points = [a, controlA, controlB, b];
            result.push([0, 1].map(axis => points.reduce((sum, p, index) => sum + p[axis] * weights[index], 0)));
        }
    }
    return result;
}
