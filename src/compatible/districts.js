import {smoothBoundary} from './junctions.js';

const pick = (items, rng) => items[Math.floor(rng.next() * items.length)];
const remove = (items, item) => {
    const index = items.indexOf(item);
    if (index >= 0) items.splice(index, 1);
};
const shuffle = (items, rng) => {
    const result = [];
    for (const item of items) result.splice(Math.floor(rng.next() * (result.length + 1)), 0, item);
    return result;
};
const average = (rng, count) => Array.from({length: count}, () => rng.next()).reduce((a, b) => a + b, 0) / count;

function districtParameters(type, rng) {
    const minArea = 15 + 40 * Math.abs(average(rng, 4) * 2 - 1), gridChaos = .2 + average(rng, 3) * .8,
        sizeChaos = .4 + average(rng, 3) * .6;
    const shapeFactor = .25 + average(rng, 3) * 2, inset = .6 * (1 - Math.abs(average(rng, 4) * 2 - 1)),
        blockSize = 4 + average(rng, 3) * 10;
    const greenery = average(rng, 3) ** (type === 'park' ? 1 : 2);
    return {
        minArea,
        gridChaos: gridChaos * (type === 'outskirts' ? .5 : 1),
        sizeChaos,
        shapeFactor,
        inset,
        blockSize: blockSize * (type === 'outskirts' ? 2 : 1),
        minFront: Math.sqrt(minArea),
        greenery: type === 'outskirts' ? (1 + greenery) / 2 : greenery
    };
}

function hasHole(mesh, cells) {
    const members = new Set(cells), boundary = [];
    for (const cell of cells) for (const edge of mesh.cycle(cell)) if (!edge.twin || !members.has(edge.twin.cell)) boundary.push(edge);
    if (new Set(boundary.map(e => e.point)).size !== boundary.length) return true;
    return mesh.boundary(cells, boundary[0]).length !== boundary.length;
}

function createGroups(terrain, district) {
    const {mesh, sequence} = terrain, available = district.cells.filter(c => c.ward === 'housing'), groups = [];
    while (available.length) {
        const first = pick(available, sequence);
        remove(available, first);
        let members = [first];
        for (; ;) {
            if (available.length > 1 && sequence.next() < (members.length - 3) / members.length) break;
            const choices = [];
            for (const cell of members) for (const edge of mesh.cycle(cell)) if (!edge.kind && edge.twin && available.includes(edge.twin.cell) && !members.includes(edge.twin.cell)) choices.push(edge.twin.cell);
            if (!choices.length) break;
            const next = pick(choices, sequence);
            remove(available, next);
            members.push(next);
        }
        if (members.length > 1 && hasHole(mesh, members)) {
            for (const cell of members.slice(1)) if (!available.includes(cell)) available.push(cell);
            members = [first];
        }
        const boundary = members.length === 1 ? mesh.cycle(first) : members.length < district.cells.length ? mesh.boundary(members) : district.border;
        const group = {core: first, cells: members, border: boundary, district};
        for (const cell of members) cell.group = group;
        groups.push(group);
    }
    district.groups = groups;
    for (const group of groups) if (group.cells.length > 1) {
        const polygon = group.border.map(e => e.point), fixed = new Set(polygon.filter(point =>
            mesh.incident.get(point).some(e => e.kind && e.kind !== 'horizon') || mesh.cellsAt(point).some(c => c.ward !== 'housing')
        ));
        smoothBoundary(polygon, 2, fixed);
    }
}

export function buildDistricts(terrain) {
    const {mesh, sequence} = terrain, city = terrain.cells.filter(c => c.urban), unassigned = [...city], districts = [];
    const inner = new Set(terrain.urban);
    const typeOf = cell => cell.ward === 'castle' ? 'castle' : cell.ward === 'park' ? 'park' : cell.landing && cell.ward === 'housing' ? 'docks' : inner.has(cell) ? 'regular' : 'outskirts';
    const create = (cells, type) => {
        if (!cells.length) return null;
        const district = {
            id: districts.length,
            cells: [...cells],
            type,
            parameters: districtParameters(type, sequence)
        };
        districts.push(district);
        for (const cell of cells) {
            cell.district = district;
            remove(unassigned, cell);
        }
        return district;
    };
    const fromCell = (cell, type) => cell.district ? null : create([cell], type || typeOf(cell));
    const fromPoint = (point, type) => {
        const adjacent = mesh.cellsAt(point).filter(c => city.includes(c)), free = adjacent.filter(c => !c.district);
        return free.length && free.length === adjacent.length ? create(free, type) : null;
    };
    let initiatives = [];
    const addCell = (cell, type) => initiatives.push({cell, type: type || typeOf(cell)});
    const addPoint = (point, type) => initiatives.push({point, type});
    if (terrain.castleWall) addPoint(terrain.castleWall.gates[0], 'castle');
    if (terrain.options.plaza) addCell(terrain.plaza, 'center'); else addPoint(terrain.center, 'center');
    for (const cell of unassigned) if (cell.ward === 'park') addCell(cell, 'park');
    if (terrain.options.walls) for (const gate of terrain.border.gates) addPoint(gate, 'gate');
    for (const river of terrain.rivers) {
        for (const point of [...river.bridges.keys()].sort((a, b) => mesh.vertexOrder.get(a) - mesh.vertexOrder.get(b))) addPoint(point, 'bridge');
        const left = pick(river.course, sequence).cell, right = pick(river.course, sequence).twin.cell;
        if (left.urban) addCell(left, 'bank');
        if (right.urban) addCell(right, 'bank');
    }
    const landing = unassigned.find(c => c.landing && c.ward === 'housing');
    if (landing) addCell(landing, 'docks');
    const initialCount = initiatives.length;
    for (let index = 0; index < initialCount; index++) addCell(pick(city, sequence));
    const target = Math.trunc(Math.sqrt(city.length));
    initiatives = shuffle(initiatives, sequence).slice(0, target);
    while (initiatives.length < target) addCell(pick(city, sequence));
    const docks = initiatives.filter(i => i.type === 'docks');
    if (docks.length > 1) {
        initiatives = initiatives.filter(i => i.type !== 'docks');
        initiatives.push(pick(docks, sequence));
    }
    for (const initiative of initiatives) if (initiative.cell) fromCell(initiative.cell, initiative.type); else fromPoint(initiative.point, initiative.type);
    const rate = district => ['castle', 'bridge', 'gate'].includes(district.type) ? .1 : district.type === 'bank' ? .5 : 1;
    const grow = district => {
        if (sequence.next() < 1 - rate(district)) return true;
        const candidates = [];
        for (const cell of district.cells) for (const edge of mesh.cycle(cell)) if (edge.twin && unassigned.includes(edge.twin.cell)) {
            const next = edge.twin.cell;
            const suitable = district.type === 'docks' ? next.landing && next.ward === 'housing' : district.type === 'park' ? next.ward === 'park' : Boolean(next.landing) === Boolean(cell.landing);
            const crossing = ['wall', 'canal'].includes(edge.kind) ? 0 : edge.kind === 'road' ? .9 : 1;
            if (sequence.next() < (suitable ? 1 : 0) * crossing) candidates.push(next);
        }
        if (!candidates.length) return false;
        const next = pick(candidates, sequence);
        district.cells.push(next);
        next.district = district;
        remove(unassigned, next);
        return true;
    };
    const growers = [...districts];
    for (let round = 0; growers.length && unassigned.length; round++) {
        if (round > 10000) throw new Error('Распределение районов не сошлось.');
        for (const district of shuffle(growers, sequence)) {
            if (!grow(district)) remove(growers, district);
            if (!unassigned.length) break;
        }
    }
    while (unassigned.length) {
        const district = fromCell(pick(unassigned, sequence));
        for (let round = 0; grow(district); round++) if (round > 10000) throw new Error('Рост дополнительного района не сошёлся.');
    }
    for (const district of districts) {
        district.border = district.cells.length === 1 ? mesh.cycle(district.cells[0]) : mesh.boundary(district.cells);
        createGroups(terrain, district);
    }
    terrain.districts = districts;
    if (terrain.options.housingDensity !== 1) for (const district of districts) {
        district.parameters.minArea /= terrain.options.housingDensity;
        district.parameters.minFront = Math.sqrt(district.parameters.minArea);
    }
    return terrain;
}
