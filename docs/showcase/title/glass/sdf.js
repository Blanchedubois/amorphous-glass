// The word as a signed distance field: for every pixel, how far it is from the letters' edge, in
// px, negative inside. The glass's edge, hairline and coverage are drawn from it, and the drop's
// shape (an analytic SDF) blends into it. Exact Euclidean distance transform (Felzenszwalb and
// Huttenlocher 2004, the 1D parabola envelope as in mapbox/tiny-sdf), once at load.

const INF = 1e20;

function edt1d(grid, offset, stride, length, f, v, z) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    f[0] = grid[offset];
    for (let q = 1, k = 0; q < length; q++) {
        f[q] = grid[offset + q * stride];
        const q2 = q * q;
        let s, r;
        do {
            r = v[k];
            s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
        } while (s <= z[k] && --k > -1);
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < length; q++) {
        while (z[k + 1] < q)
            k++;
        const r = v[k];
        const qr = q - r;
        grid[offset + q * stride] = f[r] + qr * qr;
    }
}

/// squared distance from every cell to the nearest cell that is 0 in `grid` (in place)
function edt(grid, width, height) {
    const n = Math.max(width, height) + 1;
    const f = new Float64Array(n), v = new Uint32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < width; x++)
        edt1d(grid, x, width, height, f, v, z);
    for (let y = 0; y < height; y++)
        edt1d(grid, y * width, 1, width, f, v, z);
}

/// `alpha`: the letters' coverage, 0 to 255, row-major, `width` x `height`. Returns the signed
/// distance (Float32Array, px, < 0 inside) and the ink area (px^2).
export function signedDistance(alpha, width, height) {
    const n = width * height;
    const toInk = new Float64Array(n), toAir = new Float64Array(n);
    let area = 0;
    for (let i = 0; i < n; i++) {
        const a = alpha[i] / 255;
        area += a;
        toInk[i] = a > 0.5 ? 0 : INF;
        toAir[i] = a > 0.5 ? INF : 0;
    }
    edt(toInk, width, height);
    edt(toAir, width, height);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = alpha[i] / 255;
        // the distances are between pixel centres (a pixel next to the edge is 1 away): shifted by
        // half a pixel, and the anti-aliased pixels on the edge give their own sub-pixel distance
        if (a > 0 && a < 1)
            sd[i] = 0.5 - a;
        else
            sd[i] = a > 0.5 ? -(Math.sqrt(toAir[i]) - 0.5) : Math.sqrt(toInk[i]) - 0.5;
    }
    return { sd, area };
}
