import {midpoint} from './math.js';

export function selectUrbanCells(layout, {size, citadel = true, urbanCastle = false, plaza: plazaNeeded = true} = {}) {
    const urban = layout.ordered.filter(c => !c.water).slice(0, size + 1), urbanSet = new Set(urban);
    const membership = new Map();
    for (const cell of layout.cells) for (const point of cell.polygon) {
        if (!membership.has(point)) membership.set(point, []);
        membership.get(point).push(cell);
    }
    const centerCell = urban[0], plaza = plazaNeeded ? centerCell : null;
    let castle = null;
    if (citadel) {
        const candidates = urbanCastle ? urban.filter(c => c !== plaza && c.polygon.every(p => membership.get(p).every(n => n.water || urbanSet.has(n)))) : [];
        castle = candidates.length ? candidates[Math.floor(layout.sequence.next() * candidates.length)] : urban.at(-1);
    }
    for (const cell of layout.cells) cell.urban = urbanSet.has(cell);
    return {urban: urban.filter(c => c !== castle), castle, plaza, centerCell};
}

export function simplifyJunctions(cells, {castle = null} = {}) {
    const ids = new Map();
    for (const cell of cells) for (const p of cell.polygon) if (!ids.has(p)) ids.set(p, ids.size);
    const castleBoundary = new Set(castle?.polygon || []);
    const key = (a, b) => `${ids.get(a)}:${ids.get(b)}`;
    let index;

    function reindex() {
        index = new Map();
        for (const cell of cells) for (let i = 0; i < cell.polygon.length; i++) index.set(key(cell.polygon[i], cell.polygon[(i + 1) % cell.polygon.length]), {
            cell,
            index: i
        });
    }

    reindex();
    let count = 0;
    for (let pass = 0; pass < 1000; pass++) {
        let modified = false;
        for (const cell of cells) {
            const poly = cell.polygon;
            if (poly.length <= 4) continue;
            let perimeter = 0;
            for (let i = 0; i < poly.length; i++) perimeter += Math.hypot(poly[i][0] - poly[(i + 1) % poly.length][0], poly[i][1] - poly[(i + 1) % poly.length][1]);
            const limit = Math.max(7.5, perimeter / poly.length / 3);
            for (let edge = 0; edge < poly.length; edge++) {
                const a = poly[edge], b = poly[(edge + 1) % poly.length], twin = index.get(key(b, a));
                if (!twin || twin.cell.polygon.length <= 4 || castleBoundary.has(a) !== castleBoundary.has(b)) continue;
                if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= limit) continue;
                a[0] = (a[0] + b[0]) / 2;
                a[1] = (a[1] + b[1]) / 2;
                poly.splice(edge, 1);
                twin.cell.polygon.splice(twin.index, 1);
                for (const neighbor of cells) for (let j = 0; j < neighbor.polygon.length; j++) if (neighbor.polygon[j] === b) neighbor.polygon[j] = a;
                reindex();
                count++;
                modified = true;
                break;
            }
        }
        if (!modified) return count;
    }
    throw new Error('Упрощение пересечений не сошлось.');
}

export function boundaryLoops(cells) {
    const ids = new Map(), edges = new Map();
    for (const cell of cells) for (const p of cell.polygon) if (!ids.has(p)) ids.set(p, ids.size);
    const key = (a, b) => `${ids.get(a)}:${ids.get(b)}`;
    for (const cell of cells) for (let i = 0; i < cell.polygon.length; i++) {
        const a = cell.polygon[i], b = cell.polygon[(i + 1) % cell.polygon.length], opposite = key(b, a);
        if (edges.has(opposite)) edges.delete(opposite); else edges.set(key(a, b), {a, b});
    }
    const byOrigin = new Map([...edges.values()].map(e => [e.a, e]));
    const loops = [];
    while (byOrigin.size) {
        const start = byOrigin.keys().next().value, loop = [];
        let point = start;
        do {
            const edge = byOrigin.get(point);
            if (!edge) throw new Error('Незамкнутая граница сетки.');
            loop.push(point);
            byOrigin.delete(point);
            point = edge.b;
        } while (point !== start && loop.length <= edges.size);
        loops.push(loop);
    }
    return loops;
}

export function connectedCellSets(cells) {
    const ids = new Map(), edges = new Map(), neighbors = new Map(cells.map(c => [c, new Set()]));
    for (const cell of cells) for (const p of cell.polygon) if (!ids.has(p)) ids.set(p, ids.size);
    for (const cell of cells) for (let i = 0; i < cell.polygon.length; i++) {
        const a = ids.get(cell.polygon[i]), b = ids.get(cell.polygon[(i + 1) % cell.polygon.length]),
            key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const other = edges.get(key);
        if (other) {
            neighbors.get(other).add(cell);
            neighbors.get(cell).add(other);
        } else edges.set(key, cell);
    }
    const unseen = new Set(cells), sets = [];
    while (unseen.size) {
        const queue = [unseen.values().next().value], component = [];
        unseen.delete(queue[0]);
        for (let index = 0; index < queue.length; index++) {
            const cell = queue[index];
            component.push(cell);
            for (const next of neighbors.get(cell)) if (unseen.delete(next)) queue.push(next);
        }
        sets.push(component);
    }
    return sets.sort((a, b) => b.length - a.length);
}

export function smoothBoundary(polygon, iterations = 1, fixed = new Set()) {
    let values = polygon.map(p => [...p]);
    for (let pass = 0; pass < iterations; pass++) values = values.map((p, i) => {
        if (fixed.has(polygon[i])) return p;
        const before = values[(i + values.length - 1) % values.length], after = values[(i + 1) % values.length];
        return midpoint(midpoint(before, after), p);
    });
    for (let i = 0; i < polygon.length; i++) {
        polygon[i][0] = values[i][0];
        polygon[i][1] = values[i][1];
    }
}
