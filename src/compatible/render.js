export function renderStructure(geometry, {title = ''} = {}) {
    const xml = value => String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
    }[char]));
    const path = (points, closed = false) => points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') + (closed ? 'Z' : '');
    const paths = (polygons, closed = true) => polygons.map(p => `<path d="${path(p, closed)}"/>`).join('');
    const urban = geometry.cells.filter(c => c.urban).flatMap(c => c.polygon);
    const points = urban.length ? urban : geometry.earth, xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const box = [Math.min(...xs) - 100, Math.min(...ys) - 250, Math.max(...xs) - Math.min(...xs) + 200, Math.max(...ys) - Math.min(...ys) + 400];
    const detail = geometry.experimental, lots = detail?.housing || [], forests = detail?.forests || [],
        palette = detail?.treeCrowns || [];
    const crowns = palette.map((crown, i) => crown ? `<path id="crown-${i}" d="${path(crown, true)}"/>` : '').join('');
    const tree = ({
                      point,
                      index
                  }) => palette[index] ? `<use href="#crown-${index}" transform="translate(${point.join(' ')})"/>` : `<circle cx="${point[0]}" cy="${point[1]}" r="2.8"/>`;
    const layer = (id, attributes, content) => content ? `<g id="layer-${id}" ${attributes}>${content}</g>` : '';
    const treeStyle = 'fill="#9baf8c" stroke="#56694b" stroke-width=".8"';
    const forestLayer = layer('forests', 'fill="#d0d5be" stroke="#879675" stroke-width="1.2" fill-rule="evenodd"', forests.map(f => `<path d="${f.polygons.map(p => path(p, true)).join('')}"/>`).join(''));
    const forestTrees = layer('forest-trees', treeStyle, forests.flatMap(f => f.trees).map(tree).join(''));
    const fieldsLayer = layer('fields', 'fill="#dedbc9" stroke="#aaa78f" stroke-width="1.2"', paths(detail?.fields || []));
    const squares = layer('squares', 'fill="#e8e1ce" stroke="#b1a88e" stroke-width="1"', paths(detail?.squares || []));
    const housing = layer('housing', 'fill="#bcb5a4" stroke="#384235" stroke-width=".8"', paths(lots));
    const specials = layer('special-buildings', 'fill="#aaa18d" stroke="#384235" stroke-width="1.6"', (detail?.specialBuildings || []).map(b => `<path data-kind="${xml(b.kind)}" d="${path(b.polygon, true)}"/>`).join(''));
    const alleys = layer('alleys', 'fill="none" stroke="#f3f1e8" stroke-width="4.8"', `<g stroke-linecap="round" stroke-linejoin="round">${paths(detail?.localStreets || [], false)}${paths(detail?.wallStreets || [], false)}<g stroke-width="3.2">${paths(detail?.outerWallStreets || [], false)}</g></g>${paths(detail?.alleys || [], false)}`);
    const drawings = detail?.treeDrawings?.length ? detail.treeDrawings : (detail?.trees || []).map(point => ({point}));
    const trees = layer('trees', treeStyle, drawings.map(tree).join(''));
    const roads = layer('roads', 'fill="none" stroke="#665b49" stroke-width="8"', paths(geometry.roads, false));
    const rivers = layer('river-course', 'fill="none" stroke="#315f70"', geometry.rivers.map((p, i) => `<path d="${path(p)}" stroke-width="${geometry.riverWidths[i]}"/>`).join(''));
    const planks = layer('planks', 'fill="none" stroke="#615445" stroke-width="4.8"', paths(geometry.planks, false));
    const walls = layer('walls', 'fill="none" stroke="#272d27" stroke-width="7.6"', geometry.walls.map(w => w.segments ? w.polygon.map((p, i) => w.segments[i] ? `<path d="${path([p, w.polygon[(i + 1) % w.polygon.length]])}"/>` : '').join('') : `<path d="${path(w.polygon, true)}"/>`).join(''));
    const towers = layer('towers', 'fill="#aaa18d" stroke="#272d27" stroke-width="2"', geometry.walls.flatMap(w => w.towers || []).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="10"/>`).join(''));
    const gates = layer('gates', 'fill="#f3f1e8" stroke="#272d27" stroke-width="3"', geometry.walls.flatMap(w => w.gates).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="10"/>`).join(''));
    const monuments = layer('monuments', 'fill="#aaa18d" stroke="#384235" stroke-width="1.2"', paths(detail?.monuments || []));
    const description = detail ? 'Экспериментальные слои; полное совпадение не достигнуто' : 'Структура города; подробные слои отключены';
    const middle = box[0] + box[2] / 2, subtitleSize = Math.min(30, box[2] / 45);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" width="1400" height="1400"><title>${xml(title || 'Город')} · собственная генерация</title><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="#f3f1e8"/><defs>${crowns}<clipPath id="map-area"><rect x="${box[0]}" y="${box[1] + 240}" width="${box[2]}" height="${box[3] - 240}"/></clipPath></defs><g clip-path="url(#map-area)"><g id="layer-earth"><path d="${path(geometry.earth, true)}" fill="#e4e1d3" stroke="#888577" stroke-width="3"/></g><g id="layer-water"><path d="${path(geometry.water, true)}" fill="#b9d3d7" stroke="#698b92" stroke-width="3"/></g><g id="layer-cells" fill="none" stroke="#aaa798" stroke-width="1">${geometry.cells.filter(c => !c.water).map(c => `<path d="${path(c.polygon, true)}"${c.urban ? ' fill="#eee9da"' : ''}/>`).join('')}</g>${forestLayer}${fieldsLayer}${squares}${housing}${specials}${alleys}${forestTrees}${trees}${roads}${rivers}${planks}${walls}${towers}${gates}${monuments}</g><text x="${middle}" y="${box[1] + 115}" text-anchor="middle" fill="#272d27" font-family="Georgia,serif" font-size="${Math.min(90, box[2] / Math.max(10, title.length) * 1.4)}">${xml(title || 'Город')}</text><text x="${middle}" y="${box[1] + 172}" text-anchor="middle" fill="#3e453d" font-family="sans-serif" font-size="${subtitleSize}">Сид ${xml(geometry.recipe.seed)}</text><text x="${middle}" y="${box[1] + 215}" text-anchor="middle" fill="#3e453d" font-family="sans-serif" font-size="${subtitleSize}">${description}</text></svg>`;
}
