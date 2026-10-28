const PERMUTATION = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
const weight = f => {
    const t = Math.floor(f * 4096) / 4096;
    return t * t * t * (t * (6 * t - 15) + 10);
};
const gradient = (h, x, y) => (h & 2 ? -x : x) + (h & 1 ? -y : y);

export function gradientNoise(seed, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = weight(fx), v = weight(fy),
        shift = seed % 256;
    const p = index => PERMUTATION[((index % 256) + 256 + shift) % 256];
    const a = gradient(p(p(ix) + iy), fx, fy), b = gradient(p(p(ix + 1) + iy), fx - 1, fy);
    const c = gradient(p(p(ix) + iy + 1), fx, fy - 1), d = gradient(p(p(ix + 1) + iy + 1), fx - 1, fy - 1);
    const upper = a + (b - a) * u, lower = c + (d - c) * u;
    return upper + (lower - upper) * v;
}

export function fractalNoise(sequence, octaves = 6) {
    const seeds = Array.from({length: octaves}, () => {
        sequence.next();
        return sequence.state;
    });
    return (x, y) => {
        let total = 0, frequency = 1, amplitude = 1;
        for (const seed of seeds) {
            total += gradientNoise(seed, x * frequency, y * frequency) * amplitude;
            frequency *= 2;
            amplitude *= .5;
        }
        return total;
    };
}

export function classifyWater(layout, {coast = false, sea = 0, coastOffset = 0} = {}) {
    if (!coast) {
        for (const cell of layout.cells) cell.water = false;
        return;
    }
    const configuration = layout.sequence.isolated(sequence => {
        const noise = fractalNoise(sequence);
        const gap = 20 + sequence.next() * 40;
        const shift = layout.radius * .3 * ((sequence.next() + sequence.next() + sequence.next()) / 3 * 2 - 1);
        const radius = layout.radius * (.2 + Math.abs((sequence.next() + sequence.next() + sequence.next() + sequence.next()) / 2 - 1));
        return {noise, gap, shift, radius};
    });
    const {noise, gap, shift, radius} = configuration, angle = sea * Math.PI, cos = Math.cos(angle),
        sin = Math.sin(angle);
    const centerX = coastOffset === 0 ? radius + gap : radius + gap - layout.radius * coastOffset;
    for (const cell of layout.cells) {
        const [cx, cy] = cell.center, x = cx * cos - cy * sin, y = cy * cos + cx * sin;
        let signed = coastOffset === 0 ? Math.hypot(x - radius - gap, y - shift) - radius : Math.hypot(x - centerX, y - shift) - radius;
        if (x > centerX) signed = Math.min(signed, Math.abs(y - shift) - radius);
        const perturbation = noise((x + layout.radius) / (layout.radius * 2), (y + layout.radius) / (layout.radius * 2)) * radius * Math.sqrt(Math.hypot(x, y) / layout.radius);
        cell.water = signed + perturbation < 0;
    }
    return configuration;
}
