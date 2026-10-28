import {distance, norm} from './math.js';

const average = (sequence, count) => Array.from({length: count}, () => sequence.next()).reduce((a, b) => a + b, 0) / count;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function connectedPlan(columns, rows, sequence, continuation = .5, front = false) {
    const active = Array(columns * rows).fill(false);
    let remaining = active.length, minX = columns, maxX = -1, minY = rows, maxY = -1;
    const add = (x, y) => {
        active[y * columns + x] = true;
        remaining--;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    };
    if (front) for (let x = 0; x < columns; x++) add(x, 0);
    else add(Math.floor(sequence.next() * columns), Math.floor(sequence.next() * rows));
    for (let step = 0; step < 2000000; step++) {
        const x = Math.floor(sequence.next() * columns),
            y = front ? Math.floor(1 + sequence.next() * (rows - 1)) : Math.floor(sequence.next() * rows),
            index = y * columns + x;
        if (!active[index] && (x > 0 && active[index - 1] || y > 0 && active[index - columns] || x < columns - 1 && active[index + 1] || y < rows - 1 && active[index + columns])) add(x, y);
        const spans = front ? maxY === rows - 1 : minX === 0 && maxX === columns - 1 && minY === 0 && maxY === rows - 1;
        if (spans && !(remaining > 0 && sequence.next() < (front ? .5 : continuation))) return active;
    }
    throw new Error('Рост контура здания не завершился.');
}

function outline(tiles) {
    if (tiles.length === 1) return tiles[0];
    const ids = new Map(), edges = new Map();
    const id = point => {
        if (!ids.has(point)) ids.set(point, ids.size);
        return ids.get(point);
    };
    for (const tile of tiles) for (let i = 0; i < tile.length; i++) {
        const a = tile[i], b = tile[(i + 1) % tile.length], key = `${id(a)}:${id(b)}`, reverse = `${id(b)}:${id(a)}`;
        if (edges.has(reverse)) edges.delete(reverse); else edges.set(key, {a, b});
    }
    const list = [...edges.values()], outgoing = new Map();
    for (const edge of list) {
        if (!outgoing.has(edge.a)) outgoing.set(edge.a, []);
        outgoing.get(edge.a).push(edge);
    }
    const start = list.find(edge => outgoing.get(edge.a).length > 1) || list[0], points = [];
    let edge = start;
    do {
        points.push(edge.a);
        edge = outgoing.get(edge.b)?.[0];
        if (!edge || points.length > list.length) throw new Error('Не замкнулся контур здания.');
    } while (edge.a !== start.a);
    return points.filter((point, i) => {
        const previous = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length],
            a = [point[0] - previous[0], point[1] - previous[1]], b = [next[0] - point[0], next[1] - point[1]];
        return !((a[0] * b[0] + a[1] * b[1]) / norm(a) / norm(b) > .999);
    });
}

export function buildingFootprint(quadrilateral, minimumRoomArea, sequence, {
    front = false,
    symmetric = false,
    jitter = 0
} = {}) {
    if (quadrilateral.length !== 4 || !(minimumRoomArea > 0) || !Number.isFinite(minimumRoomArea)) throw new Error('Для контура здания нужен четырёхугольник и положительная площадь комнаты.');
    const side = Math.sqrt(minimumRoomArea),
        columns = Math.ceil(Math.min(distance(quadrilateral[0], quadrilateral[1]), distance(quadrilateral[2], quadrilateral[3])) / side),
        rows = Math.ceil(Math.min(distance(quadrilateral[1], quadrilateral[2]), distance(quadrilateral[3], quadrilateral[0])) / side);
    if (columns <= 1 || rows <= 1) return null;
    if (columns * rows > 10000) throw new Error('Слишком мелкая сетка помещений.');
    const plan = connectedPlan(columns, rows, sequence, symmetric ? 0 : .5, symmetric ? false : front);
    if (symmetric) for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const index = y * columns + x, mirror = (y + 1) * columns - 1 - x;
        plan[index] = plan[mirror] = plan[index] || plan[mirror];
    }
    if (plan.every(Boolean)) return null;
    const us = Array.from({length: columns + 1}, (_, i) => i / columns),
        vs = Array.from({length: rows + 1}, (_, i) => i / rows);
    if (jitter > 0) {
        for (let i = 1; i < columns; i++) us[i] += (average(sequence, 3) - .5) / (columns - 1) * jitter;
        for (let i = 1; i < rows; i++) vs[i] += (average(sequence, 3) - .5) / (rows - 1) * jitter;
    }
    const grid = vs.map(v => {
        const left = lerp(quadrilateral[0], quadrilateral[3], v), right = lerp(quadrilateral[1], quadrilateral[2], v);
        return us.map(u => lerp(left, right, u));
    });
    const tiles = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) if (plan[y * columns + x]) tiles.push([grid[y][x], grid[y][x + 1], grid[y + 1][x + 1], grid[y + 1][x]]);
    return outline(tiles);
}
