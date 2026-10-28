import {area, distance} from '../core/geometry.js';
import {metricPoint} from '../compatible/terrain.js';

function boundaryRings(mesh, cells) {
    const members = new Set(cells),
        remaining = new Set(cells.flatMap(cell => mesh.cycle(cell)).filter(edge => !edge.twin || !members.has(edge.twin.cell))),
        rings = [];
    while (remaining.size) {
        const border = mesh.boundary(cells, remaining.values().next().value);
        for (const edge of border) remaining.delete(edge);
        rings.push(border.map(edge => metricPoint(edge.point)));
    }
    return rings.sort((a, b) => area(b) - area(a));
}

function regionLimits(terrain) {
    const sizes = terrain.urban.map(cell => area(cell.polygon)).sort((a, b) => a - b);
    const medianArea = (sizes[Math.floor((sizes.length - 1) / 2)] + sizes[Math.floor(sizes.length / 2)]) / 2;
    const maxCells = Math.max(10, Math.ceil(Math.sqrt(sizes.length) * 1.5));
    return {minArea: 2 * medianArea, minCells: Math.min(3, sizes.length), maxArea: maxCells * medianArea, maxCells};
}

const special = region => region.cells.every(cell => ['castle', 'park'].includes(cell.ward));
const regionArea = region => region.cells.reduce((sum, cell) => sum + area(cell.polygon), 0);

function mergeSmallInnerRegions(terrain, regions, barriers) {
    if (!terrain.options.walls) return;
    const inner = new Set(terrain.urban), {minArea, minCells} = regionLimits(terrain);
    const byCell = new Map(regions.flatMap(region => region.cells.map(cell => [cell, region])));
    const ordinary = region => region.cells.every(cell => inner.has(cell)) && !special(region);
    for (; ;) {
        let merged = false;
        for (const region of regions.filter(ordinary).sort((a, b) => regionArea(a) - regionArea(b))) {
            if (region.cells.length >= minCells && regionArea(region) >= minArea) continue;
            const neighbors = new Map();
            for (const cell of region.cells) for (const edge of terrain.mesh.cycle(cell)) {
                const next = byCell.get(edge.twin?.cell);
                if (next && next !== region && !barriers.has(edge) && ordinary(next)) neighbors.set(next, (neighbors.get(next) || 0) + distance(edge.point, edge.next.point));
            }
            const target = [...neighbors].sort((a, b) => b[1] - a[1])[0]?.[0];
            if (!target) continue;
            target.cells.push(...region.cells);
            target.sourceDistricts = [...new Set([...target.sourceDistricts, ...region.sourceDistricts])];
            for (const cell of region.cells) byCell.set(cell, target);
            regions.splice(regions.indexOf(region), 1);
            merged = true;
            break;
        }
        if (!merged) return;
    }
}

function balancedParts(terrain, region, barriers, {minArea, minCells}) {
    const {mesh} = terrain, members = new Set(region.cells), groups = new Map();
    for (const cell of region.cells) {
        const key = cell.group || cell;
        if (!groups.has(key)) groups.set(key, {cells: []});
        groups.get(key).cells.push(cell);
    }
    const nodes = [...groups.values()], byCell = new Map(nodes.flatMap(node => node.cells.map(cell => [cell, node])));
    const neighbors = new Map(nodes.map(node => [node, node.cells.flatMap(cell => mesh.cycle(cell)).filter(edge => edge.twin && members.has(edge.twin.cell) && byCell.get(edge.twin.cell) !== node && !barriers.has(edge))]));
    const center = node => {
        const points = node.cells.flatMap(cell => cell.polygon);
        return points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
    };
    const centers = new Map(nodes.map(node => [node, center(node)])), roots = new Set();
    for (const axis of [0, 1]) for (const direction of [-1, 1]) roots.add(nodes.reduce((best, node) => direction * centers.get(node)[axis] > direction * centers.get(best)[axis] ? node : best));
    const total = regionArea(region);
    let best = null;
    for (const root of roots) {
        const order = [root], children = new Map(nodes.map(node => [node, []])), visited = new Set(order);
        for (let index = 0; index < order.length; index++) for (const edge of neighbors.get(order[index])) {
            const next = byCell.get(edge.twin.cell);
            if (!visited.has(next)) {
                visited.add(next);
                order.push(next);
                children.get(order[index]).push(next);
            }
        }
        // Cutting a spanning-tree branch keeps both resulting districts connected.
        for (const start of order.slice(1)) {
            const branch = [start];
            for (let index = 0; index < branch.length; index++) branch.push(...children.get(branch[index]));
            const cells = branch.flatMap(node => node.cells);
            if (cells.length < minCells || region.cells.length - cells.length < minCells) continue;
            const firstArea = cells.reduce((sum, cell) => sum + area(cell.polygon), 0), secondArea = total - firstArea;
            if (firstArea < minArea || secondArea < minArea) continue;
            const included = new Set(cells);
            let cut = 0;
            for (const node of branch) for (const edge of neighbors.get(node)) if (!included.has(edge.twin.cell)) cut += distance(edge.point, edge.next.point);
            const score = Math.abs(firstArea - secondArea) / total + Math.abs(2 * cells.length - region.cells.length) / region.cells.length + .15 * cut / Math.sqrt(total);
            if (!best || score < best.score) best = {score, cells, included};
        }
    }
    return best ? [best.cells, region.cells.filter(cell => !best.included.has(cell))] : null;
}

function splitLargeRegions(terrain, regions, barriers) {
    const limits = regionLimits(terrain), ids = new Set(regions.map(region => String(region.id)));
    for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        if (special(region) || region.cells.length <= limits.maxCells && regionArea(region) <= limits.maxArea) continue;
        const parts = balancedParts(terrain, region, barriers, limits);
        if (!parts) continue;
        const replacements = parts.map((cells, part) => {
            if (part === 0) return {...region, cells};
            let suffix = 1;
            while (ids.has(`${region.id}-split-${suffix}`)) suffix++;
            const id = `${region.id}-split-${suffix}`;
            ids.add(id);
            return {...region, id, cells};
        });
        regions.splice(index, 1, ...replacements);
        index--;
    }
}

// This overlay runs after every compatible stage, without changing cells or drawing random values.
export function buildDistrictRegions(terrain) {
    const {mesh} = terrain, barriers = new Set(), regions = [];
    for (const edge of [...terrain.walls.flatMap(wall => wall.edges), ...terrain.rivers.flatMap(river => river.course)]) {
        barriers.add(edge);
        if (edge.twin) barriers.add(edge.twin);
    }
    for (const edge of terrain.mesh.edges) if (edge.kind === 'road') {
        barriers.add(edge);
        if (edge.twin) barriers.add(edge.twin);
    }
    for (const district of terrain.districts) {
        const remaining = new Set(district.cells);
        let part = 0;
        while (remaining.size) {
            const cells = [remaining.values().next().value];
            remaining.delete(cells[0]);
            for (let index = 0; index < cells.length; index++) for (const edge of mesh.cycle(cells[index])) {
                const next = edge.twin?.cell;
                if (!barriers.has(edge) && remaining.delete(next)) cells.push(next);
            }
            regions.push({
                id: part === 0 ? district.id : `${district.id}-${part}`,
                sourceDistrict: district.id,
                sourceDistricts: [district.id],
                type: district.type,
                cells
            });
            part++;
        }
    }
    mergeSmallInnerRegions(terrain, regions, barriers);
    splitLargeRegions(terrain, regions, barriers);
    return regions.map(({cells, ...region}) => {
        const rings = boundaryRings(mesh, cells);
        return {
            ...region, type: cells.every(cell => cell.ward === 'park') ? 'park' : region.type,
            cellIds: cells.map(cell => cell.id), polygon: rings[0], rings
        };
    });
}
