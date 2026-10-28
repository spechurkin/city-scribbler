import {distance} from './math.js';
import {signedArea} from './polygons.js';
import {cutPolygon} from './parcels.js';

export function shrinkPolygon(polygon, offsets) {
    let result = polygon.slice();
    for (let i = 0; i < polygon.length; i++) {
        const amount = typeof offsets === 'number' ? offsets : offsets[i];
        if (!(amount > 0)) continue;
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], scale = amount / distance(a, b),
            normal = [-(b[1] - a[1]) * scale, (b[0] - a[0]) * scale];
        result = cutPolygon(result, [a[0] + normal[0], a[1] + normal[1]], [b[0] + normal[0], b[1] + normal[1]])[0];
    }
    return result;
}

function anchoredRectangle(polygon, edge, minimum) {
    const a = polygon[edge], b = polygon[(edge + 1) % polygon.length], inverse = 1 / distance(a, b),
        ux = (b[0] - a[0]) * inverse, uy = (b[1] - a[1]) * inverse;
    const local = polygon.map(([x, y]) => [-ux * x - uy * y, -ux * y + uy * x]);
    const left = local[(edge + 1) % local.length][0], right = local[edge][0], top = local[edge][1];
    if (!(right > left)) return null;
    const segments = [];
    for (let i = 0; i < local.length; i++) {
        const p = local[i], q = local[(i + 1) % local.length];
        if (q[0] <= p[0] || q[0] < left || p[0] > right) continue;
        const slope = (q[1] - p[1]) / (q[0] - p[0]), intercept = p[1] - slope * p[0];
        const start = Math.max(left, p[0]), end = Math.min(right, q[0]);
        if (end > start && slope * ((start + end) / 2) + intercept < top + 1e-8) segments.push({
            start,
            end,
            slope,
            intercept
        });
    }
    const breaks = [...new Set([left, right, ...segments.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b),
        profile = [];
    for (let i = 1; i < breaks.length; i++) {
        const start = breaks[i - 1], end = breaks[i], middle = (start + end) / 2;
        const active = segments.filter(s => s.start <= middle && s.end >= middle);
        if (!active.length) continue;
        const boundary = active.reduce((best, s) => s.slope * middle + s.intercept > best.slope * middle + best.intercept ? s : best);
        profile.push({...boundary, start, end});
    }
    if (!profile.length) return null;
    const intervals = height => {
        const components = [];
        for (const segment of profile) {
            let start = segment.start, end = segment.end, leftSlope = 0, rightSlope = 0, leftOffset = start,
                rightOffset = end;
            const first = segment.slope * start + segment.intercept, last = segment.slope * end + segment.intercept;
            if (first > height && last > height) continue;
            if (first > height) {
                start = (height - segment.intercept) / segment.slope;
                leftSlope = 1 / segment.slope;
                leftOffset = -segment.intercept / segment.slope;
            }
            if (last > height) {
                end = (height - segment.intercept) / segment.slope;
                rightSlope = 1 / segment.slope;
                rightOffset = -segment.intercept / segment.slope;
            }
            if (end <= start) continue;
            const previous = components.at(-1);
            if (previous && Math.abs(previous.end - start) < 1e-8) {
                previous.end = end;
                previous.rightSlope = rightSlope;
                previous.rightOffset = rightOffset;
            } else components.push({start, end, leftSlope, rightSlope, leftOffset, rightOffset});
        }
        return components;
    };
    const levels = [...new Set([top, ...profile.flatMap(s => [s.slope * s.start + s.intercept, s.slope * s.end + s.intercept])])].filter(value => value <= top).sort((a, b) => a - b);
    let best = null, maximum = 0;
    const evaluate = height => {
        for (const component of intervals(height)) {
            const width = component.end - component.start, depth = top - height;
            if (minimum && ![[minimum.width, minimum.depth], [minimum.depth, minimum.width]].some(([w, h]) => width >= w - 1e-7 && depth >= h - 1e-7)) continue;
            const area = depth * width;
            if (area > maximum) {
                maximum = area;
                best = {left: component.start, right: component.end, bottom: height};
            }
        }
    };
    for (const level of levels) evaluate(level);
    if (minimum) for (const depth of [minimum.width, minimum.depth]) evaluate(top - depth);
    for (let i = 1; i < levels.length; i++) {
        const low = levels[i - 1], high = levels[i], middle = (low + high) / 2;
        for (const component of intervals(middle)) {
            const slope = component.rightSlope - component.leftSlope,
                offset = component.rightOffset - component.leftOffset;
            if (minimum && Math.abs(slope) > 1e-12) for (const width of [minimum.width, minimum.depth]) {
                const height = (width - offset) / slope;
                if (height > low && height < high) evaluate(height);
            }
            if (slope <= 0) continue;
            const height = (slope * top - offset) / (2 * slope);
            if (height > low && height < high) evaluate(height);
        }
    }
    if (!best) return null;
    return {
        area: maximum,
        polygon: [[best.right, top], [best.left, top], [best.left, best.bottom], [best.right, best.bottom]].map(([x, y]) => [-ux * x + uy * y, -ux * y - uy * x])
    };
}

export function inscribedRectangle(polygon, minimum = null) {
    if (polygon.length < 3 || !(signedArea(polygon) > 0)) throw new Error('Для вписанного прямоугольника нужен положительно ориентированный полигон.');
    let result = null, maximum = -Infinity;
    for (let edge = 0; edge < polygon.length; edge++) {
        if (distance(polygon[edge], polygon[(edge + 1) % polygon.length]) < 1e-12) continue;
        const rectangle = anchoredRectangle(polygon, edge, minimum);
        if (rectangle && rectangle.area > maximum) {
            maximum = rectangle.area;
            result = rectangle.polygon;
        }
    }
    if (!result && !minimum) throw new Error('В участке не найден вписанный прямоугольник.');
    return result;
}
