import {Sequence} from './sequence.js';
import {CrownCache} from './trees.js';
import {signedArea} from './polygons.js';
import {directInset, fractalBoundary, resampleClosed, smoothClosed} from './vegetation-geometry.js';

function forestComponents(terrain) {
    const remaining = new Set(terrain.mesh.cells.filter(cell => cell.ward === 'wilderness')), components = [];
    while (remaining.size) {
        const start = remaining.values().next().value, cells = [start],
            stack = terrain.mesh.cycle(start).filter(e => e.twin);
        while (stack.length) {
            const edge = stack.pop(), neighbor = edge.twin.cell;
            if (!remaining.has(neighbor) || cells.includes(neighbor) || edge.kind && edge.kind !== 'road') continue;
            cells.push(neighbor);
            stack.push(...terrain.mesh.cycle(neighbor).filter(e => e.twin));
        }
        for (const cell of cells) remaining.delete(cell);
        components.push(cells);
    }
    return components;
}

function outlines(mesh, cells) {
    const included = new Set(cells), boundary = [];
    for (const cell of cells) for (const edge of mesh.cycle(cell)) if (!edge.twin || !included.has(edge.twin.cell)) boundary.push(edge);
    const unused = new Set(boundary), rings = [];
    while (unused.size) {
        const start = boundary.find(edge => unused.has(edge)), ring = mesh.boundary(cells, start);
        for (const edge of ring) unused.delete(edge);
        if (signedArea(ring.map(e => e.point)) > 0) rings.unshift(ring); else rings.push(ring);
    }
    return rings;
}

export function buildForests(terrain) {
    if (!terrain.treeEnd || !terrain.cityBounds) throw new Error('Леса строятся после городских деревьев.');
    const sequence = new Sequence(1);
    sequence.restore(terrain.treeEnd);
    const groups = [];
    for (const cells of forestComponents(terrain)) {
        const polygons = [];
        for (const ring of outlines(terrain.mesh, cells)) {
            const offsets = ring.map(edge => edge.kind === 'canal' ? (20 + terrain.rivers[0].width) / 2 : 10);
            const inset = directInset(ring.map(e => e.point), offsets);
            if (!inset.flat().every(Number.isFinite)) throw new Error('В лесной границе есть вырожденный угол.', {
                cause: {
                    polygon: ring.map(e => e.point),
                    offsets
                }
            });
            const coarse = resampleClosed(inset, 20), rough = fractalBoundary(coarse, sequence),
                smooth = smoothClosed(rough);
            polygons.push(smooth);
        }
        groups.push({polygons, trees: []});
    }
    const bounds = terrain.cityBounds, cache = new CrownCache(terrain.treeCacheMode, terrain.treeCrowns);
    for (const group of groups) for (const polygon of group.polygons) for (const point of resampleClosed(polygon, 3)) {
        if (point[0] < bounds.left - 40 || point[0] >= bounds.right + 40 || point[1] < bounds.top - 40 || point[1] >= bounds.bottom + 40) continue;
        const radius = 1.5 * sequence.next(), angle = 2 * Math.PI * sequence.next();
        point[0] += radius * Math.cos(angle);
        point[1] += radius * Math.sin(angle);
        group.trees.push({point, index: cache.next(sequence)});
    }
    terrain.forests = groups;
    terrain.treeCrowns = cache.palette;
    terrain.forestEnd = sequence.checkpoint();
    return terrain;
}
