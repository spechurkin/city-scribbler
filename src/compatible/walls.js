import {area} from '../core/geometry.js';
import {centroid, distance, midpoint} from './math.js';
import {smoothBoundary} from './junctions.js';

const setPoint = (point, value) => {
    point[0] = value[0];
    point[1] = value[1];
};
const closest = (items, score) => items.reduce((best, item) => score(item) < score(best) ? item : best);

export function markEdges(edges, kind, overwrite = true) {
    for (const edge of edges) for (const side of [edge, edge.twin].filter(Boolean)) if (overwrite || !side.kind) side.kind = kind;
}

function chooseWeighted(weights, sequence) {
    const target = sequence.next() * weights.reduce((sum, v) => sum + v, 0);
    let accumulated = 0;
    for (let i = 0; i < weights.length; i++) if (target <= (accumulated += weights[i])) return i;
    return 0;
}

function createBorder(terrain) {
    const {mesh, urban, options, castle, sequence} = terrain;
    const edges = mesh.boundary(urban), polygon = edges.map(e => e.point);
    const reserved = new Set([...terrain.waterEdges.map(e => e.point), ...(castle?.polygon || [])]);
    if (options.walls) {
        markEdges(edges, 'wall', false);
        smoothBoundary(polygon, 3, reserved);
    }
    const members = new Set(urban);
    const weights = polygon.map(p => reserved.has(p) || mesh.cellsAt(p).filter(c => members.has(c)).length < 2 ? 0 : 1);
    if (!weights.some(Boolean)) throw new Error('На границе города нет места для ворот.');
    const count = options.gates >= 0 ? options.gates : options.hub ? polygon.length : 2 + Math.trunc(urban.length / 12 * (terrain.shore.length ? .75 : 1));
    const gates = [];
    while (gates.length < count && weights.some(v => v > 0)) {
        const index = chooseWeighted(weights, sequence), point = polygon[index];
        gates.push(point);
        const external = mesh.cellsAt(point).filter(c => !members.has(c));
        if (options.walls && external.length === 1) {
            const cell = external[0], candidates = cell.polygon.filter(p => !reserved.has(p) && !polygon.includes(p));
            if (candidates.length) {
                const middle = midpoint(polygon[(index + polygon.length - 1) % polygon.length], polygon[(index + 1) % polygon.length]);
                const outward = [point[0] - middle[0], point[1] - middle[1]];
                const target = closest(candidates, p => -((p[0] - point[0]) * outward[0] + (p[1] - point[1]) * outward[1]) / distance(p, point));
                const replacements = mesh.splitCell(cell, point, target, sequence),
                    position = terrain.cells.indexOf(cell);
                terrain.cells.splice(position, 1, ...replacements);
            }
        }
        for (let i = 0; i < weights.length; i++) {
            const gap = Math.min(Math.abs(i - index), weights.length - Math.abs(i - index));
            weights[i] *= gap <= 1 ? 0 : gap - 1;
        }
    }
    if (count > 0 && !gates.length) throw new Error('Не удалось создать ворота.');
    if (options.walls) for (const point of gates) {
        const index = polygon.indexOf(point);
        setPoint(point, midpoint(polygon[(index + polygon.length - 1) % polygon.length], polygon[(index + 1) % polygon.length]));
    }
    return {edges, polygon, gates, real: options.walls, segments: edges.map(() => true)};
}

function splitCastleGate(terrain, wall, edge) {
    const added = terrain.mesh.splitEdge(edge);
    wall.edges = terrain.mesh.cycle(terrain.castle);
    wall.polygon = wall.edges.map(e => e.point);
    markEdges(wall.edges, 'wall', false);
    return added.point;
}

function createCastleWall(terrain) {
    const {mesh, castle, plaza} = terrain, edges = mesh.cycle(castle), polygon = castle.polygon;
    const reserved = new Set(polygon.filter(p => mesh.cellsAt(p).some(c => !c.urban)));
    const wall = {edges, polygon, gates: [], real: true};
    markEdges(edges, 'wall', false);
    const plazaEdge = edges.find(e => e.twin?.cell === plaza);
    if (plazaEdge) wall.gates.push(splitCastleGate(terrain, wall, plazaEdge));
    else {
        const candidates = polygon.filter(p => !reserved.has(p));
        if (candidates.length) {
            const point = closest(candidates, p => Math.hypot(...p)), index = polygon.indexOf(point);
            setPoint(point, midpoint(polygon[(index + polygon.length - 1) % polygon.length], polygon[(index + 1) % polygon.length]));
            wall.gates.push(point);
        } else {
            const entrances = edges.filter(e => e.twin?.cell.urban);
            wall.gates.push(entrances.length ? splitCastleGate(terrain, wall, closest(entrances, e => Math.hypot(...midpoint(e.point, e.next.point)))) : closest(edges, e => distance(e.point, e.next.point)).point);
        }
    }
    wall.segments = wall.edges.map(() => true);
    adjustCastle(terrain, wall);
    return wall;
}

function adjustCastle({mesh, castle}, wall) {
    const polygon = castle.polygon, center = centroid(polygon);
    for (let attempt = 0; attempt < 100; attempt++) {
        const radii = polygon.map(p => distance(p, center));
        if (Math.min(...radii) >= 10) break;
        const influence = 2 * Math.max(15, ...radii);
        for (const point of mesh.incident.keys()) {
            const radius = distance(point, center);
            if (radius > 0 && radius < influence) {
                const factor = (radius / influence) ** (-.25);
                setPoint(point, [center[0] + (point[0] - center[0]) * factor, center[1] + (point[1] - center[1]) * factor]);
            }
        }
        if (attempt === 99) throw new Error('Замковая ячейка остаётся слишком узкой.');
    }
    const fixed = new Set(wall.gates), gate = wall.gates[0], incident = mesh.incident.get(gate);
    if (incident.length === 2) for (const edge of incident) fixed.add(edge.next.point);
    const compactness = () => {
        const perimeter = polygon.reduce((sum, p, i) => sum + distance(p, polygon[(i + 1) % polygon.length]), 0);
        return 4 * Math.PI * area(polygon) / (perimeter * perimeter);
    };
    let before = compactness();
    for (let attempt = 0; before < .75 && attempt < 100; attempt++) {
        let real = 0, imaginary = 0;
        for (let i = 0; i < polygon.length; i++) {
            const angle = -2 * Math.PI * i / polygon.length, cos = Math.cos(angle), sin = Math.sin(angle);
            const x = polygon[i][0] - center[0], y = polygon[i][1] - center[1];
            real += x * cos - y * sin;
            imaginary += y * cos + x * sin;
        }
        real /= polygon.length;
        imaginary /= polygon.length;
        for (let i = 0; i < polygon.length; i++) if (!fixed.has(polygon[i])) {
            const angle = 2 * Math.PI * i / polygon.length, cos = Math.cos(angle), sin = Math.sin(angle),
                point = polygon[i];
            setPoint(point, [point[0] + .2 * (center[0] + (real * cos - imaginary * sin) - point[0]), point[1] + .2 * (center[1] + (imaginary * cos + real * sin) - point[1])]);
        }
        const after = compactness();
        if (Math.abs(after - before) < .001) throw new Error('Не удалось выровнять замковую ячейку.');
        before = after;
    }
}

export function buildWalls(terrain) {
    terrain.sequence.branch(() => {
        terrain.border = createBorder(terrain);
        terrain.walls = terrain.options.walls ? [terrain.border] : [];
        terrain.gates = [...terrain.border.gates];
        if (terrain.castle) {
            terrain.castleWall = createCastleWall(terrain);
            terrain.walls.push(terrain.castleWall);
            terrain.gates.push(...terrain.castleWall.gates);
        }
    });
    return terrain;
}
