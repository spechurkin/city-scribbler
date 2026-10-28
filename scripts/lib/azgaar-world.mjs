import Delaunator from 'delaunator';

const nextEdge = edge => edge % 3 === 2 ? edge - 2 : edge + 1;
const squaredDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const round = (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
const numbers = value => value.split(',').map(Number);

function adjacency(points, boundary) {
    const {triangles, halfedges} = Delaunator.from([...points, ...boundary]), neighbors = Array(points.length),
        border = [];
    for (let start = 0; start < triangles.length; start++) {
        const owner = triangles[nextEdge(start)];
        if (owner >= points.length || neighbors[owner]) continue;
        const ring = [];
        let edge = start;
        do {
            ring.push(triangles[edge]);
            edge = halfedges[nextEdge(edge)];
        } while (edge >= 0 && edge !== start && ring.length < 20);
        neighbors[owner] = ring.filter(index => index < points.length);
        border[owner] = ring.length !== neighbors[owner].length;
    }
    if (neighbors.filter(Boolean).length !== points.length) throw new Error('Не восстановлено соседство ячеек мира.');
    return {neighbors, border};
}

function neighborSpacing(spacing, sampling) {
    if (['square', 'diamond'].includes(sampling)) return spacing;
    if (['hexPointy', 'hexFlat'].includes(sampling)) return spacing * Math.sqrt(2 / Math.sqrt(3));
    if (sampling === 'triangle') return spacing * Math.sqrt(4 / Math.sqrt(3)) / Math.sqrt(3);
    throw new Error(`Неизвестная решётка мира: ${sampling}`);
}

function reconstructCells(grid, options, sections) {
    const {neighbors, border} = adjacency(grid.points, grid.boundary), heights = numbers(sections[7]),
        types = numbers(sections[10]), features = numbers(sections[9]);
    const points = [], packedHeights = [], sampling = grid.sampling || options.graph.sampling || 'square';
    const spacing = neighborSpacing(grid.spacing, sampling) * (1 + .9 - (options.graph.jitter ?? .9)),
        threshold = spacing ** 2;
    const add = (point, height) => {
        points.push(point);
        packedHeights.push(height);
    };
    for (let cell = 0; cell < grid.points.length; cell++) {
        const type = types[cell], height = heights[cell];
        if (height < 20 && type !== -1 && type !== -2) continue;
        if (type === -2 && (cell % 4 === 0 || grid.features[features[cell]]?.type === 'lake')) continue;
        add(grid.points[cell], height);
        if ((type === 1 || type === -1) && !border[cell]) for (const other of neighbors[cell]) {
            if (other < cell || types[other] !== type || squaredDistance(grid.points[cell], grid.points[other]) < threshold) continue;
            add([round((grid.points[cell][0] + grid.points[other][0]) / 2, 1), round((grid.points[cell][1] + grid.points[other][1]) / 2, 1)], height);
        }
    }
    const rivers = numbers(sections[22]), biomes = numbers(sections[16]);
    if (points.length !== biomes.length || rivers.length !== biomes.length) throw new Error(`Восстановлено ${points.length} ячеек вместо ${biomes.length}; параметры берега не будут угаданы.`);
    const packed = adjacency(points, grid.boundary), connections = sections[36] ? JSON.parse(sections[36]) : {};
    return points.map((point, i) => {
        const water = packed.neighbors[i].filter(other => packedHeights[other] < 20);
        const haven = water.length ? water.reduce((best, other) => squaredDistance(point, points[other]) < squaredDistance(point, points[best]) ? other : best) : 0;
        return {i, p: point, h: packedHeights[i], haven, r: rivers[i], biome: biomes[i], routes: connections[i] || {}};
    });
}

function legacyOptions(value, header) {
    const fields = value.split('|');
    return {
        seed: header[3],
        graph: {width: Number(header[4]), height: Number(header[5]), sampling: 'square', jitter: .9},
        lore: {name: fields[20]},
        units: {
            population: {
                scale: Number(fields[12] || 1000),
                urbanization: {rate: Number(fields[13] || 1), density: Number(fields[24] || 10)}
            }
        }
    };
}

export function parseAzgaarWorld(text) {
    if (text.trimStart().startsWith('{')) {
        const json = JSON.parse(text), options = json.settings?.options?.map || json.settings?.options;
        if (!json.pack?.cells || !json.pack?.burgs || !options?.units) throw new Error('Ожидается полный JSON-экспорт Azgaar.');
        return {
            version: json.info.version,
            seed: String(json.info.seed),
            name: json.info.mapName,
            options,
            cells: json.pack.cells,
            burgs: json.pack.burgs,
            routes: json.pack.routes || [],
            legacy: false
        };
    }
    const sections = text.split('\r\n'), header = sections[0].split('|');
    if (sections.length < 38 || !header[1]?.includes('azgaar.github.io/Fantasy-Map-Generator')) throw new Error('Ожидается несжатый файл .map Azgaar с разделителями CRLF.');
    const legacy = !sections[1].startsWith('{'),
        options = legacy ? legacyOptions(sections[1], header) : JSON.parse(sections[1]);
    const grid = JSON.parse(sections[6]), burgs = JSON.parse(sections[15]);
    if (!Array.isArray(burgs) || !Array.isArray(grid.points) || !options.units?.population) throw new Error('В мире нет данных для восстановления городов.');
    return {
        version: header[0],
        seed: header[3],
        name: options.lore?.name || '',
        options,
        cells: reconstructCells(grid, options, sections),
        burgs,
        routes: sections[37] ? JSON.parse(sections[37]) : [],
        legacy
    };
}

export function azgaarCityLink(world, burg) {
    if (!burg?.i || burg.removed) throw new Error('Ожидается действующий город.');
    if (burg.link) return {url: burg.link, origin: 'stored-link', uncertainties: []};
    const cell = world.cells[burg.cell], units = world.options.units.population;
    if (!cell) throw new Error(`Не найдена ячейка ${burg.cell}.`);
    if (!(units.scale > 0 && units.urbanization?.density > 0 && units.urbanization?.rate >= 0) || !(burg.population >= 0)) throw new Error('Некорректные население или единицы населения.');
    const connections = Object.values(cell.routes || {}), routes = new Map(world.routes.map(route => [route.i, route]));
    const hub = connections.length > 3 || connections.filter(id => routes.get(id)?.group === 'roads').length > 2;
    const coast = Boolean(burg.port && cell.haven), river = Boolean(cell.r), citadel = Boolean(burg.citadel),
        plaza = Boolean(burg.plaza);
    const seed = String(burg.MFCG || world.seed + String(burg.i).padStart(4, '0'));
    const size = Math.min(100, Math.max(6, Math.ceil(2.13 * ((burg.population * units.scale) / units.urbanization.density) ** .385)));
    const flags = {
        river,
        coast,
        farms: (river ? [1, 2, 3, 4, 5, 6, 7, 8] : [5, 6, 7, 8]).includes(cell.biome),
        citadel,
        urban_castle: citadel && burg.i % 2 === 0,
        hub,
        plaza,
        greens: plaza,
        temple: Boolean(burg.temple),
        walls: Boolean(burg.walls),
        shantytown: Boolean(burg.shanty)
    };
    const url = new URL('https://watabou.github.io/city-generator/');
    url.searchParams.set('name', burg.name || '');
    url.searchParams.set('population', String(round(burg.population * units.scale * units.urbanization.rate)));
    url.searchParams.set('size', String(size));
    url.searchParams.set('seed', seed);
    for (const [key, value] of Object.entries(flags)) url.searchParams.set(key, String(Number(value)));
    url.searchParams.set('style', 'natural');
    if (coast) {
        const water = world.cells[cell.haven];
        if (!water?.p || !cell.p) throw new Error('Для направления моря нужны координаты береговой и водной ячеек.');
        const angle = Math.atan2(water.p[1] - cell.p[1], water.p[0] - cell.p[0]) / Math.PI;
        const sea = round(angle <= 0 ? Math.abs(angle) : 2 - angle, 2);
        if (sea) url.searchParams.set('sea', String(sea));
    }
    const uncertainties = ['citadel', 'plaza', 'temple', 'walls', 'shanty'].filter(key => burg[key] === undefined).map(key => `missing-${key}`);
    return {url: url.href, origin: burg.MFCG ? 'stored-seed' : 'derived', uncertainties};
}
