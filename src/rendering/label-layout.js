import {area, bounds, centroid, inside} from '../core/geometry.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
}[c]));
let context;
const measuredWidths = new Map();

function textWidth(text, size, italic = true) {
    const key = JSON.stringify([text, size, italic]);
    if (measuredWidths.has(key)) return measuredWidths.get(key);
    if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (context) {
        context.font = `${italic ? 'italic ' : ''}${size}px Georgia,serif`;
        const width = context.measureText(text).width;
        if (measuredWidths.size >= 4096) measuredWidths.clear();
        measuredWidths.set(key, width);
        return width;
    }
    // SVG textLength also fixes the advance width when rendering without browser font metrics.
    return Array.from(text).reduce((sum, c) => sum + (/\s/u.test(c) ? .3 : /[ilI.,!'|]/u.test(c) ? .3 : /[ЖШЩЮМФW@]/u.test(c) ? .9 : .6), 0) * size;
}

export const labelBoxesOverlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function mapTextBox(text, x, y, size, padding = 0) {
    const width = textWidth(text, size, false);
    return {
        x: x - width / 2 - padding,
        y: y - size - padding,
        width: width + 2 * padding,
        height: size * 1.35 + 2 * padding
    };
}

function lineVariants(name, size, maxWidth) {
    const words = String(name).trim().split(/\s+/u);
    if (words.length === 1 && textWidth(words[0], size) > maxWidth) {
        const chunks = [];
        let chunk = '';
        for (const char of Array.from(words[0])) {
            if (chunk && textWidth(chunk + char, size) > maxWidth) {
                chunks.push(chunk);
                chunk = '';
            }
            chunk += char;
        }
        return [[words[0]], [...chunks, chunk]];
    }
    // Keep only the most balanced wrapping for each line count.
    const result = [[words.join(' ')]];
    for (let count = 2; count <= Math.min(3, words.length); count++) {
        let best = null;
        const split = (start, lines) => {
            if (lines.length === count - 1) {
                const candidate = [...lines, words.slice(start).join(' ')],
                    widths = candidate.map(line => textWidth(line, size));
                const score = Math.max(...widths) + .15 * (Math.max(...widths) - Math.min(...widths));
                if (!best || score < best.score - 1e-9) best = {lines: candidate, score};
                return;
            }
            for (let end = start + 1; end <= words.length - (count - lines.length - 1); end++) split(end, [...lines, words.slice(start, end).join(' ')]);
        };
        split(0, []);
        if (best) result.push(best.lines);
    }
    return result;
}

function districtAnchors(district) {
    const rings = district.rings || [district.polygon], polygon = district.polygon;
    const contains = p => rings.reduce((hit, ring) => inside(p, ring) ? !hit : hit, false);
    const [left, top, right, bottom] = bounds(polygon), center = district.center || centroid(polygon);
    const points = [center, centroid(polygon)];
    for (let row = 0; row < 9; row++) for (let column = 0; column < 9; column++) points.push([left + (column + .5) * (right - left) / 9, top + (row + .5) * (bottom - top) / 9]);
    return {contains, center, points: points.filter(contains), area: area(polygon)};
}

export function layoutDistrictLabels(districts, {box, fontSize, strokeWidth = 0, obstacles = []}) {
    const occupied = [...obstacles], placed = new Map(), padding = strokeWidth / 2 + fontSize * .2;
    const regions = districts.map((district, index) => ({
        district,
        index, ...districtAnchors(district)
    })).sort((a, b) => a.area - b.area || a.index - b.index);
    for (const region of regions) {
        const {district, center, contains} = region;
        if (!String(district.name).trim()) continue;
        let best = null;
        for (const ratio of [1, .9, .8]) {
            const size = fontSize * ratio, lineHeight = size * 1.4;
            for (const lines of lineVariants(district.name, size, box.width * .3)) {
                const widths = lines.map(line => textWidth(line, size));
                const width = Math.max(...widths) + 2 * (padding + size * .15),
                    height = (lines.length - 1) * lineHeight + size * 1.35 + 2 * padding;
                for (const [x, y] of region.points) {
                    const rect = {x: x - width / 2, y: y - height / 2, width, height};
                    if (rect.x < box.x || rect.y < box.y || rect.x + width > box.x + box.width || rect.y + height > box.y + box.height || occupied.some(other => labelBoxesOverlap(rect, other))) continue;
                    const spill = [[-.4, 0], [.4, 0], [0, -.4], [0, .4]].filter(([dx, dy]) => !contains([x + width * dx, y + height * dy])).length;
                    const score = Math.hypot(x - center[0], y - center[1]) / fontSize + 2 * (lines.length - 1) + 20 * (1 - ratio) + spill * 2;
                    if (!best || score < best.score - 1e-9) best = {
                        district,
                        x,
                        y: y - (lines.length - 1) * lineHeight / 2 + size * .325,
                        fontSize: size,
                        lineHeight,
                        lines,
                        widths,
                        box: rect,
                        score
                    };
                }
            }
        }
        // A crowded district keeps its name in the project and district panel, without painting over another label.
        if (best) {
            placed.set(district, best);
            occupied.push(best.box);
        }
    }
    return districts.flatMap(district => placed.has(district) ? [placed.get(district)] : []);
}

export function renderDistrictLabels(districts, options) {
    const {theme, strokeWidth} = options;
    return layoutDistrictLabels(districts, options).map(label => {
        const {district, x, y, fontSize, lineHeight, lines, widths} = label;
        const spans = lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}" textLength="${widths[index]}" lengthAdjust="spacingAndGlyphs">${escape(line)}</tspan>`).join('');
        const attribute = district.landmark ? 'data-label-landmark' : 'data-label-district';
        return `<text ${attribute}="${escape(district.landmark || district.id)}" x="${x}" y="${y}" aria-label="${escape(district.name)}" text-anchor="middle" font-family="Georgia,serif" font-size="${fontSize}" font-style="italic" fill="${theme.ink}" paint-order="stroke" stroke="${theme.paper}" stroke-width="${strokeWidth}" stroke-linejoin="round">${spans}</text>`;
    }).join('');
}
