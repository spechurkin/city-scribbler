import {chainPoints, edgeChain, RouteGraph, smoothOpen} from './routes.js';
import {markEdges} from './walls.js';

const length = p => Math.hypot(...p);
const difference = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = p => {
    const size = length(p);
    return size ? [p[0] / size, p[1] / size] : [0, 0];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const assign = (a, b) => {
    a[0] = b[0];
    a[1] = b[1];
};

export function chainsCross(a, edgeA, b, edgeB) {
    let around = a[(a.indexOf(edgeA) + a.length - 1) % a.length];
    const incoming = b[(b.indexOf(edgeB) + b.length - 1) % b.length];
    const advance = () => {
        around = around.next.twin;
        if (!around) throw new Error('Пересечение путей на краю сетки.');
    };
    for (let pass = 0; pass < 2; pass++) {
        let turns = 0;
        do {
            advance();
            if (++turns > 1000) throw new Error('Не замкнулось кольцо пересечения.');
        } while (around !== incoming && around !== edgeA.twin && around !== edgeB.twin);
        if (around === edgeA.twin) return pass === 1;
    }
    return false;
}

function validCourse(terrain, course) {
    if (!course || course.length < terrain.earthEdges.length / 5) return false;
    const positions = new Map(course.map((e, i) => [e.point, i]));
    for (let i = 1; i < course.length - 1; i++) if (terrain.shore.some(e => e.point === course[i].point)) return false;
    const crossings = [];
    if (terrain.options.walls) crossings.push(terrain.border.edges);
    for (const artery of terrain.arteries) crossings.push(artery.slice(1, -1).length ? artery : []);
    for (const chain of crossings) for (let i = chain === terrain.border.edges ? 0 : 1; i < (chain === terrain.border.edges ? chain.length : chain.length - 1); i++) {
        const index = positions.get(chain[i].point);
        if (index > 0 && index < course.length - 1 && !chainsCross(chain, chain[i], course, course[index])) return false;
    }
    return true;
}

function inlandCourse(terrain, graph) {
    const {mesh, sequence} = terrain;
    const candidates = terrain.horizon.map(e => e.point).filter(p => mesh.cellsAt(p).length > 1);
    while (candidates.length > 1) {
        const start = candidates[Math.floor(sequence.next() * candidates.length)];
        const end = candidates.reduce((best, p) => dot(start, unit(p)) < dot(start, unit(best)) ? p : best);
        const centralEdges = mesh.incident.get(terrain.center),
            via = centralEdges[Math.floor(sequence.next() * centralEdges.length)].next.point;
        const from = graph.path(end, via), to = from ? graph.path(via, start) : null;
        if (from && to) for (let index = 0; index < to.length; index++) {
            const common = from.indexOf(to[index]);
            if (common >= 0) {
                const course = edgeChain(mesh, [...to.slice(0, index), ...from.slice(common)]);
                if (validCourse(terrain, course)) return course;
                break;
            }
        }
        for (const point of [start, end]) {
            const index = candidates.indexOf(point);
            if (index >= 0) candidates.splice(index, 1);
        }
    }
    return null;
}

function deltaCourse(terrain, graph) {
    const {mesh, shore} = terrain;
    const mouths = shore.slice(1, -1).filter(e => mesh.cellsAt(e.point).filter(c => !c.water).length > 1).sort((a, b) => length(a.point) - length(b.point));
    const candidates = terrain.earthEdges.filter(e => !shore.includes(e) && mesh.cellsAt(e.point).length > 1).map(e => e.point);
    for (const mouth of mouths) {
        const index = shore.indexOf(mouth), tangent = unit(difference(shore[index + 1].point, shore[index - 1].point));
        const normal = [-tangent[1], tangent[0]];
        const end = candidates.reduce((best, p) => dot(normal, unit(difference(p, mouth.point))) > dot(normal, unit(difference(best, mouth.point))) ? p : best);
        const path = graph.path(end, mouth.point), course = path ? edgeChain(mesh, path) : null;
        if (validCourse(terrain, course)) return course;
    }
    return null;
}

function shapeRiver(terrain, course) {
    const points = chainPoints(course);
    if (terrain.waterEdges.length) {
        const mouth = points[0], shore = terrain.shore.map(e => e.point), index = shore.indexOf(mouth);
        assign(mouth, midpoint(mouth, points[1]));
        if (index >= 2) assign(shore[index - 1], midpoint(shore[index - 1], midpoint(shore[index - 2], mouth)));
        if (index < shore.length - 2) assign(shore[index + 1], midpoint(shore[index + 1], midpoint(shore[index + 2], mouth)));
    }
    smoothOpen(points);
    markEdges(course, 'canal');
    if (terrain.options.walls) {
        const border = terrain.border.polygon;
        for (let i = 1; i < course.length; i++) {
            const point = points[i], index = border.indexOf(point);
            if (index < 0) continue;
            const a = points[i - 1], direction = difference(points[i + 1], a),
                b = border[(index + border.length - 1) % border.length];
            const tangent = difference(border[(index + 1) % border.length], b), delta = difference(b, a),
                cross = direction[0] * tangent[1] - direction[1] * tangent[0];
            if (cross === 0) throw new Error('Река параллельна пересекаемой стене.');
            const t = (delta[0] * tangent[1] - delta[1] * tangent[0]) / cross;
            assign(point, midpoint(point, [a[0] + direction[0] * t, a[1] + direction[1] * t]));
        }
    }
}

export function buildRiver(terrain) {
    terrain.rivers = [];
    if (!terrain.options.river) return terrain;
    terrain.sequence.branch(() => {
        const graph = new RouteGraph(terrain.mesh, terrain.cells.filter(c => !c.water));
        if (terrain.options.walls) graph.excludeEdges(terrain.border.edges);
        if (terrain.castleWall) graph.excludePoints(terrain.castleWall.polygon);
        graph.excludePoints(terrain.gates);
        for (const artery of terrain.arteries) graph.excludeEdges(artery);
        const course = terrain.shore.length ? deltaCourse(terrain, graph) : inlandCourse(terrain, graph);
        if (!course) throw new Error('Не удалось проложить реку.');
        shapeRiver(terrain, course);
        if (terrain.options.riverCurvature !== 1) adjustCurvature(terrain, chainPoints(course));
        terrain.rivers.push({course, points: chainPoints(course)});
    });
    return terrain;
}

function adjustCurvature(terrain, points) {
    const fixed = new Set([points[0], points.at(-1), ...terrain.arteries.flatMap(artery => chainPoints(artery)), ...(terrain.options.walls ? terrain.border.polygon : [])]);
    const anchors = points.map((p, i) => fixed.has(p) ? i : -1).filter(i => i >= 0), original = points.map(p => [...p]),
        factor = terrain.options.riverCurvature;
    for (let part = 1; part < anchors.length; part++) {
        const start = anchors[part - 1], end = anchors[part], travel = [0];
        for (let i = start + 1; i <= end; i++) travel.push(travel.at(-1) + length(difference(original[i], original[i - 1])));
        const total = travel.at(-1);
        if (!total) continue;
        for (let i = start + 1; i < end; i++) {
            const t = travel[i - start] / total, a = original[start], b = original[end],
                straight = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            assign(points[i], [straight[0] + (original[i][0] - straight[0]) * factor, straight[1] + (original[i][1] - straight[1]) * factor]);
        }
    }
}

function addUrbanBridges(river, possible, size) {
    if (!possible.length) return;
    const travel = new Map();
    let along = 0;
    river.points.forEach((p, i) => {
        if (i) along += length(difference(p, river.points[i - 1]));
        travel.set(p, along);
    });
    const target = Math.max(1, Math.round(size / 8.5));
    const crossingCount = () => {
        const sorted = [...river.bridges.keys()].map(p => travel.get(p)).sort((a, b) => a - b);
        let count = 0, first = -Infinity, last = -Infinity;
        for (const at of sorted) {
            // Match the bank network's grouping of nearby crossings into one deck.
            if (at - last >= river.width * .65 || at - first >= river.width * 1.25) {
                count++;
                first = at;
            }
            last = at;
        }
        return count;
    };
    while (crossingCount() < target) {
        let best = null, gap = river.width * .7;
        for (const p of possible) {
            if (river.bridges.has(p)) continue;
            const nearest = Math.min(...[...river.bridges.keys()].map(other => Math.abs(travel.get(p) - travel.get(other))));
            if (nearest > gap) {
                best = p;
                gap = nearest;
            }
        }
        if (!best) break;
        river.bridges.set(best, null);
    }
}

export function updateRiverState(terrain) {
    const {sequence, mesh} = terrain, inner = new Set(terrain.urban);
    for (const river of terrain.rivers) {
        const {course} = river, positions = new Map(course.map((e, i) => [e.point, i]));
        const interior = point => positions.get(point) > 0 && positions.get(point) < course.length - 1;
        river.watergates = terrain.options.walls ? terrain.border.edges.map(e => e.point).filter(interior) : [];
        river.bridges = new Map();
        for (const artery of terrain.arteries) for (let i = 0; i < artery.length; i++) {
            const edge = artery[i];
            if (interior(edge.point) && (i === 0 || chainsCross(artery, edge, course, course[positions.get(edge.point)]))) river.bridges.set(edge.point, artery);
        }
        const candidates = [];
        for (let i = 2; i < course.length - 1; i++) {
            const edge = course[i];
            if ((inner.has(edge.cell) || inner.has(edge.twin.cell)) && !candidates.includes(edge.point)) candidates.push(edge.point);
        }
        const possible = candidates.filter(p => !river.watergates.includes(p)), count = possible.length;
        river.rural = count === 0;
        river.width = (3 + terrain.urban.length / 5) * (.8 + sequence.next() * .4) * (river.rural ? 1.5 : 1);
        if (terrain.options.riverWidthScale !== 1) river.width *= terrain.options.riverWidthScale;
        if (!river.rural) {
            let placed = [...river.bridges.keys()].filter(p => possible.includes(p)).length;
            const free = possible.filter(p => !river.bridges.has(p));
            while (sequence.next() < 1 - 2 * placed / count) {
                if (!free.length) throw new Error('Закончились допустимые места для мостов.');
                const weights = free.map(p => 1 / mesh.incident.get(p).length),
                    target = sequence.next() * weights.reduce((a, b) => a + b, 0);
                let sum = 0, index = 0;
                while (index < weights.length - 1 && target > (sum += weights[index])) index++;
                river.bridges.set(free[index], null);
                free.splice(index, 1);
                placed++;
            }
            addUrbanBridges(river, possible, terrain.urban.length);
        }
        markEdges(course, 'canal');
        river.footbridges = [];
        for (const [point, artery] of river.bridges) if (!artery) {
            const index = positions.get(point), outgoing = difference(course[index].next.point, point);
            if (index > 0) {
                const incoming = difference(course[index - 1].next.point, course[index - 1].point);
                outgoing[0] += incoming[0];
                outgoing[1] += incoming[1];
            }
            const scale = (river.width + 1.2) / 2 / length(outgoing),
                normal = [-outgoing[1] * scale, outgoing[0] * scale];
            river.footbridges.push([[point[0] - normal[0], point[1] - normal[1]], [point[0] + normal[0], point[1] + normal[1]]]);
        }
    }
    return terrain;
}
