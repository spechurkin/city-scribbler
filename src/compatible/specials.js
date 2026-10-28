import {availableForCell} from './available.js';
import {Sequence} from './sequence.js';
import {inscribedRectangle, shrinkPolygon} from './rectangles.js';
import {buildingFootprint} from './footprints.js';
import {signedArea} from './polygons.js';
import {centroid, distance, midpoint} from './math.js';

const rectangle = (width, height) => [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const longest = polygon => polygon.reduce((best, _, i) => distance(polygon[i], polygon[(i + 1) % polygon.length]) > distance(polygon[best], polygon[(best + 1) % polygon.length]) ? i : best, 0);

function monument(terrain, cell, sequence) {
    const space = availableForCell(terrain, cell, sequence), rectangular = sequence.next() < .6,
        nearEdge = rectangular || sequence.next() < .3;
    let from = null, to = null;
    if (nearEdge) {
        const index = longest(space);
        from = space[index];
        to = space[(index + 1) % space.length];
    }
    let polygon;
    if (rectangular) {
        polygon = rectangle(1 + sequence.next(), 1 + sequence.next());
        const angle = Math.atan2(to[1] - from[1], to[0] - from[0]), sin = Math.sin(angle), cos = Math.cos(angle);
        polygon = polygon.map(([x, y]) => [x * cos - y * sin, y * cos + x * sin]);
    } else {
        const radius = 1 + sequence.next();
        polygon = Array.from({length: 8}, (_, i) => [radius * Math.cos(2 * Math.PI * i / 8), radius * Math.sin(2 * Math.PI * i / 8)]);
    }
    const center = centroid(space),
        origin = nearEdge ? lerp(center, midpoint(from, to), .2 + sequence.next() * .4) : center;
    return {space, polygon: polygon.map(([x, y]) => [x + origin[0], y + origin[1]])};
}

function farmhouse(polygon, sequence) {
    const width = 4 + sequence.next(), height = 2 + sequence.next(), index = longest(polygon), a = polygon[index],
        b = polygon[(index + 1) % polygon.length], inverse = 1 / distance(a, b),
        unit = [(b[0] - a[0]) * inverse, (b[1] - a[1]) * inverse];
    const origin = sequence.next() < .5 ? [a[0] + unit[0] * (width / 2), a[1] + unit[1] * (width / 2)] : [b[0] - unit[0] * (width / 2), b[1] - unit[1] * (width / 2)];
    origin[0] += -unit[1] * (height / 2);
    origin[1] += unit[0] * (height / 2);
    const base = rectangle(width, height).map(([x, y]) => [x * unit[0] - y * unit[1], y * unit[0] + x * unit[1]]).map(([x, y]) => [x + origin[0], y + origin[1]]);
    return buildingFootprint(base, 4 + sequence.next(), sequence, {jitter: .4}) || base;
}

export function buildSpecialBuildings(terrain) {
    const buildings = [], monuments = [], squares = [];
    for (const cell of terrain.cells) {
        const sequence = new Sequence(cell.seed);
        sequence.checkpointOnError(() => {
            if (cell.ward === 'castle') {
                const bounds = inscribedRectangle(shrinkPolygon(cell.polygon, 3.9)),
                    polygon = buildingFootprint(bounds, signedArea(cell.polygon) / 25, sequence, {jitter: .4}) || bounds;
                buildings.push({kind: 'castle', cell: cell.id, polygon});
                cell.geometrySequence = sequence.checkpoint();
            } else if (cell.ward === 'temple') {
                const available = availableForCell(terrain, cell, sequence);
                if (available) {
                    const bounds = inscribedRectangle(available),
                        polygon = buildingFootprint(bounds, 20, sequence, {symmetric: true, jitter: .2}) || bounds;
                    buildings.push({kind: 'temple', cell: cell.id, polygon});
                }
                cell.geometrySequence = sequence.checkpoint();
            } else if (cell.ward === 'market') {
                const market = monument(terrain, cell, sequence);
                monuments.push(market.polygon);
                squares.push(market.space);
                cell.geometrySequence = sequence.checkpoint();
            } else if (cell.ward === 'farm' && cell.fields) {
                sequence.restore(cell.fieldSequence);
                for (const plot of cell.fields) if (sequence.next() < .2) buildings.push({
                    kind: 'farmhouse',
                    cell: cell.id,
                    polygon: farmhouse(plot, sequence)
                });
                cell.geometrySequence = sequence.checkpoint();
            } else if (cell.group?.core === cell) cell.geometrySequence = cell.group.sequence;
        });
    }
    terrain.specialBuildings = buildings;
    terrain.monuments = monuments;
    terrain.squares = squares;
    return terrain;
}
