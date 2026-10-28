import {markEdges} from './walls.js';
import {midpoint} from './math.js';

const squaredDistance = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);

export class RouteGraph {
    constructor(mesh, cells) {
        this.nodes = new Map();
        this.order = 0;
        const node = point => {
            if (!mesh.vertexOrder.has(point)) mesh.vertexOrder.set(point, mesh.vertexOrder.size);
            if (!this.nodes.has(point)) this.nodes.set(point, {point, links: new Map(), order: null});
            return this.nodes.get(point);
        };
        for (const cell of cells) for (const edge of mesh.cycle(cell)) if (!edge.kind) {
            const from = node(edge.point), to = node(edge.next.point);
            if (to.order === null) to.order = this.order++;
            from.links.set(to, Math.sqrt(squaredDistance(from.point, to.point)));
        }
        for (const value of this.nodes.values()) if (value.order === null) value.order = this.order++;
    }

    excludePoints(points) {
        for (const point of points) {
            const node = this.nodes.get(point);
            if (node) {
                for (const other of node.links.keys()) other.links.delete(node);
                node.links.clear();
            }
        }
    }

    excludeEdges(edges) {
        for (const edge of edges) {
            const a = this.nodes.get(edge.point), b = this.nodes.get(edge.next.point);
            if (a && b) {
                a.links.delete(b);
                b.links.delete(a);
            }
        }
    }

    path(from, to) {
        const start = this.nodes.get(from), end = this.nodes.get(to);
        if (!start || !end) return null;
        const queue = [start], queued = new Set(queue), closed = new Set(), cost = new Map([[start, 0]]),
            previous = new Map();
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const node = queue[cursor];
            queued.delete(node);
            if (node === end) {
                const path = [node.point];
                for (let step = node; previous.has(step);) {
                    step = previous.get(step);
                    path.push(step.point);
                }
                return path;
            }
            closed.add(node);
            for (const [next, length] of [...node.links].sort(([a], [b]) => a.order - b.order)) {
                if (closed.has(next)) continue;
                const value = cost.get(node) + length;
                if (queued.has(next)) {
                    if (value >= cost.get(next)) continue;
                } else {
                    queue.push(next);
                    queued.add(next);
                }
                previous.set(next, node);
                cost.set(next, value);
            }
        }
        return null;
    }
}

export const chainPoints = edges => edges.length ? [...edges.map(e => e.point), edges.at(-1).next.point] : [];
export const edgeChain = (mesh, points) => points.slice(1).map((p, i) => {
    const edge = mesh.edgeBetween(points[i], p);
    if (!edge) throw new Error('Путь проходит вне рёбер сетки.');
    return edge;
});

export function smoothOpen(points, passes = 1, fixed = new Set()) {
    let values = points.map(p => [...p]);
    for (let pass = 0; pass < passes; pass++) values = values.map((point, i) => {
        if (i === 0 || i === points.length - 1 || fixed.has(points[i])) return point;
        return midpoint(midpoint(values[i - 1], values[i + 1]), point);
    });
    for (let i = 0; i < points.length; i++) {
        points[i][0] = values[i][0];
        points[i][1] = values[i][1];
    }
}

function assembleArteries(streets, roads) {
    const remaining = [...new Set([...streets.flat(), ...roads.flat()])], arteries = [];
    while (remaining.length) {
        const edge = remaining.pop();
        let attached = false;
        for (const artery of arteries) {
            if (artery[0].point === edge.next.point) {
                artery.unshift(edge);
                attached = true;
                break;
            }
            if (artery.at(-1).next.point === edge.point) {
                artery.push(edge);
                attached = true;
                break;
            }
        }
        if (!attached) arteries.push([edge]);
    }
    return arteries;
}

export function buildRoutes(terrain) {
    const {mesh, cells, gates, options} = terrain;
    const internal = new RouteGraph(mesh, cells.filter(c => c.urban)),
        external = new RouteGraph(mesh, cells.filter(c => !c.urban && !c.water));
    const shorePoints = terrain.shore.map(e => e.point);
    internal.excludePoints(shorePoints);
    external.excludePoints(shorePoints);
    const wallPoints = [...new Set(terrain.walls.flatMap(w => w.polygon))].filter(p => !gates.includes(p));
    internal.excludePoints(wallPoints);
    external.excludePoints(wallPoints);
    let candidates = terrain.earthEdges.filter(e => !terrain.shore.includes(e) && external.nodes.has(e.point));
    const streets = [], roads = [], unroutedGates = [], coastalLandings = [];
    for (const gate of gates) {
        const target = options.plaza ? terrain.plaza.polygon.reduce((best, p) => squaredDistance(p, gate) < squaredDistance(best, gate) ? p : best) : terrain.center;
        const path = internal.path(gate, target);
        if (!path) {
            unroutedGates.push(gate);
            continue;
        }
        streets.push(edgeChain(mesh, path));
        if (!terrain.border.gates.includes(gate)) continue;
        let approach = null;
        if (external.nodes.has(gate)) {
            candidates = [...candidates].sort((a, b) => {
                const score = p => -(gate[0] * p[0] + gate[1] * p[1]) / Math.sqrt(p[0] * p[0] + p[1] * p[1]);
                return score(a.point) - score(b.point);
            });
            for (const candidate of candidates) {
                approach = external.path(candidate.point, gate);
                if (approach) break;
            }
        }
        if (approach) {
            const edges = edgeChain(mesh, approach);
            roads.push(edges);
            external.excludeEdges(edges);
        } else if (options.walls) for (const cell of mesh.cellsAt(gate)) if (!cell.withinWalls && terrain.shore.some(e => e.cell === cell)) {
            cell.urban = true;
            cell.landing = true;
            coastalLandings.push(cell);
        }
    }
    const arteries = assembleArteries(streets, roads), fixed = options.walls ? new Set(gates) : new Set();
    for (const artery of arteries) {
        markEdges(artery, 'road');
        smoothOpen(artery.map(e => e.point), 2, fixed);
    }
    return Object.assign(terrain, {streets, roads, arteries, unroutedGates, coastalLandings});
}
