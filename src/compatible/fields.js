import {availableForCell} from './available.js';
import {Sequence} from './sequence.js';
import {cutPolygon, orientedBounds} from './parcels.js';
import {signedArea} from './polygons.js';
import {distance, midpoint} from './math.js';

const average = (rng, count) => Array.from({length: count}, () => rng.next()).reduce((a, b) => a + b, 0) / count;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const area = polygon => Math.abs(signedArea(polygon));

function splitField(polygon, sequence) {
    let calls = 0;
    const visit = (polygon, depth) => {
        if (++calls > 30000 || depth > 200) throw new Error('Превышен предел деления полей.');
        if (area(polygon) < 400 * (1 + Math.abs(average(sequence, 4) * 2 - 1))) return [polygon];
        const bounds = orientedBounds(polygon),
            index = distance(bounds[1], bounds[0]) > distance(bounds[2], bounds[1]) ? 0 : 1;
        const fraction = .5 + .2 * (average(sequence, 3) * 2 - 1);
        const angle = Math.PI / 2 + (sequence.next() < .5 ? 0 : Math.PI / 8 * (average(sequence, 3) * 2 - 1));
        const from = lerp(bounds[index], bounds[index + 1], fraction),
            edge = [bounds[index + 1][0] - bounds[index][0], bounds[index + 1][1] - bounds[index][1]];
        const cos = Math.cos(angle), sin = Math.sin(angle),
            to = [from[0] + (edge[0] * cos - edge[1] * sin), from[1] + (edge[1] * cos + edge[0] * sin)];
        const parts = cutPolygon(polygon, from, to, 2);
        if (parts.length < 2) throw new Error('Не удалось разделить поле.');
        return parts.flatMap(part => visit(part, depth + 1));
    };
    return visit(polygon, 0);
}

function collinear(a, b, c, d) {
    const x = b[0] - a[0], y = b[1] - a[1], base = b[0] * a[1] - b[1] * a[0];
    return Math.abs(x * c[1] - y * c[0] - base) < 1e-9 && Math.abs(x * d[1] - y * d[0] - base) < 1e-9;
}

function roundPlot(polygon) {
    const points = [];
    for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index], b = polygon[(index + 1) % polygon.length], size = distance(a, b);
        if (size < 2.6) points.push(midpoint(a, b));
        else {
            points.push(lerp(a, b, 1.3 / size));
            points.push(lerp(b, a, 1.3 / size));
        }
    }
    return points;
}

export function buildFields(terrain) {
    const fields = [];
    for (const cell of terrain.cells) if (cell.ward === 'farm') {
        const sequence = new Sequence(cell.seed);
        sequence.checkpointOnError(() => {
            const available = availableForCell(terrain, cell, sequence);
            if (!available) return;
            const boundary = terrain.mesh.cycle(cell).filter(e => e.twin && e.twin.cell.ward);
            const plots = splitField(available, sequence).filter(polygon => !boundary.some(edge => polygon.some((point, i) => collinear(polygon[(i + polygon.length - 1) % polygon.length], point, edge.point, edge.next.point))));
            const rounded = plots.map(roundPlot);
            cell.fields = rounded;
            fields.push(...rounded);
            cell.fieldSequence = sequence.checkpoint();
        });
    }
    terrain.fields = fields;
    return terrain;
}
