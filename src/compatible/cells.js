import {circle, Triangulation} from './triangulation.js';
import {Sequence} from './sequence.js';
import {centroid, norm} from './math.js';

const squaredDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const polar = (r, angle) => [r * Math.cos(angle), r * Math.sin(angle)];
const nextEdge = e => e % 3 === 2 ? e - 2 : e + 1;

export function circumcenter(a, b, c) {
    return circle(a, b, c).center;
}

export function radialSites({seed, size, plaza = true, sequence: sharedSequence}) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 1000) throw new Error('Некорректный размер поселения.');
    const sequence = sharedSequence || new Sequence(seed), phase = sequence.next() * 2 * Math.PI;
    const points = [[0, 0]];
    let radius = 0;
    for (let index = 1; index < size * 8; index++) {
        const r = 10 + index * (2 + sequence.next());
        points.push(polar(r, phase + 5 * Math.sqrt(index)));
        radius = Math.max(radius, r);
    }
    if (plaza) sequence.isolated(rng => {
        const first = 8 + 8 * rng.next(), second = first * (1 + rng.next());
        for (let axis = 0; axis < 4 && axis + 1 < points.length; axis++) points[axis + 1] = polar(axis % 2 ? second : first, phase + axis * Math.PI / 2);
        radius = Math.max(radius, second);
    });
    for (let i = 0; i < 6; i++) points.push(polar(radius * 2, 2 * Math.PI * i / 6));
    return {points, radius, phase, sequence};
}

export function buildInitialCells(parameters) {
    const layout = radialSites(parameters), sites = layout.points, triangulation = new Triangulation(sites);
    const {triangles, halfedges} = triangulation, centers = new Map(), visited = new Set(), cells = [];

    function triangleCenter(index) {
        if (!centers.has(index)) {
            const [a, b, c] = [0, 1, 2].map(offset => sites[triangles[index * 3 + offset]]);
            const lengths = [a, b, c].map(p => p[0] * p[0] + p[1] * p[1]);
            const denominator = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
            const inverse = 1 / denominator;
            centers.set(index, [inverse * (lengths[0] * (b[1] - c[1]) + lengths[1] * (c[1] - a[1]) + lengths[2] * (a[1] - b[1])), inverse * (lengths[0] * (c[0] - b[0]) + lengths[1] * (a[0] - c[0]) + lengths[2] * (b[0] - a[0]))]);
        }
        return centers.get(index);
    }

    for (let edge = 0; edge < triangles.length; edge++) {
        const owner = triangles[nextEdge(edge)];
        if (visited.has(owner)) continue;
        visited.add(owner);
        const polygon = [];
        let incoming = edge, closed = false;
        do {
            polygon.push(triangleCenter(Math.floor(incoming / 3)));
            incoming = halfedges[nextEdge(incoming)];
            if (incoming === edge) {
                closed = true;
                break;
            }
        } while (incoming >= 0 && polygon.length <= triangles.length);
        if (!closed || polygon.length < 3 || polygon.some(p => !p.every(Number.isFinite) || norm(p) > layout.radius)) continue;
        cells.push({id: cells.length, site: sites[owner], polygon, center: centroid(polygon)});
    }
    for (const cell of cells) {
        layout.sequence.next();
        cell.seed = layout.sequence.state;
    }
    const ordered = [...cells].sort((a, b) => squaredDistance(a.center, [0, 0]) - squaredDistance(b.center, [0, 0]));
    return {...layout, sites, cells, ordered, triangulation};
}
