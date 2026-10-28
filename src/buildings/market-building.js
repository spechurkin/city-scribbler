import {centroid, inside, rectangle} from '../core/geometry.js';

export function marketParts(market, stalls = market.stalls) {
    return {
        ...Object.fromEntries(stalls.map((stall, i) => [`stall_${i}`, stall.polygon || stall])),
        ...(market.center ? {fountain: rectangle(market.center, (market.radius || 7) * 2, (market.radius || 7) * 2)} : {})
    };
}

export function restoreEditorMarkets(city) {
    const markets = city.markets || (city.plaza ? [city.plaza] : []);
    const removed = new Set();
    for (const market of markets) {
        const stalls = city.buildings.filter(b => b.kind === 'stall' && (!b.custom || b.nativeStallShade !== undefined) && inside(centroid(b.polygon), market.polygon));
        stalls.forEach(b => removed.add(b.id));
        city.buildings.push({
            id: `building-${city.editor.nextId++}`,
            kind: 'market', name: '', polygon: market.polygon, rings: [market.polygon],
            parts: marketParts(market, stalls.length ? stalls : market.stalls || []),
            marketStallShades: stalls.length ? stalls.map(b => b.nativeStallShade ?? b.shade) : (market.stalls || []).map((b, i) => b.shade ?? i),
            district: market.district ?? city.districts.find(d => inside(centroid(market.polygon), d.polygon))?.id ?? null,
            shade: 0
        });
    }
    city.buildings = city.buildings.filter(b => !removed.has(b.id));
    const samePolygon = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
    if (city.squares) city.squares = city.squares.filter(p => !markets.some(m => samePolygon(p, m.polygon)));
    if (city.markets) city.markets = [];
    if (city.plaza) city.plaza = null;
    return city;
}

export function renderMarketStall(polygon, shade, theme) {
    const at = (x, y) => [polygon[0][0] + (polygon[1][0] - polygon[0][0]) * x + (polygon[3][0] - polygon[0][0]) * y, polygon[0][1] + (polygon[1][1] - polygon[0][1]) * x + (polygon[3][1] - polygon[0][1]) * y];
    const stripes = [.2, .4, .6, .8].map(x => `<path d="M${at(x, 0).join(',')}L${at(x, 1).join(',')}"/>`).join('');
    return `<g data-building-part="awning" stroke="${theme.roofLine}" stroke-width=".7" stroke-linejoin="round"><path d="M${polygon.map(p => p.join(',')).join('L')}Z" fill="${theme.roof[shade % theme.roof.length]}"/><g fill="none" stroke-width=".45">${stripes}</g></g>`;
}

export function renderMarketBuilding(building, theme, legacy = false) {
    const poly = (p, attrs) => `<path d="M${p.map(p => p.join(',')).join('L')}Z" ${attrs}/>`;
    const ground = poly(building.polygon, `fill="${theme.street}"${legacy ? ` stroke="${theme.fieldLine}" stroke-width=".9"` : ''}`);
    const stalls = Object.entries(building.parts).filter(([key]) => /^stall_\d+$/.test(key)).map(([key, p]) => {
        const shade = building.marketStallShades?.[Number(key.slice(6))] ?? Number(key.slice(6));
        if (!legacy) return renderMarketStall(p, shade, theme);
        const a = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2],
            b = [(p[3][0] + p[2][0]) / 2, (p[3][1] + p[2][1]) / 2];
        return poly(p, `fill="${[theme.accent, theme.green[0], theme.roof[2]][shade % 3]}" stroke="${theme.ink}" stroke-width=".6"`) + `<path d="M${a.join(',')}L${b.join(',')}" stroke="${theme.street}" stroke-width="1.5"/>`;
    }).join('');
    const p = building.parts.fountain;
    let fountain = '';
    if (p) {
        const center = [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2];
        const axis = [(p[1][0] - p[0][0]) / 2, (p[1][1] - p[0][1]) / 2, (p[3][0] - p[0][0]) / 2, (p[3][1] - p[0][1]) / 2];
        const circle = (radius, attrs) => `<circle r="${radius}" ${attrs} vector-effect="non-scaling-stroke"/>`;
        fountain = `<g transform="matrix(${[...axis, ...center].join(' ')})">${legacy ? circle(1, `fill="${theme.wall}" stroke="${theme.roofLine}" stroke-width="1.2"`) + circle(3.8 / 7, `fill="${theme.water}" stroke="${theme.bank}" stroke-width=".6"`) : circle(1, `fill="${theme.water}" stroke="${theme.ink}" stroke-width=".8"`)}</g>`;
    }
    return `<g data-building-architecture="market">${ground}${stalls}${fountain}</g>`;
}
