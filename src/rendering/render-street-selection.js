export function renderStreetSelection(city, theme, selected, escape) {
    const selectedGroup = city.streets.find(r => r.streetId === selected || String(r.id) === selected)?.streetId;
    const seen = new Set(), k = (city.viewBox?.width || 1600) / 1600;
    let hits = '', selection = '';
    for (const road of city.streets) {
        const points = road.points || [road.a, road.b];
        if (points.length < 2) continue;
        const id = road.streetId, d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
        const width = road.width || 5 * k, first = !seen.has(id);
        seen.add(id);
        hits += `<path d="${d}" stroke-width="${Math.max(width, 6 * k)}" data-street="${escape(id)}" class="street-hit" role="button" tabindex="${first ? 0 : -1}" aria-label="Открыть улицу ${escape(road.name)}"/>`;
        if (id === selectedGroup) selection += `<path d="${d}" stroke="${theme.accent}" stroke-opacity=".65" stroke-width="${width}"/>`;
    }
    const mask = city.source?.format === 'compatible' ? ' mask="url(#dry-land)"' : '';
    return `<g id="street-hit-areas" fill="none" stroke="transparent" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"${mask}>${hits}</g><g id="street-selection" fill="none" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"${mask}>${selection}</g>`;
}
