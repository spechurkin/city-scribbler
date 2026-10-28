import {clipSingle, variableInset} from './polygons.js';

function regularPolygon(count, radius, phase, origin = [0, 0]) {
    return Array.from({length: count}, (_, i) => [origin[0] + radius * Math.cos(phase + 2 * Math.PI * i / count), origin[1] + radius * Math.sin(phase + 2 * Math.PI * i / count)]);
}

export function buildTowers(terrain) {
    for (const wall of terrain.walls) {
        if (wall === terrain.border) wall.segments = wall.edges.map(e => e.kind !== 'coast' && e.twin?.cell !== terrain.castle);
        wall.towers = wall.edges.filter((edge, i) => !wall.gates.includes(edge.point) && (wall.segments[(i + wall.edges.length - 1) % wall.edges.length] || wall.segments[i])).map(e => e.point);
    }
    if (terrain.castleWall && terrain.options.walls) terrain.border.towers = terrain.border.towers.filter(p => !terrain.castleWall.towers.includes(p));
    for (const river of terrain.rivers) if (terrain.options.walls) terrain.border.towers = terrain.border.towers.filter(p => !river.watergates.includes(p));
    return terrain;
}

export function towerRadius(terrain, point) {
    let radius = 0;
    for (const wall of terrain.walls) radius = Math.max(radius, wall.towers?.includes(point) ? 2.5 : wall.gates.includes(point) ? 4.8 : 0);
    return radius;
}

export function insetAvailable(polygon, offsets, corners, sequence) {
    let result = variableInset(polygon, offsets);
    if (!result) return null;
    for (let index = 0; index < polygon.length; index++) if (corners[index] > offsets[index] && corners[index] > offsets[(index + polygon.length - 1) % polygon.length]) {
        const clip = regularPolygon(9, corners[index], sequence.next(), polygon[index]);
        const next = clipSingle(result, clip, 'difference');
        if (next) result = next;
    }
    return result;
}

export function availableForCell(terrain, cell, sequence = terrain.sequence) {
    const edges = terrain.mesh.cycle(cell),
        corners = edges.map(e => cell.ward === 'market' ? 0 : towerRadius(terrain, e.point)), offsets = [];
    for (let index = 0; index < edges.length; index++) {
        const edge = edges[index];
        for (const river of terrain.rivers) if (river.course.some(e => e.point === edge.point)) {
            corners[index] = river.width / 2 + (cell.ward === 'market' ? 0 : 1.2);
            if (edge.point === river.course[0].point) corners[index] += 1.2;
        }
        let offset;
        if (cell.ward === 'market') offset = edge.kind === 'canal' ? terrain.rivers[0].width / 2 : 0;
        else if (cell.ward === 'farm') {
            if (!edge.kind) offset = edge.twin?.cell.ward === 'farm' ? 1 : 0;
            else offset = edge.kind === 'road' ? 3 : edge.kind === 'wall' ? 3.8 : edge.kind === 'canal' ? terrain.rivers[0].width / 2 + 1.2 : 2;
        } else if (!edge.kind) offset = edge.twin?.cell === terrain.plaza && terrain.options.plaza ? 1 : .6;
        else offset = edge.kind === 'coast' ? (cell.landing ? 2 : 1.2) : edge.kind === 'road' ? 1 : edge.kind === 'wall' ? 2.15 : edge.kind === 'canal' ? terrain.rivers[0].width / 2 + 1.2 : 0;
        offsets.push(offset);
    }
    return insetAvailable(cell.polygon, offsets, corners, sequence);
}
