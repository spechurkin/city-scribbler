export function castleMapObjects(city) {
    return (city.special || []).filter(b => b.kind === 'castle').map(castle => {
        const cell = city.generatedGeometry?.cells.find(c => c.id === castle.cell && c.ward === 'castle');
        return {
            id: String(castle.cell),
            castle,
            polygon: cell ? cell.polygon.map(([x, y]) => [x, -y]) : castle.polygon
        };
    });
}

export function mapDistricts(city) {
    const castles = city.editorLabels || (city.editor ? city.buildings : city.special) || [];
    return city.districts.filter(d => d.castleCell === undefined || !castles.some(b => b.kind === 'castle' && (b.cell === d.castleCell || b.district === d.id)));
}

