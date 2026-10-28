import {distance, perimeter} from './math.js';

export class Mesh {
    constructor(cells) {
        this.cells = [...cells];
        this.edges = [];
        this.incident = new Map();
        this.vertexOrder = new Map();
        this.nextCellId = Math.max(-1, ...cells.map(c => c.id)) + 1;
        for (const cell of cells) this.attach(cell);
        this.linkTwins();
    }

    attach(cell) {
        const edges = cell.polygon.map(point => ({point, cell, next: null, twin: null, kind: null}));
        for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            edge.next = edges[(i + 1) % edges.length];
            if (!this.incident.has(edge.point)) this.incident.set(edge.point, []);
            this.incident.get(edge.point).push(edge);
            this.edges.push(edge);
        }
        cell.edge = edges[0];
    }

    linkTwins() {
        const outgoing = new Map();
        for (const edge of this.edges) {
            if (!outgoing.has(edge.point)) outgoing.set(edge.point, new Map());
            outgoing.get(edge.point).set(edge.next.point, edge);
        }
        for (const edge of this.edges) edge.twin = outgoing.get(edge.next.point)?.get(edge.point) || null;
    }

    cycle(cell) {
        const edges = [];
        let edge = cell.edge;
        do {
            edges.push(edge);
            edge = edge.next;
        } while (edge !== cell.edge);
        return edges;
    }

    refresh(cell) {
        cell.polygon = this.cycle(cell).map(e => e.point);
    }

    cellsAt(point) {
        return (this.incident.get(point) || []).map(e => e.cell);
    }

    previous(edge) {
        return this.cycle(edge.cell).find(e => e.next === edge);
    }

    edgeBetween(a, b) {
        return this.incident.get(a)?.find(e => e.next.point === b) || null;
    }

    boundary(cells, start = null) {
        if (!cells.length) return [];
        const included = new Set(cells);
        if (!start) for (const cell of cells) for (const edge of this.cycle(cell)) {
            if ((!edge.twin || !included.has(edge.twin.cell)) && (!start || edge.point[0] < start.point[0])) start = edge;
        }
        if (!start) throw new Error('У области нет внешней границы.');
        const loop = [];
        let edge = start;
        do {
            loop.push(edge);
            edge = edge.next;
            while (edge.twin && included.has(edge.twin.cell)) edge = edge.twin.next;
            if (loop.length > this.edges.length) throw new Error('Граница сетки не замкнулась.');
        } while (edge !== start);
        return loop;
    }

    collapse(edge) {
        const keep = edge.point, remove = edge.next.point,
            affected = new Set(this.cellsAt(keep).concat(this.cellsAt(remove)));
        keep[0] = (keep[0] + remove[0]) / 2;
        keep[1] = (keep[1] + remove[1]) / 2;
        for (const discarded of [edge, edge.twin].filter(Boolean)) {
            if (discarded.cell.edge === discarded) discarded.cell.edge = discarded.next;
            this.previous(discarded).next = discarded.next;
            this.incident.get(discarded.point).splice(this.incident.get(discarded.point).indexOf(discarded), 1);
            this.edges.splice(this.edges.indexOf(discarded), 1);
        }
        for (const outgoing of this.incident.get(remove)) {
            outgoing.point = keep;
            this.incident.get(keep).push(outgoing);
        }
        this.incident.delete(remove);
        for (const cell of affected) this.refresh(cell);
        return keep;
    }

    splitEdge(edge, point = [(edge.point[0] + edge.next.point[0]) / 2, (edge.point[1] + edge.next.point[1]) / 2]) {
        const insert = side => {
            const added = {point, cell: side.cell, next: side.next, twin: null, kind: null};
            side.next = added;
            this.edges.push(added);
            if (!this.incident.has(point)) this.incident.set(point, []);
            this.incident.get(point).push(added);
            this.refresh(side.cell);
            return added;
        };
        const added = insert(edge), twin = edge.twin;
        if (twin) {
            const opposite = insert(twin);
            edge.twin = opposite;
            opposite.twin = edge;
            added.twin = twin;
            twin.twin = added;
        }
        return added;
    }

    splitCell(cell, a, b, sequence) {
        const edges = this.cycle(cell), ia = edges.findIndex(e => e.point === a),
            ib = edges.findIndex(e => e.point === b);
        if (ia < 0 || ib < 0 || ia === ib) throw new Error('Некорректный разрез ячейки.');
        const arc = (from, to) => {
            const points = [edges[to].point];
            for (let index = from; index !== to; index = (index + 1) % edges.length) points.push(edges[index].point);
            return points;
        };
        const polygons = [arc(ia, ib), arc(ib, ia)];
        if (polygons.some(p => p.length < 3)) throw new Error('Разрез создаёт вырожденную ячейку.');
        for (const edge of edges) {
            if (edge.twin) edge.twin.twin = null;
            this.incident.get(edge.point).splice(this.incident.get(edge.point).indexOf(edge), 1);
            this.edges.splice(this.edges.indexOf(edge), 1);
        }
        this.cells.splice(this.cells.indexOf(cell), 1);
        const faces = polygons.map(polygon => {
            const next = {id: this.nextCellId++, polygon, water: false, urban: false, withinWalls: false};
            this.cells.push(next);
            this.attach(next);
            return next;
        });
        const replacements = [faces[1], faces[0]];
        for (const cell of replacements) {
            sequence.next();
            cell.seed = sequence.state;
        }
        this.linkTwins();
        for (const next of replacements) for (const edge of this.cycle(next)) if (edge.twin?.kind === 'wall') edge.kind = 'wall';
        return replacements;
    }
}

export function optimizeMesh(mesh, castle = null) {
    const protectedPoints = new Set(castle?.polygon || []);
    let count = 0;
    for (let pass = 0; pass < 1000; pass++) {
        let changed = false;
        for (const cell of mesh.cells) {
            if (cell.polygon.length <= 4) continue;
            const edges = mesh.cycle(cell);
            const threshold = Math.max(7.5, perimeter(cell.polygon) / edges.length / 3);
            for (const edge of edges) {
                if (!edge.twin || edge.twin.cell.polygon.length <= 4 || protectedPoints.has(edge.point) !== protectedPoints.has(edge.next.point)) continue;
                if (distance(edge.point, edge.next.point) >= threshold) continue;
                mesh.collapse(edge);
                changed = true;
                count++;
                break;
            }
        }
        if (!changed) return count;
    }
    throw new Error('Упрощение сетки не сошлось.');
}
