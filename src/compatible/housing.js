import {cutPolygon, lineParameters, orientedBounds, ParcelDivider} from './parcels.js';
import {clipSingle, signedArea} from './polygons.js';
import {insetAvailable, towerRadius} from './available.js';
import {Sequence} from './sequence.js';
import {centroid, distance, norm, perimeter} from './math.js';

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const along = (a, b, t) => [a[0] + b[0] * t, a[1] + b[1] * t];
const area = polygon => Math.abs(signedArea(polygon));
const average = (rng, count) => Array.from({length: count}, () => rng.next()).reduce((a, b) => a + b, 0) / count;
const center = polygon => {
    const sum = polygon.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]), inverse = 1 / polygon.length;
    return [sum[0] * inverse, sum[1] * inverse];
};

function barycentric(a, b, c, p) {
    const denominator = cross(subtract(b, a), subtract(c, a));
    if (!denominator) return null;
    const u = cross(subtract(b, p), subtract(c, p)) / denominator,
        v = cross(subtract(c, p), subtract(a, p)) / denominator;
    return [u, v, cross(subtract(a, p), subtract(b, p)) / denominator];
}

function triangulate(polygon) {
    const remaining = polygon.map((_, i) => i), triangles = [];
    let cursor = remaining.length - 1, misses = 0;
    while (remaining.length > 2) {
        const indices = [remaining[(cursor + remaining.length - 1) % remaining.length], remaining[cursor], remaining[(cursor + 1) % remaining.length]],
            points = indices.map(index => polygon[index]);
        const turn = (a, b, c) => cross(subtract(b, a), subtract(c, b));
        let ear = turn(...points) > 0;
        if (ear) for (let j = 0; j < remaining.length; j++) if (!indices.includes(remaining[j])) {
            const point = polygon[remaining[j]],
                before = polygon[remaining[(j + remaining.length - 1) % remaining.length]],
                after = polygon[remaining[(j + 1) % remaining.length]];
            if (turn(before, point, after) <= 0 && barycentric(...points, point)?.every(value => value >= 0)) {
                ear = false;
                break;
            }
        }
        if (ear) {
            triangles.push(indices);
            remaining.splice(cursor, 1);
            cursor = (cursor + 1) % remaining.length;
            misses = 0;
        } else {
            cursor = (cursor + 1) % remaining.length;
            if (++misses >= remaining.length) break;
        }
    }
    return triangles;
}

function interpolate(shape, triangles, weights, point) {
    for (const triangle of triangles) {
        const coordinates = barycentric(...triangle.map(i => shape[i]), point);
        if (coordinates?.every(value => value >= 0)) return coordinates.reduce((sum, value, i) => sum + value * weights[triangle[i]], 0);
    }
    return NaN;
}

function groupAvailable(terrain, group, sequence) {
    const corners = [], offsets = [];
    for (const edge of group.border) {
        let radius = towerRadius(terrain, edge.point);
        if (radius > 0) radius += 1.2;
        for (const river of terrain.rivers) if (river.course.some(e => e.point === edge.point)) radius = river.width / 2 + 1.2 + (river.course[0].point === edge.point ? 1.2 : 0);
        corners.push(radius);
        offsets.push(!edge.kind ? terrain.options.plaza && edge.twin?.cell === terrain.plaza ? 1 : .6 : edge.kind === 'coast' ? (edge.cell.landing ? 2 : 1.2) : edge.kind === 'road' ? 1 : edge.kind === 'wall' ? 2.15 : edge.kind === 'canal' ? terrain.rivers[0].width / 2 + 1.2 : 0);
    }
    return insetAvailable(group.shape, offsets, corners, sequence);
}

function arc(center, radius, start, end, step) {
    if (start - end > Math.PI) start -= 2 * Math.PI; else if (end - start > Math.PI) end -= 2 * Math.PI;
    const count = Math.trunc(Math.abs(start - end) * radius / step);
    return count > 2 ? Array.from({length: count}, (_, i) => {
        const angle = start + (end - start) * (i / (count - 1));
        return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }) : null;
}

function roundCut(chain, minimumFront, sequence) {
    const [a, b, c] = chain, span = distance(a, c), triangle = area(chain);
    if (triangle / span < 1 || triangle / (span * span) < .01) return [a, c];
    const first = subtract(b, a), second = subtract(c, b), left = norm(first), right = norm(second),
        short = Math.min(left, right);
    if (sequence.next() < (1 - dot(first, second) / left / right) / 2 || sequence.next() < minimumFront / short) return chain;
    const circular = (from, firstDirection, to, secondDirection) => {
        const normal = [-firstDirection[1], firstDirection[0]], other = [-secondDirection[1], secondDirection[0]],
            hit = lineParameters(from, normal, to, other);
        if (!hit) return null;
        const center = along(from, normal, hit[0]), radius = Math.abs(norm(firstDirection) * hit[0]);
        return arc(center, radius, Math.atan2(from[1] - center[1], from[0] - center[0]), Math.atan2(to[1] - center[1], to[0] - center[0]), minimumFront);
    };
    if (left < right) {
        const end = along(b, second, left / right), curve = circular(a, first, end, second);
        return curve ? [...curve, c] : chain;
    }
    const start = along(b, first, -right / left), curve = circular(start, first, c, second);
    return curve ? [a, ...curve] : chain;
}

function touchesBoundary(lot, block) {
    for (let i = 0; i < block.length; i++) {
        const a = block[i], b = block[(i + 1) % block.length], edge = subtract(b, a), length = dot(edge, edge);
        if (length < 1e-9) continue;
        for (const p of lot) {
            const t = dot(subtract(p, a), edge) / length;
            if (t >= 0 && t <= 1 && distance(p, along(a, edge, t)) < 1e-9) return true;
        }
    }
    return false;
}

function createBlock(polygon, parameters, sequence, single = false) {
    if (single) return {polygon, lots: signedArea(polygon) > 0 ? [polygon] : [], courtyards: []};
    const partition = new ParcelDivider(polygon, {
        minimumArea: parameters.minArea,
        variance: Math.max(4 * parameters.sizeChaos, 1.2),
        minimumTurnOffset: .5
    }, sequence).partition();
    const courtyards = partition.filter(p => !touchesBoundary(p, polygon));
    const lots = partition.filter(p => !courtyards.includes(p)).filter(p => {
        if (p.length < 4 || signedArea(p) < parameters.minArea / 4) return false;
        const bounds = orientedBounds(p), width = distance(bounds[0], bounds[1]),
            height = distance(bounds[1], bounds[2]);
        return width >= 1.2 && height >= 1.2 && area(p) / (width * height) > .5;
    });
    return {polygon, lots, courtyards};
}

function offsetFronts(block, sequence) {
    const target = centroid(block.polygon);
    block.lots = block.lots.map(lot => {
        const amount = Math.min(Math.sqrt(area(lot)) / 3, 1.2) * sequence.next();
        if (amount < .5) return lot;
        const direction = subtract(target, center(lot)), size = norm(direction), scale = size ? amount / size : 0;
        const shifted = block.polygon.map(p => [p[0] + direction[0] * scale, p[1] + direction[1] * scale]);
        const result = clipSingle(lot, shifted, 'intersection');
        return result && result.length >= 3 && signedArea(result) > 0 ? result : lot;
    });
}

function churchParcel(polygon, minimumFront, sequence) {
    const bounds = orientedBounds(polygon), a = subtract(bounds[0], bounds[1]), b = subtract(bounds[2], bounds[1]),
        direction = norm(a) > norm(b) ? a : b;
    const minimum = minimumFront / norm(direction),
        fraction = minimum > .5 ? .5 : minimum + (1 - 2 * minimum) * average(sequence, 3),
        origin = along(bounds[1], direction, fraction), normal = [-direction[1], direction[0]];
    const pieces = cutPolygon(polygon, origin, along(origin, normal, 1));
    const compactness = p => 4 * Math.PI * area(p) / (perimeter(p) ** 2);
    return pieces.length ? pieces.reduce((best, p) => compactness(p) > compactness(best) ? p : best) : polygon;
}

function populateHousingGroup(terrain, group, sequence, {processing = 'offset'} = {}) {
    if (!['none', 'offset'].includes(processing)) throw new Error('Неизвестный режим обработки застройки.');
    const parameters = group.district.parameters;
    group.shape = group.border.map(e => e.point);
    const interior = group.shape.map(point => terrain.mesh.cellsAt(point).every(cell => cell.urban || cell.water)),
        urban = interior.every(Boolean);
    const triangles = urban ? null : triangulate(group.shape), multipliers = interior.map(value => value ? 1 : 9);
    const available = groupAvailable(terrain, group, sequence);
    group.urban = urban;
    group.blocks = [];
    group.alleys = [];
    if (!available) return group;
    for (let attempt = 0; attempt <= 20; attempt++) {
        const blocks = [], alleys = [];
        let church = false;
        const add = (polygon, single = false) => {
            const block = createBlock(polygon, parameters, sequence, single);
            if (processing === 'offset') offsetFronts(block, sequence);
            if (block.lots.length) blocks.push(block);
        };
        const threshold = parameters.minArea * Math.pow(2, parameters.sizeChaos * (2 * sequence.next() - 1)) * parameters.blockSize;
        if (signedArea(available) > threshold) {
            const divider = new ParcelDivider(available, {
                minimumArea: parameters.minArea * parameters.blockSize, variance: 16 * parameters.gridChaos, gap: 1.2,
                processCut: chain => roundCut(chain, parameters.minFront, sequence),
                isAtomic: urban ? null : polygon => signedArea(polygon) < parameters.minArea * parameters.blockSize * interpolate(group.shape, triangles, multipliers, center(polygon))
            }, sequence);
            for (const polygon of divider.partition()) {
                const minimum = parameters.minArea * Math.pow(2, parameters.sizeChaos * (2 * sequence.next() - 1));
                if (area(polygon) < minimum) add(polygon, true);
                else if (!church && area(polygon) <= 4 * minimum) {
                    add(churchParcel(polygon, parameters.minFront, sequence), true);
                    church = true;
                } else add(polygon);
            }
            alleys.push(...divider.cuts);
        } else add(available);
        if (!urban) {
            const importance = group.border.map((edge, i) => {
                if (interior[i]) return 1;
                const prior = group.border[(i + group.border.length - 1) % group.border.length],
                    weight = e => e.kind === 'road' ? .3 : e.kind === 'wall' ? .5 : e.kind === 'canal' ? .1 : 0;
                return Math.max(weight(edge), weight(prior));
            });
            const size = Math.sqrt(group.cells.length), offset = .5 * size - .5;
            for (const block of blocks) block.lots = block.lots.filter(lot => {
                const value = interpolate(group.shape, triangles, importance, center(lot));
                return !Number.isNaN(value) && sequence.next() < value * size - offset;
            });
        }
        group.blocks = blocks.filter(block => block.lots.length);
        group.alleys = alleys;
        if (group.blocks.length) break;
    }
    group.sequence = sequence.checkpoint();
    return group;
}

export function buildHousingGroup(terrain, group, options = {}) {
    const sequence = new Sequence(group.core.seed);
    return sequence.checkpointOnError(() => populateHousingGroup(terrain, group, sequence, options));
}

export function buildHousing(terrain, options = {}) {
    if (!terrain.districts) throw new Error('Перед застройкой нужно распределить районы.');
    for (const cell of terrain.cells) if (cell.group?.core === cell) buildHousingGroup(terrain, cell.group, options);
    terrain.housingProcessing = options.processing || 'offset';
    return terrain;
}
