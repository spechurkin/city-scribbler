const {default: Delaunator} = await import(typeof process !== 'undefined' && process.versions?.node
    ? 'delaunator' : '../../deps/delaunator/index.js');

const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function turn(a, b, c) {
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
        const left = (q[1] - p[1]) * (r[0] - p[0]), right = (q[0] - p[0]) * (r[1] - p[1]);
        if (Math.abs(left - right) >= 3.3306690738754716e-16 * Math.abs(left + right)) return left - right < 0;
    }
    return false;
}

export function circle(a, b, c) {
    const x = b[0] - a[0], y = b[1] - a[1], u = c[0] - a[0], v = c[1] - a[1];
    const scale = .5 / (x * v - y * u), first = x * x + y * y, second = u * u + v * v;
    const dx = (v * first - y * second) * scale, dy = (x * second - u * first) * scale;
    return {center: [a[0] + dx, a[1] + dy], radiusSquared: dx * dx + dy * dy};
}

export function seedTriangle(points) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const middle = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    let a = 0, b = -1, c = -1, minimumRadius = Infinity;
    for (let i = 1; i < points.length; i++) if (distanceSquared(points[i], middle) < distanceSquared(points[a], middle)) a = i;
    for (let i = 0; i < points.length; i++) if (i !== a && (b < 0 || distanceSquared(points[i], points[a]) < distanceSquared(points[b], points[a]))) b = i;
    for (let i = 0; i < points.length; i++) if (i !== a && i !== b) {
        const radius = circle(points[a], points[b], points[i]).radiusSquared;
        if (radius < minimumRadius) {
            c = i;
            minimumRadius = radius;
        }
    }
    if (c < 0 || !Number.isFinite(circle(points[a], points[b], points[c]).radiusSquared)) throw new Error('Для триангуляции нужны неколлинеарные точки.');
    if (turn(points[a], points[b], points[c])) [b, c] = [c, b];
    const center = circle(points[a], points[b], points[c]).center;
    const ordered = points.map((_, i) => i).sort((i, j) => Math.sqrt(distanceSquared(points[i], center)) - Math.sqrt(distanceSquared(points[j], center)) || i - j);
    return {a, b, c, center, ordered};
}

// Equal-distance sites keep their input order, including the already selected seed triangle.
export class Triangulation extends Delaunator {
    constructor(points) {
        super(Float64Array.from(points.flat()));
        const seed = seedTriangle(points), {a, b, c, center, ordered} = seed;
        this._cx = center[0];
        this._cy = center[1];
        this.trianglesLen = 0;
        const previous = this._hullPrev, next = this._hullNext, tri = this._hullTri, hash = this._hullHash;
        hash.fill(-1);
        this._hullStart = a;
        for (const [p, q, r, t] of [[a, b, c, 0], [b, c, a, 1], [c, a, b, 2]]) {
            previous[p] = r;
            next[p] = q;
            tri[p] = t;
            hash[this._hashKey(...points[p])] = p;
        }
        this._addTriangle(a, b, c, -1, -1, -1);
        const visible = (point, p, q) => turn(point, points[p], points[q]);
        for (const index of ordered) {
            if (index === a || index === b || index === c) continue;
            const point = points[index], key = this._hashKey(...point);
            let start = -1;
            for (let offset = 0; offset < hash.length; offset++) {
                const value = hash[(key + offset) % hash.length];
                if (value >= 0 && next[value] !== value) {
                    start = previous[value];
                    break;
                }
            }
            if (start < 0) throw new Error('Не найдена активная грань оболочки.');
            let left = start;
            while (!visible(point, left, next[left])) {
                left = next[left];
                if (left === start) break;
            }
            if (!visible(point, left, next[left])) continue;
            let triangle = this._addTriangle(left, index, next[left], -1, -1, tri[left]);
            tri[index] = this._legalize(triangle + 2);
            tri[left] = triangle;
            let right = next[left];
            while (visible(point, right, next[right])) {
                const after = next[right];
                triangle = this._addTriangle(right, index, after, tri[index], -1, tri[right]);
                tri[index] = this._legalize(triangle + 2);
                next[right] = right;
                right = after;
            }
            if (left === start) while (visible(point, previous[left], left)) {
                const before = previous[left];
                triangle = this._addTriangle(before, index, left, -1, tri[left], tri[before]);
                this._legalize(triangle + 2);
                tri[before] = triangle;
                next[left] = left;
                left = before;
            }
            this._hullStart = left;
            previous[index] = left;
            next[left] = index;
            previous[right] = index;
            next[index] = right;
            hash[key] = index;
            hash[this._hashKey(...points[left])] = left;
        }
        const hull = [];
        let index = this._hullStart;
        do {
            hull.push(index);
            index = next[index];
        } while (index !== this._hullStart && hull.length <= points.length);
        this.hull = Uint32Array.from(hull);
        this.triangles = this._triangles.subarray(0, this.trianglesLen);
        this.halfedges = this._halfedges.subarray(0, this.trianglesLen);
        this.seed = seed;
    }
}
