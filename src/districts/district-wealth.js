import {centroid, distance, inside} from '../core/geometry.js';

export const WEALTH_LABELS = Object.freeze({rich: 'Богатый район', mixed: 'Смешанный район', poor: 'Бедный район'});

// A relative social geography, independent of the geometry generator's random sequence.
export function assignDistrictWealth(city) {
    const districts = city.districts;
    if (!districts.length) return city;
    const centers = districts.map(d => centroid(d.polygon));
    const center = city.center || centroid(centers);
    const scale = Math.max(1, ...centers.map(p => distance(p, center)));
    const near = (p, points) => points.length ? Math.exp(-Math.min(...points.map(q => distance(p, q))) / (scale * .45)) : 0;
    const castles = city.castle?.polygon ? [centroid(city.castle.polygon)] : [];
    const markets = city.markets?.map(m => centroid(m.polygon)) || city.squares?.map(centroid) || (city.plaza?.polygon ? [centroid(city.plaza.polygon)] : []);
    const temples = city.special?.filter(s => s.kind === 'temple').map(s => centroid(s.polygon)) || (city.temple?.center ? [city.temple.center] : []);
    const docks = (city.docks || []).map(d => d.points?.[0] || (d.polygon ? centroid(d.polygon) : null)).filter(Boolean);
    const walls = (city.walls || []).map(w => w.polygon || w.rings?.[0]).filter(Boolean);
    const mainStreets = (city.streets || []).filter(s => s.major || s.id?.startsWith('imported-road-')).flatMap(s => s.points || [s.a, s.b]).filter(Boolean);
    const ranked = districts.map((district, i) => {
        const p = centers[i], sheltered = walls.some(w => inside(p, w));
        const castle = district.kind === 'castle' || castles.some(q => inside(q, district.polygon) && !(district.rings || []).slice(1).some(h => inside(q, h)));
        const score = (castle ? 4 : 0) + .8 * near(p, [center]) + 1.2 * near(p, castles)
            + near(p, markets) + .65 * near(p, temples) + .3 * near(p, mainStreets)
            + (sheltered ? .6 : 0) - .35 * near(p, docks)
            - (['outskirts', 'slum', 'shantytown'].includes(district.kind) ? .8 : 0);
        return {district, score};
    }).sort((a, b) => b.score - a.score || String(a.district.id).localeCompare(String(b.district.id), 'en', {numeric: true}));
    // These are relative game categories, not historical population estimates.
    const richCount = districts.length < 2 ? 0 : Math.max(1, Math.round(districts.length * .25));
    const poorCount = districts.length < 2 ? 0 : Math.max(1, Math.round(districts.length * .35));
    ranked.forEach(({district}, i) => {
        district.wealth = i < richCount ? 'rich' : i >= districts.length - poorCount ? 'poor' : 'mixed';
    });
    return city;
}

export function buildingAppearance(city, theme) {
    const byDistrict = new Map(city.districts.map(d => [d.id, d.wealth]));
    return building => {
        const wealth = byDistrict.get(building.district) || 'poor', colors = theme.wealthRoof[wealth];
        return {wealth, fill: colors[(building.shade || 0) % colors.length]};
    };
}
