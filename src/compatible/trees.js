import {Sequence} from './sequence.js';
import {fractalNoise} from './noise.js';
import {contains} from './polygons.js';
import {distance, midpoint, norm} from './math.js';
import {availableForCell} from './available.js';

export class PeriodicTreePattern {
    constructor(sequence, {width = 30, height = 30, spacing = 2.25} = {}) {
        if (!(width > 0 && height > 0 && spacing > 0) || ![width, height, spacing].every(Number.isFinite)) throw new Error('Некорректные размеры древесного узора.');
        this.width = width;
        this.height = height;
        this.spacing = spacing;
        this.points = [];
        const cell = spacing / Math.sqrt(2), columns = Math.ceil(width / cell), rows = Math.ceil(height / cell),
            grid = Array(columns * rows).fill(null), active = [];
        const emit = point => {
            this.points.push(point);
            active.push(point);
            grid[Math.floor(point[1] / cell) * columns + Math.floor(point[0] / cell)] = point;
        };
        const valid = point => {
            const column = Math.floor(point[0] / cell), row = Math.floor(point[1] / cell);
            for (let y = row - 2; y <= row + 2; y++) for (let x = column - 2; x <= column + 2; x++) {
                const other = grid[((y + rows) % rows) * columns + (x + columns) % columns];
                if (!other) continue;
                let dx = Math.abs(point[0] - other[0]), dy = Math.abs(point[1] - other[1]);
                dx = Math.min(dx, width - dx);
                dy = Math.min(dy, height - dy);
                if (dx * dx + dy * dy < spacing * spacing) return false;
            }
            return true;
        };
        emit([width * sequence.next(), height * sequence.next()]);
        for (let iteration = 0; active.length; iteration++) {
            if (iteration > 100000) throw new Error('Построение древесного узора не завершилось.');
            const index = Math.floor(sequence.next() * active.length), origin = active[index];
            let added = false;
            for (let trial = 0; trial < 50; trial++) {
                const radius = spacing * (1 + .1 * sequence.next()), angle = 6.28318530718 * sequence.next();
                const point = [origin[0] + radius * Math.cos(angle), origin[1] + radius * Math.sin(angle)];
                if (point[0] < 0) point[0] += width; else if (point[0] >= width) point[0] -= width;
                if (point[1] < 0) point[1] += height; else if (point[1] >= height) point[1] -= height;
                if (valid(point)) {
                    emit(point);
                    added = true;
                }
            }
            if (!added) active.splice(index, 1);
        }
    }

    inside(polygon) {
        const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
        if (!polygon.length || !xs.concat(ys).every(Number.isFinite)) throw new Error('Некорректный контур для размещения деревьев.');
        const minX = Math.floor(Math.min(...xs) / this.width), maxX = Math.ceil(Math.max(...xs) / this.width),
            minY = Math.floor(Math.min(...ys) / this.height), maxY = Math.ceil(Math.max(...ys) / this.height),
            result = [];
        for (let row = minY; row < maxY; row++) for (let column = minX; column < maxX; column++) for (const original of this.points) {
            const point = column === 0 && row === 0 ? original : [original[0] + column * this.width, original[1] + row * this.height];
            if (contains(polygon, point)) result.push(point);
        }
        return result;
    }
}

export class TreeField {
    constructor({patternSeed = 1} = {}) {
        const sequence = new Sequence(patternSeed);
        this.pattern = new PeriodicTreePattern(sequence);
        this.noise = fractalNoise(sequence, 5);
        this.checkpoint = sequence.checkpoint();
    }

    area(polygon, density = 1) {
        if (!Number.isFinite(density)) throw new Error('Плотность деревьев должна быть конечным числом.');
        return this.pattern.inside(polygon).filter(p => (this.noise(p[0] * .05, p[1] * .05) + 1) / 2 < density);
    }

    line(from, to, density, sequence) {
        const count = Math.ceil(distance(from, to) / 3), points = [];
        for (let index = 0; index < count; index++) {
            const t = (index + sequence.next()) / count,
                point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
            if ((this.noise(point[0] * .05, point[1] * .05) + 1) / 2 < density) points.push(point);
        }
        return points;
    }
}

export function buildAreaTrees(terrain, {field = new TreeField()} = {}) {
    if (!terrain.districts) throw new Error('Для деревьев во дворах нужны районы и застройка.');
    const trees = [], pending = [];
    for (const cell of terrain.cells) {
        if (cell.group?.core === cell) {
            const group = cell.group, density = group.district.parameters.greenery * (group.urban ? 1 : .1);
            for (const block of group.blocks || []) for (const polygon of block.courtyards) trees.push(...field.area(polygon, density));
        } else if (cell.ward === 'park') {
            const sequence = new Sequence(cell.seed), available = availableForCell(terrain, cell, sequence);
            if (sequence.draws) pending.push({cell: cell.id, reason: 'park-corner-sequence'});
            else if (available) trees.push(...field.area(available, cell.district.parameters.greenery));
        } else if (cell.ward === 'farm') pending.push({cell: cell.id, reason: 'farm-line-sequence'});
    }
    terrain.areaTrees = trees;
    terrain.pendingTreeCells = pending;
    return terrain;
}

export function geometryEndState(terrain) {
    const sequence = new Sequence(terrain.options.seed);
    let known = false;
    for (const cell of terrain.cells) {
        if (cell.geometrySequence) {
            sequence.restore(cell.geometrySequence);
            known = true;
        } else if (cell.ward === 'park' && known) {
            cell.parkAvailable = availableForCell(terrain, cell, sequence);
            cell.geometrySequence = sequence.checkpoint();
        }
    }
    if (!known) throw new Error('Не восстановлено состояние последовательности после геометрии.');
    terrain.geometryEnd = sequence.checkpoint();
    return terrain.geometryEnd;
}

function cityBounds(terrain) {
    let left = 0, right = 0, top = 0, bottom = 0;
    const include = polygon => {
        for (const p of polygon) {
            left = Math.min(left, p[0]);
            right = Math.max(right, p[0]);
            top = Math.min(top, p[1]);
            bottom = Math.max(bottom, p[1]);
        }
    };
    for (const district of terrain.districts) for (const group of district.groups) for (const block of group.blocks) include(block.polygon);
    if (terrain.castleWall) include(terrain.castleWall.polygon);
    return {left, right, top, bottom, width: right - left, height: bottom - top};
}

function crown(radius, sequence) {
    const average = count => Array.from({length: count}, () => sequence.next()).reduce((a, b) => a + b, 0) / count,
        points = [];
    for (let i = 0; i < 6; i++) {
        const angle = 2 * Math.PI * (i + average(3)) / 6, scale = radius * (1 - 4 / 6 * Math.abs(average(4) * 2 - 1));
        points.push([scale * Math.cos(angle), scale * Math.sin(angle)]);
    }
    const extend = (a, b, depth) => {
        if (depth > 30) throw new Error('Крона дерева не сошлась.');
        const direction = [a[0] - b[0], a[1] - b[1]], ratio = norm(direction) / radius;
        if (ratio <= .3) return [a];
        const factor = .5 * Math.min(ratio, 1), middle = midpoint(a, b),
            bulge = [middle[0] - direction[1] * factor, middle[1] + direction[0] * factor];
        return [...extend(a, bulge, depth + 1), ...extend(bulge, b, depth + 1)];
    };
    return points.flatMap((a, i) => extend(a, points[(i + 1) % points.length], 0));
}

export class CrownCache {
    constructor(mode = 'fresh', palette = null) {
        if (!['fresh', 'warm'].includes(mode)) throw new Error('Неизвестный режим кэша крон.');
        this.mode = mode;
        this.palette = palette ? [...palette] : mode === 'warm' ? Array(20).fill(null) : [];
    }

    next(sequence) {
        if (this.palette.length >= 20) return Math.floor(sequence.next() * this.palette.length);
        const average = (sequence.next() + sequence.next() + sequence.next()) / 3,
            radius = 1.5 * Math.pow(1.5, average * 2 - 1);
        this.palette.push(crown(radius, sequence));
        return this.palette.length - 1;
    }
}

export function buildCityTrees(terrain, {cacheMode = 'fresh', field = new TreeField()} = {}) {
    if (!['fresh', 'warm'].includes(cacheMode)) throw new Error('Неизвестный режим кэша крон.');
    const sequence = new Sequence(1);
    sequence.restore(geometryEndState(terrain));
    return sequence.checkpointOnError(() => {
        const bounds = cityBounds(terrain), cache = new CrownCache(cacheMode), positions = [], drawings = [];
        for (const cell of terrain.cells) {
            const points = [];
            if (cell.group?.core === cell) {
                const group = cell.group, density = group.district.parameters.greenery * (group.urban ? 1 : .1);
                for (const block of group.blocks) for (const polygon of block.courtyards) points.push(...field.area(polygon, density));
            } else if (cell.ward === 'park') {
                const available = availableForCell(terrain, cell, sequence);
                if (available) points.push(...field.area(available, cell.district.parameters.greenery));
            } else if (cell.ward === 'farm') {
                const radius = Math.max(bounds.width, bounds.height) * ((sequence.next() + sequence.next() + sequence.next()) / 3);
                for (const plot of cell.fields || []) for (let i = 0; i < plot.length; i++) {
                    const from = plot[(i + plot.length - 1) % plot.length], to = plot[i],
                        density = 1 - norm(midpoint(from, to)) / radius;
                    points.push(...field.line(from, to, density, sequence));
                }
            }
            for (const point of points) {
                const index = cache.next(sequence);
                positions.push(point);
                drawings.push({point, index});
            }
        }
        terrain.cityTrees = positions;
        terrain.treeDrawings = drawings;
        terrain.treeCrowns = cache.palette;
        terrain.treeCacheMode = cacheMode;
        terrain.treeEnd = sequence.checkpoint();
        terrain.cityBounds = bounds;
        return terrain;
    });
}
