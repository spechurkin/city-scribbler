import {buildInitialCells} from './cells.js';
import {classifyWater} from './noise.js';
import {connectedCellSets, selectUrbanCells, smoothBoundary} from './junctions.js';
import {Mesh, optimizeMesh} from './mesh.js';

export const COMPATIBLE_DEFAULTS = Object.freeze({
    citadel: true,
    urban_castle: false,
    plaza: true,
    temple: true,
    walls: true,
    shantytown: false,
    river: false,
    coast: true,
    greens: false,
    hub: false,
    gates: -1,
    sea: 0,
    coastOffset: 0,
    riverWidthScale: 1,
    riverCurvature: 1,
    housingDensity: 1
});

export function buildTerrain(parameters, {sequence} = {}) {
    const options = {...COMPATIBLE_DEFAULTS, ...parameters};
    const layout = buildInitialCells({...options, sequence}), mesh = new Mesh(layout.cells);
    classifyWater(layout, options);
    if (options.coast) {
        // The coastline exports one mainland polygon; detached islands belong to the sea mask.
        const mainland = new Set(connectedCellSets(layout.cells.filter(c => !c.water))[0] || []);
        for (const cell of layout.cells) if (!cell.water && !mainland.has(cell)) cell.water = true;
    }
    const selection = selectUrbanCells(layout, {...options, urbanCastle: options.urban_castle});
    for (const cell of layout.cells) cell.withinWalls = cell.urban && options.walls || cell === selection.castle;
    const closest = polygon => polygon.reduce((best, p) => p[0] * p[0] + p[1] * p[1] < best[0] * best[0] + best[1] * best[1] ? p : best);
    let center = closest(selection.centerCell.polygon);
    const collapsed = optimizeMesh(mesh, selection.castle);
    if (!mesh.incident.has(center)) center = closest(selection.urban[0].polygon);
    const horizon = mesh.boundary(mesh.cells, mesh.edges.find(e => !e.twin));
    for (const edge of horizon) edge.kind = 'horizon';
    const land = connectedCellSets(mesh.cells.filter(c => !c.water))[0] || [];
    const water = connectedCellSets(mesh.cells.filter(c => c.water))[0] || [];
    const earthEdges = options.coast ? mesh.boundary(land) : horizon;
    const waterEdges = water.length ? mesh.boundary(water) : [];
    if (options.coast) {
        if (!waterEdges.length || waterEdges.every(e => e.twin)) throw new Error('Водоём не достигает края карты.');
        smoothBoundary(waterEdges.map(e => e.point), 1 + Math.floor(layout.sequence.next() * 3));
    }
    let shore = earthEdges.filter(e => e.twin);
    if (shore.length && earthEdges[0].twin) {
        const start = earthEdges.findIndex((edge, i) => edge.twin && !earthEdges[(i + earthEdges.length - 1) % earthEdges.length].twin);
        if (start >= 0) shore = [...earthEdges.slice(start), ...earthEdges.slice(0, start)].filter(e => e.twin);
    }
    for (const edge of shore) {
        edge.kind = 'coast';
        if (edge.twin) edge.twin.kind = 'coast';
    }
    return {
        ...layout, ...selection,
        options,
        mesh,
        collapsed,
        horizon,
        earthEdges,
        waterEdges,
        shore,
        center,
        cells: [...layout.ordered]
    };
}

export const metricPoint = point => [point[0] * 4, -point[1] * 4];
