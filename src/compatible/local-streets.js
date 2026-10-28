import {lineParameters} from './math.js';
import {clipSingle, signedArea, variableInset} from './polygons.js';
import {bounds, segmentDistance} from '../core/geometry.js';
import {dryPieces} from '../roads/bridge-network.js';
import {buildingIndex} from '../buildings/building-spatial.js';

function cornerCircle(point, radius) {
    return Array.from({length: 16}, (_, j) => {
        const angle = j * Math.PI / 8, r = radius / Math.cos(Math.PI / 16);
        return [point[0] + r * Math.cos(angle), point[1] + r * Math.sin(angle)];
    });
}

function streetChains(contour, keep) {
    const streets = [], start = Math.max(0, keep.indexOf(false));
    let path = null;
    for (let step = 0; step < contour.length; step++) {
        const i = (start + step) % contour.length, a = contour[i], b = contour[(i + 1) % contour.length];
        if (!keep[i]) {
            path = null;
            continue;
        }
        if (path) path.push(b);
        else {
            path = [a, b];
            streets.push(path);
        }
    }
    return streets;
}

function clearCorridors(terrain, streets, halfWidth) {
    if (!streets.length) return [];
    const obstacles = [], padding = halfWidth + .01;
    const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    const streetIndex = buildingIndex([]);
    for (const points of streets) for (let i = 1; i < points.length; i++) streetIndex.add({box: bounds([points[i - 1], points[i]])});
    const strip = (a, b, width) => {
        const d = [b[0] - a[0], b[1] - a[1]], scale = width / Math.hypot(...d), n = [-d[1] * scale, d[0] * scale];
        return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]];
    };
    for (const wall of terrain.walls || []) {
        const corners = new Set();
        wall.edges.forEach((edge, i) => {
            if (wall.segments[i]) {
                obstacles.push(strip(edge.point, edge.next.point, .6 + padding));
                corners.add(edge.point);
                corners.add(edge.next.point);
            }
        });
        for (const point of corners) obstacles.push(cornerCircle(point, .6 + padding));
        for (const point of wall.towers || []) obstacles.push(cornerCircle(point, .925 + padding));
        for (const point of wall.gates) obstacles.push(cornerCircle(point, 1.25 + padding));
    }
    const footprints = [
        ...terrain.districts.flatMap(d => d.groups.flatMap(g => (g.blocks || []).flatMap(b => b.lots))),
        ...(terrain.specialBuildings || []).map(b => b.polygon), ...(terrain.fields || [])
    ];
    for (const polygon of footprints) {
        const box = bounds(polygon), margin = padding / Math.cos(Math.PI / 16),
            padded = [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin];
        if (!streetIndex.near(padded).some(entry => overlap(padded, entry.box))) continue;
        obstacles.push(polygon);
        polygon.forEach((p, i) => obstacles.push(strip(p, polygon[(i + 1) % polygon.length], padding), cornerCircle(p, padding)));
    }
    const boxed = obstacles.map((polygon, order) => ({polygon, box: bounds(polygon), order})),
        index = buildingIndex([]);
    for (const entry of boxed) index.add(entry);
    return streets.flatMap(points => {
        const segments = points.slice(1).map((p, i) => bounds([points[i], p])),
            nearby = [...new Set(segments.flatMap(box => index.near(box).filter(o => overlap(box, o.box))))]
                .sort((a, b) => a.order - b.order).map(o => o.polygon);
        return dryPieces(points, nearby);
    });
}

export function localStreets(terrain) {
    const seen = new Set(), streets = [];
    for (const district of terrain.districts) for (const group of district.groups) for (const edge of group.border) {
        if (seen.has(edge) || edge.kind || !edge.twin?.cell.urban || edge.twin.cell.group === group) continue;
        seen.add(edge);
        seen.add(edge.twin);
        streets.push([edge.point, edge.next.point]);
    }
    return streets;
}

export function wallStreets(terrain) {
    const walls = terrain.walls || [], edges = new Set(), streets = [];
    for (const wall of walls) wall.edges.forEach((edge, i) => {
        if (wall.segments[i]) {
            edges.add(edge);
        }
    });
    for (const district of terrain.districts) for (const group of district.groups) {
        const border = group.border, alongWall = border.map(edge => edges.has(edge));
        if (!alongWall.some(Boolean)) continue;
        // Housing leaves 2.15 units at walls; a 1.2-wide road fits inside that setback.
        let contour = variableInset(border.map(edge => edge.point), alongWall.map(value => value ? 1.45 : 0));
        if (!contour) continue;
        for (let i = 0; i < border.length; i++) {
            if (!alongWall[i] && !alongWall[(i + border.length - 1) % border.length]) continue;
            const point = border[i].point,
                radius = walls.some(w => w.gates.includes(point)) ? 2.1 : walls.some(w => w.towers?.includes(point)) ? 1.7 : 0;
            if (!radius) continue;
            contour = clipSingle(contour, cornerCircle(point, radius), 'difference');
            if (!contour) break;
        }
        if (!contour) continue;
        const keep = contour.map((a, i) => {
            const b = contour[(i + 1) % contour.length];
            return !border.some((edge, j) => !alongWall[j] && segmentDistance(a, edge.point, edge.next.point) < 1e-7 && segmentDistance(b, edge.point, edge.next.point) < 1e-7);
        });
        streets.push(...streetChains(contour, keep));
    }
    return clearCorridors(terrain, streets, .6);
}

export function outerWallStreets(terrain) {
    const streets = [];
    for (const wall of terrain.walls || []) {
        const polygon = wall.polygon, sign = signedArea(polygon) > 0 ? 1 : -1;
        const shifted = polygon.map((a, i) => {
            const b = polygon[(i + 1) % polygon.length], d = [b[0] - a[0], b[1] - a[1]],
                scale = 1.7 * sign / Math.hypot(...d);
            return {point: [a[0] + d[1] * scale, a[1] - d[0] * scale], direction: d};
        });
        const contour = shifted.map((edge, i) => {
            const prior = shifted[(i + shifted.length - 1) % shifted.length],
                hit = lineParameters(edge.point, edge.direction, prior.point, prior.direction);
            return hit ? [edge.point[0] + edge.direction[0] * hit[0], edge.point[1] + edge.direction[1] * hit[0]] : edge.point;
        });
        const keep = contour.map((a, i) => {
            const b = contour[(i + 1) % contour.length], middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            let nearest = Infinity, active = false;
            polygon.forEach((p, j) => {
                const d = segmentDistance(middle, p, polygon[(j + 1) % polygon.length]);
                if (d < nearest) {
                    nearest = d;
                    active = wall.segments[j];
                }
            });
            return active;
        });
        streets.push(...streetChains(contour, keep));
    }
    return clearCorridors(terrain, streets, .4);
}

export function connectedAlleys(terrain, corridors = []) {
    const streets = [];
    const corridorEdges = corridors.flatMap(path => path.slice(1).map((p, i) => [path[i], p]));
    for (const district of terrain.districts) for (const group of district.groups) {
        const connected = [], boundary = group.border.map(edge => [edge.point, edge.next.point]);
        for (const alley of group.alleys || []) {
            const points = alley.map(point => [...point]);
            const targets = [...boundary, ...corridorEdges, ...connected.flatMap(path => path.slice(1).map((p, i) => [path[i], p]))];
            for (const index of [0, points.length - 1]) {
                const origin = points[index], neighbor = points[index === 0 ? 1 : index - 1],
                    direction = [origin[0] - neighbor[0], origin[1] - neighbor[1]];
                let nearest = Infinity;
                for (const [a, b] of targets) {
                    const hit = lineParameters(origin, direction, a, [b[0] - a[0], b[1] - a[1]]);
                    if (hit && hit[0] >= -1e-8 && hit[1] >= -1e-8 && hit[1] <= 1 + 1e-8) nearest = Math.min(nearest, Math.max(0, hit[0]));
                }
                if (Number.isFinite(nearest)) points[index] = [origin[0] + direction[0] * nearest, origin[1] + direction[1] * nearest];
            }
            connected.push(points);
        }
        streets.push(...connected);
    }
    return streets;
}
