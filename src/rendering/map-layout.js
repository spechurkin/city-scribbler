export const DECORATION = Object.freeze({
    title: {x: 800, y: 88, bounds: [540, 36, 1060, 158]},
    compass: {x: 1460, y: 145, bounds: [1400, 75, 1520, 230]},
    scale: {x: 115, y: 1090, bounds: [85, 1055, 255, 1130]},
    footer: {x: 1480, y: 1112, bounds: [1150, 1080, 1510, 1130]}
});

export function overlapsDecoration(point, radius = 0) {
    return Object.values(DECORATION).some(({bounds: [left, top, right, bottom]}) =>
        point[0] + radius > left && point[0] - radius < right && point[1] + radius > top && point[1] - radius < bottom);
}
