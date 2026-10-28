export const norm = ([x, y]) => Math.sqrt(x * x + y * y);
export const distance = (a, b) => norm([a[0] - b[0], a[1] - b[1]]);
export const midpoint = (a, b) => [a[0] + (b[0] - a[0]) * .5, a[1] + (b[1] - a[1]) * .5];

export function lineParameters(p, d, q, e) {
    const denominator = d[0] * e[1] - d[1] * e[0];
    if (denominator === 0) return null;
    const u = (d[1] * (q[0] - p[0]) - d[0] * (q[1] - p[1])) / denominator;
    const t = Math.abs(d[0]) > Math.abs(d[1]) ? (q[0] - p[0] + e[0] * u) / d[0] : (q[1] - p[1] + e[1] * u) / d[1];
    return [t, u];
}

export function perimeter(polygon) {
    let total = 0, previous = polygon.at(-1);
    for (const point of polygon) {
        total += distance(previous, point);
        previous = point;
    }
    return total;
}

export function centroid(polygon) {
    let crossSum = 0, x = 0, y = 0, previous = polygon.at(-1);
    for (const point of polygon) {
        const cross = previous[0] * point[1] - previous[1] * point[0];
        crossSum += cross;
        x += (previous[0] + point[0]) * cross;
        y += (previous[1] + point[1]) * cross;
        previous = point;
    }
    if (!crossSum) throw new Error('Вырожденный многоугольник.');
    const scale = 1 / (3 * crossSum);
    return [x * scale, y * scale];
}
