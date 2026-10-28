import {buildTerrain, COMPATIBLE_DEFAULTS, metricPoint} from './terrain.js';
import {buildWalls} from './walls.js';
import {buildRoutes, chainPoints} from './routes.js';
import {buildRiver, updateRiverState} from './river.js';
import {assignWards, buildPiers} from './wards.js';
import {Sequence} from './sequence.js';
import {connectedAlleys, localStreets, outerWallStreets, wallStreets} from './local-streets.js';
import {segmentDistance} from '../core/geometry.js';

export const STRUCTURE_VERSION = '0.2.0-structure.1';

export function structureOptions(parameters) {
    const options = {...COMPATIBLE_DEFAULTS, ...parameters};
    if (!Number.isSafeInteger(options.size) || options.size < 6 || options.size > 200) throw new Error('Для экспериментального движка размер должен быть целым числом от 6 до 200.');
    if (!Number.isFinite(options.sea) || Math.abs(options.sea) > 100) throw new Error('Некорректное направление моря.');
    if (!Number.isSafeInteger(options.gates) || options.gates < -1 || options.gates > 1000) throw new Error('Некорректное количество ворот.');
    for (const [key, min, max] of [['coastOffset', -.3, .3], ['riverWidthScale', .25, 3], ['riverCurvature', 0, 2], ['housingDensity', .25, 4]]) if (!Number.isFinite(options[key]) || options[key] < min || options[key] > max) throw new Error(`Параметр ${key} должен быть от ${min} до ${max}.`);
    for (const key of Object.keys(COMPATIBLE_DEFAULTS).filter(k => typeof COMPATIBLE_DEFAULTS[k] === 'boolean')) if (typeof options[key] !== 'boolean') throw new Error(`Параметр ${key} должен быть логическим.`);
    return options;
}

export function generateStructure(parameters, {additionalStages = []} = {}) {
    const options = structureOptions(parameters), sequence = new Sequence(options.seed), attempts = [];
    for (let index = 0; index < 64; index++) {
        let stage = 'terrain';
        const start = sequence.checkpoint();
        try {
            const terrain = buildTerrain(options, {sequence});
            for (const [name, build] of [['walls', buildWalls], ['routes', buildRoutes], ['river', buildRiver], ['wards', assignWards], ['riverState', updateRiverState], ['piers', buildPiers], ...additionalStages]) {
                stage = name;
                build(terrain);
            }
            terrain.attempts = attempts;
            terrain.attemptStart = start;
            return terrain;
        } catch (error) {
            if (error.generationCheckpoint) sequence.restore(error.generationCheckpoint);
            attempts.push({start, stage, message: error.message, end: sequence.checkpoint()});
        }
    }
    throw new Error('Структура не построена за 64 попытки.', {cause: attempts});
}

export function structureGeometry(terrain) {
    const wallRoads = terrain.districts ? wallStreets(terrain) : [],
        outerWallRoads = terrain.districts ? outerWallStreets(terrain) : [];
    const castleWalls = terrain.walls.filter(w => terrain.cells.some(c => c.ward === 'castle' && c.polygon.length === w.polygon.length && c.polygon.every(p => w.polygon.includes(p))));
    const castleCorridors = outerWallRoads.filter(path => {
        let nearest = null, distance = Infinity;
        for (const wall of terrain.walls) for (const p of path) wall.polygon.forEach((a, i) => {
            const d = segmentDistance(p, a, wall.polygon[(i + 1) % wall.polygon.length]);
            if (d < distance) {
                distance = d;
                nearest = wall;
            }
        });
        return castleWalls.includes(nearest);
    });
    return {
        format: 'gradopisets-structure', version: STRUCTURE_VERSION,
        recipe: terrain.options,
        completeness: {
            terrain: true,
            fortifications: true,
            mainRoutes: true,
            riverCourse: true,
            buildings: Boolean(terrain.specialBuildings && terrain.housingProcessing),
            minorRoutes: Boolean(terrain.housingProcessing),
            riverWidth: true,
            harbours: true,
            fields: Boolean(terrain.fields),
            trees: Boolean(terrain.cityTrees),
            forests: Boolean(terrain.forests),
            districts: Boolean(terrain.districts),
            fullySeedCompatible: false
        },
        earth: terrain.earthEdges.map(e => metricPoint(e.point)),
        water: terrain.waterEdges.map(e => metricPoint(e.point)),
        cells: terrain.cells.map(cell => ({
            id: cell.id,
            seed: cell.seed,
            urban: cell.urban,
            water: cell.water,
            ward: cell.ward,
            landing: cell.landing || false,
            polygon: cell.polygon.map(metricPoint)
        })),
        walls: terrain.walls.map(wall => ({
            polygon: wall.polygon.map(metricPoint),
            gates: wall.gates.map(metricPoint),
            segments: wall.segments,
            towers: (wall.towers || []).map(metricPoint)
        })),
        gates: terrain.gates.map(metricPoint),
        roads: terrain.arteries.map(chainPoints).map(polygon => polygon.map(metricPoint)),
        rivers: terrain.rivers.map(river => river.points.map(metricPoint)),
        riverWidths: terrain.rivers.map(river => river.width * 4),
        riverCrossings: terrain.rivers.map(river => [...river.bridges].map(([point, artery]) => ({
            point: metricPoint(point),
            pedestrian: !artery
        }))),
        piers: terrain.piers.map(pier => pier.map(metricPoint)),
        planks: [...terrain.piers, ...terrain.rivers.flatMap(river => river.footbridges)].map(plank => plank.map(metricPoint)),
        experimental: terrain.districts ? {
            districts: terrain.districts.map(d => ({
                id: d.id,
                type: d.type,
                parameters: d.parameters,
                polygon: d.border.map(e => metricPoint(e.point))
            })),
            housing: terrain.districts.flatMap(d => d.groups.flatMap(g => (g.blocks || []).flatMap(b => b.lots))).map(p => p.map(metricPoint)),
            specialBuildings: (terrain.specialBuildings || []).map(building => ({
                ...building,
                polygon: building.polygon.map(metricPoint)
            })),
            monuments: (terrain.monuments || []).map(p => p.map(metricPoint)),
            squares: (terrain.squares || []).map(p => p.map(metricPoint)),
            alleys: terrain.districts.flatMap(d => d.groups.flatMap(g => g.alleys || [])).map(p => p.map(metricPoint)),
            connectedAlleys: connectedAlleys(terrain, castleCorridors).map(p => p.map(metricPoint)),
            localStreets: localStreets(terrain).map(p => p.map(metricPoint)),
            wallStreets: wallRoads.map(p => p.map(metricPoint)),
            outerWallStreets: outerWallRoads.map(p => p.map(metricPoint)),
            fields: (terrain.fields || []).map(p => p.map(metricPoint)),
            trees: (terrain.cityTrees || terrain.areaTrees || []).map(metricPoint),
            treeCacheMode: terrain.treeCacheMode || null,
            treeEnd: terrain.treeEnd || null,
            geometryEnd: terrain.geometryEnd || null,
            treeDrawings: (terrain.treeDrawings || []).map(tree => ({
                point: metricPoint(tree.point),
                index: tree.index
            })),
            treeCrowns: (terrain.treeCrowns || []).map(crown => crown ? crown.map(metricPoint) : null),
            forests: (terrain.forests || []).map(forest => ({
                polygons: forest.polygons.map(p => p.map(metricPoint)),
                trees: forest.trees.map(tree => ({point: metricPoint(tree.point), index: tree.index}))
            })),
            pendingTreeCells: terrain.pendingTreeCells || [],
            processing: terrain.housingProcessing || null
        } : null,
        sequence: terrain.sequence.checkpoint(),
        attempts: terrain.attempts, attemptStart: terrain.attemptStart
    };
}
