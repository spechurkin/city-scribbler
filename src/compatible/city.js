import {generateStructure} from './structure.js';
import {buildTowers} from './available.js';
import {buildDistricts} from './districts.js';
import {buildHousing} from './housing.js';
import {buildFields} from './fields.js';
import {buildSpecialBuildings} from './specials.js';
import {buildCityTrees} from './trees.js';
import {buildForests} from './forests.js';

export function generateCity(recipe, {processing = 'offset', treeCacheMode = 'fresh', forests = false} = {}) {
    if (!['none', 'offset'].includes(processing)) throw new Error('Неизвестный режим обработки застройки.');
    if (!['fresh', 'warm'].includes(treeCacheMode)) throw new Error('Неизвестный режим кэша крон.');
    if (typeof forests !== 'boolean') throw new Error('Параметр forests должен быть логическим.');
    const terrain = generateStructure(recipe, {
        additionalStages: [
            ['towers', buildTowers], ['districts', buildDistricts], ['housing', terrain => buildHousing(terrain, {processing})],
            ['fields', buildFields], ['specialBuildings', buildSpecialBuildings], ['cityTrees', terrain => buildCityTrees(terrain, {cacheMode: treeCacheMode})]
        ]
    });
    if (forests) buildForests(terrain);
    return terrain;
}
