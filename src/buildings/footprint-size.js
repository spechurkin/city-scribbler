import {area, distance, signedArea} from '../core/geometry.js';
import {inscribedRectangle} from '../compatible/rectangles.js';

export const EDITOR_HOUSE_SIZE = Object.freeze({width: 12, depth: 9, area: 108});
export const MIN_REGENERATED_HOUSE_SIZE = Object.freeze({width: 9, depth: 9, area: 81});

export const MIN_FOOTPRINT_SIZE = Object.freeze({
    house: {width: 6, depth: 4, area: 32},
    farmhouse: {width: 8, depth: 6, area: 48},
    castle: {width: 24, depth: 16, area: 384},
    temple: {width: 32, depth: 24, area: 768},
    market: {width: 36, depth: 24, area: 864}
});

export function footprintFrame(polygon, minimum = null) {
    const rect = inscribedRectangle(signedArea(polygon) > 0 ? polygon : [...polygon].reverse(), minimum);
    if (!rect) return null;
    if (distance(rect[0], rect[1]) < distance(rect[1], rect[2])) rect.push(rect.shift());
    return {rect, width: distance(rect[0], rect[1]), height: distance(rect[0], rect[3])};
}

export function fitsFootprint(polygon, kind = 'house') {
    const minimum = MIN_FOOTPRINT_SIZE[kind] || MIN_FOOTPRINT_SIZE.house;
    if (polygon.length < 3 || area(polygon) < minimum.area - 1e-7) return false;
    const {width, height} = footprintFrame(polygon);
    return width >= minimum.width - 1e-7 && height >= minimum.depth - 1e-7 || !!footprintFrame(polygon, minimum);
}
