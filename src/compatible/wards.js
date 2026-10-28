import {distance, norm} from './math.js';

const center = polygon => {
    const sum = polygon.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]);
    return [sum[0] / polygon.length, sum[1] / polygon.length];
};
const pick = (items, sequence) => items[Math.floor(sequence.next() * items.length)];
const borders = (terrain, cell, chain) => chain.some(e => e.cell === cell);

function growOutskirts(terrain) {
    const {mesh, sequence} = terrain, candidates = [], weights = [];
    const score = point => {
        let value = 3 * distance(point, terrain.center);
        for (const road of terrain.roads) for (const edge of road) value = Math.min(value, 2 * distance(edge.point, point));
        for (const edge of terrain.shore) value = Math.min(value, distance(edge.point, point));
        for (const river of terrain.rivers) for (const edge of river.course) value = Math.min(value, distance(edge.point, point));
        return value * value;
    };
    const neighbors = cell => mesh.cycle(cell).filter(e => e.twin).map(e => e.twin.cell);
    const addNeighbors = cell => {
        for (const other of neighbors(cell)) if (!other.urban && !other.water && !borders(terrain, other, terrain.horizon) && !candidates.includes(other)) {
            const contacts = neighbors(other).filter(c => c.urban).length;
            if (contacts > 1) {
                candidates.push(other);
                weights.push(contacts * contacts / score(center(other.polygon)));
            }
        }
    };
    for (const cell of terrain.cells) if (cell.urban) addNeighbors(cell);
    const spread = sequence.next();
    for (let count = terrain.options.size * (1 + spread * spread * spread) * .5; count > 0 && candidates.length; count--) {
        const target = sequence.next() * weights.reduce((a, b) => a + b, 0);
        let accumulated = 0, index = 0;
        while (index < weights.length - 1 && target > (accumulated += weights[index])) index++;
        const cell = candidates[index];
        cell.urban = true;
        if (terrain.maxDocks > 0 && borders(terrain, cell, terrain.shore)) {
            cell.landing = true;
            terrain.maxDocks--;
        }
        cell.ward = 'housing';
        candidates.splice(index, 1);
        weights.splice(index, 1);
        addNeighbors(cell);
    }
}

export function assignWards(terrain) {
    const {mesh, sequence, options, urban} = terrain;
    terrain.maxDocks = Math.trunc(Math.sqrt(options.size / 2)) + (options.river ? 2 : 0) - terrain.coastalLandings.length;
    if (options.plaza) terrain.plaza.ward = 'market';
    if (terrain.castle) terrain.castle.ward = 'castle';
    for (const cell of terrain.coastalLandings) cell.ward = 'housing';
    if (options.greens) {
        let nearCastle = 0;
        if (terrain.castleWall) {
            const neighbors = mesh.cellsAt(terrain.castleWall.gates[0]);
            if (neighbors.length === 3 && sequence.next() < 1 - 2 / (options.size - 1)) for (const cell of neighbors) if (!cell.ward) {
                cell.ward = 'park';
                nearCastle++;
            }
        }
        const expected = (options.size - 10) / 20,
            parks = Math.trunc(expected) + (sequence.next() < expected - Math.trunc(expected) ? 1 : 0) - nearCastle;
        for (let index = 0; index < parks; index++) {
            if (urban.every(c => c.ward)) break;
            for (let attempts = 0; ; attempts++) {
                if (attempts > 10000) throw new Error('Не удалось выбрать парковую ячейку.');
                const cell = pick(urban, sequence);
                if (!cell.ward) {
                    cell.ward = 'park';
                    break;
                }
            }
        }
    }
    if (terrain.shore.length && terrain.maxDocks > 0) for (const cell of urban) if (borders(terrain, cell, terrain.shore)) {
        cell.landing = true;
        if (--terrain.maxDocks <= 0) break;
    }
    if (options.temple) {
        const candidates = urban.filter(c => !c.ward);
        if (candidates.length) candidates.reduce((best, c) => norm(center(c.polygon)) < norm(center(best.polygon)) ? c : best).ward = 'temple';
    }
    for (const cell of urban) if (!cell.ward) cell.ward = 'housing';
    if (options.walls) for (const gate of terrain.border.gates) if (!(sequence.next() < 1 / (options.size - 5))) {
        for (const cell of mesh.cellsAt(gate)) if (!cell.ward) {
            cell.urban = true;
            if (borders(terrain, cell, terrain.shore) && terrain.maxDocks-- > 0) cell.landing = true;
            cell.ward = 'housing';
        }
    }
    if (options.shantytown) growOutskirts(terrain);
    for (const point of terrain.shore.map(e => e.point)) for (const cell of mesh.cellsAt(point)) if (cell.urban && !cell.landing) {
        const edges = mesh.cycle(cell), previous = edges.find(e => e.next.point === point);
        if (previous.twin?.cell.landing && previous.next.twin?.cell.landing) {
            cell.landing = true;
            break;
        }
    }
    for (const cell of terrain.cells) if (cell.landing) for (const edge of mesh.cycle(cell)) if (edge.twin?.cell.water && !edge.twin.cell.ward) edge.twin.cell.ward = 'harbour';
    const average = (count) => Array.from({length: count}, () => sequence.next()).reduce((a, b) => a + b, 0) / count;
    const first = average(3) * 2, second = average(3), phase1 = sequence.next() * Math.PI * 2,
        phase2 = sequence.next() * Math.PI * 2;
    let radius = 0;
    for (const cell of urban) for (const point of cell.polygon) radius = Math.max(radius, distance(point, terrain.center));
    for (const cell of terrain.cells) if (!cell.ward) {
        if (cell.water) cell.ward = 'water';
        else if (borders(terrain, cell, terrain.shore)) cell.ward = 'wilderness';
        else {
            const c = center(cell.polygon), relative = [c[0] - terrain.center[0], c[1] - terrain.center[1]],
                angle = Math.atan2(relative[1], relative[0]);
            const boundary = (first * Math.sin(angle + phase1) + second * Math.sin(2 * angle + phase2) + 1) * radius;
            cell.ward = norm(relative) < boundary ? 'farm' : 'wilderness';
        }
    }
    return terrain;
}

export function buildPiers(terrain) {
    const piers = [], mouths = new Set(terrain.rivers.map(r => r.course[0].point));
    for (const cell of terrain.cells) if (cell.ward === 'harbour') {
        const available = [];
        for (const edge of terrain.mesh.cycle(cell)) if (edge.twin?.cell.landing) {
            let a = edge.point, b = edge.next.point;
            if (mouths.has(a)) a = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            else if (mouths.has(b)) b = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            available.push([a, b]);
        }
        if (!available.length) continue;
        const [a, b] = available.reduce((best, p) => distance(...p) > distance(...best) ? p : best),
            length = distance(a, b), count = Math.trunc(length / 6), span = 6 * (count - 1);
        const start = (1 - span / length) / 2, step = span / (count - 1) / length;
        let t = start;
        for (let index = 0; index < count; index++) {
            const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            t += step;
            const normal = [-(b[1] - a[1]) / length * 8, (b[0] - a[0]) / length * 8];
            piers.push([point, [point[0] + normal[0], point[1] + normal[1]]]);
        }
    }
    terrain.piers = piers;
    return terrain;
}
