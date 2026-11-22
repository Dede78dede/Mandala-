//! Pure IEEE-754 geometric symmetry & L-System kernels shared across wasm32 and Android JNI.
//! Keeps exact ABI constants synchronized with `WASM_ABI_SPEC` and `scripts/build_wasm.py`.

use core::f64::consts::{FRAC_PI_2, PI, TAU};

pub const HEAP_BASE_OFFSET_BYTES: usize = 4096;
pub const INITIAL_MEMORY_PAGES: usize = 32;
pub const MAX_MEMORY_PAGES: usize = 512;
pub const RULES_TABLE_BYTES: usize = 1024;
pub const RULE_ENTRY_STRIDE_BYTES: usize = 8;
pub const TURTLE_STACK_MAX_DEPTH: usize = 256;
pub const TURTLE_STACK_FRAME_BYTES: usize = 24;
pub const OUT_META_BYTES: usize = 16;
pub const POINT_STRIDE_F64_BYTES: usize = 16;
pub const POLY_LENGTH_STRIDE_BYTES: usize = 4;

const SIN_TAYLOR_DENOMINATORS: [f64; 10] = [
    420.0, 342.0, 272.0, 210.0, 156.0, 110.0, 72.0, 42.0, 20.0, 6.0,
];
const SIN_TAYLOR_LAST_DENOMINATOR: f64 = 506.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymmetryMirrorMode {
    Reflect = 0,
    Alternate = 1,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct TurtleState {
    x: f64,
    y: f64,
    angle: f64,
}

#[inline]
pub fn sin_taylor_f64(theta: f64) -> f64 {
    let cycles = ((theta + PI) / TAU).floor();
    let mut r = theta - cycles * TAU;
    if r > FRAC_PI_2 {
        r = PI - r;
    } else if r < -FRAC_PI_2 {
        r = -PI - r;
    }

    let neg_x2 = -(r * r);
    let mut acc = 1.0 + neg_x2 / SIN_TAYLOR_LAST_DENOMINATOR;
    for &denom in &SIN_TAYLOR_DENOMINATORS {
        acc = 1.0 + (neg_x2 / denom) * acc;
    }
    r * acc
}

#[inline]
pub fn cos_taylor_f64(theta: f64) -> f64 {
    sin_taylor_f64(theta + FRAC_PI_2)
}

/// Expands a polyline (`[x0, y0, x1, y1, ...]`) into `order` radial copies around `(cx, cy)`.
pub fn expand_radial_flat_into(
    points_xy: &[f64],
    order: usize,
    cx: f64,
    cy: f64,
    cos_sin_pairs: &[(f64, f64)],
    out_xy: &mut Vec<f64>,
) -> usize {
    let pt_count = points_xy.len() / 2;
    if pt_count == 0 || order == 0 || cos_sin_pairs.len() < order {
        return 0;
    }

    let needed = order * pt_count * 2;
    out_xy.clear();
    out_xy.reserve(needed);

    for &(cos_a, sin_a) in cos_sin_pairs.iter().take(order) {
        for p in 0..pt_count {
            let dx = points_xy[p * 2] - cx;
            let dy = points_xy[p * 2 + 1] - cy;
            out_xy.push(cx + (dx * cos_a - dy * sin_a));
            out_xy.push(cy + (dx * sin_a + dy * cos_a));
        }
    }

    order * pt_count
}

/// Expands a polyline with bilateral/alternate mirror folds (`2 * order` polylines total).
pub fn expand_mirror_radial_flat_into(
    points_xy: &[f64],
    order: usize,
    cx: f64,
    cy: f64,
    angles_quad: &[[f64; 4]],
    out_xy: &mut Vec<f64>,
) -> usize {
    let pt_count = points_xy.len() / 2;
    if pt_count == 0 || order == 0 || angles_quad.len() < order {
        return 0;
    }

    out_xy.clear();
    out_xy.reserve(order * 2 * pt_count * 2);

    for quad in angles_quad.iter().take(order) {
        let cos_a = quad[0];
        let sin_a = quad[1];
        let cos2 = quad[2];
        let sin2 = quad[3];

        let rot_start = out_xy.len();
        for p in 0..pt_count {
            let dx = points_xy[p * 2] - cx;
            let dy = points_xy[p * 2 + 1] - cy;
            out_xy.push(cx + (dx * cos_a - dy * sin_a));
            out_xy.push(cy + (dx * sin_a + dy * cos_a));
        }

        for p in 0..pt_count {
            let rx = out_xy[rot_start + p * 2] - cx;
            let ry = out_xy[rot_start + p * 2 + 1] - cy;
            out_xy.push(cx + (rx * cos2 + ry * sin2));
            out_xy.push(cy + (rx * sin2 - ry * cos2));
        }
    }

    order * 2 * pt_count
}

/// Rule descriptor mapping a single ASCII command byte to a byte replacement slice.
#[derive(Debug, Clone, Copy)]
pub struct ByteRule<'a> {
    pub symbol: u8,
    pub replacement: &'a [u8],
}

/// Rewrites an L-System axiom for `generations` iterations within `max_cap` bytes.
pub fn expand_lsystem_bytes_into(
    axiom: &[u8],
    rules: &[ByteRule<'_>],
    generations: usize,
    max_cap: usize,
    buf_a: &mut Vec<u8>,
    buf_b: &mut Vec<u8>,
) -> Result<(usize, bool), ()> {
    if axiom.is_empty() || axiom.len() > max_cap {
        return Err(());
    }

    let mut rule_lookup: [Option<&[u8]>; 256] = [None; 256];
    for r in rules {
        rule_lookup[usize::from(r.symbol)] = Some(r.replacement);
    }

    buf_a.clear();
    buf_a.extend_from_slice(axiom);
    buf_b.clear();

    let mut use_a_as_src = true;
    for _ in 0..generations {
        let (src, dst) = if use_a_as_src {
            (&*buf_a, &mut *buf_b)
        } else {
            (&*buf_b, &mut *buf_a)
        };
        dst.clear();
        for &ch in src {
            if let Some(repl) = rule_lookup[usize::from(ch)] {
                if dst.len() + repl.len() > max_cap {
                    return Err(());
                }
                dst.extend_from_slice(repl);
            } else {
                if dst.len() + 1 > max_cap {
                    return Err(());
                }
                dst.push(ch);
            }
        }
        use_a_as_src = !use_a_as_src;
    }

    let final_len = if use_a_as_src { buf_a.len() } else { buf_b.len() };
    Ok((final_len, use_a_as_src))
}

/// Interprets an expanded L-System instruction stream into flat XY polylines matching JS/Python ABI.
pub fn interpret_lsystem_turtle_into(
    instructions: &[u8],
    step_len: f64,
    rad_angle: f64,
    start_x: f64,
    start_y: f64,
    max_pts: usize,
    max_polys: usize,
    out_pts: &mut Vec<f64>,
    out_lens: &mut Vec<u32>,
) -> Result<usize, ()> {
    if max_pts < 1 || max_polys < 1 {
        return Err(());
    }

    out_pts.clear();
    out_lens.clear();

    let mut stack: [TurtleState; TURTLE_STACK_MAX_DEPTH] = [TurtleState {
        x: 0.0,
        y: 0.0,
        angle: 0.0,
    }; TURTLE_STACK_MAX_DEPTH];
    let mut stack_depth: usize = 0;

    let mut x = start_x;
    let mut y = start_y;
    let mut angle = -FRAC_PI_2;

    out_pts.push(x);
    out_pts.push(y);
    let mut total_pts: usize = 1;
    let mut cur_len: usize = 1;

    let push_xy = |px: f64,
                   py: f64,
                   pts_vec: &mut Vec<f64>,
                   tot: &mut usize|
     -> Result<(), ()> {
        if *tot >= max_pts {
            return Err(());
        }
        pts_vec.push(px);
        pts_vec.push(py);
        *tot += 1;
        Ok(())
    };

    let close_or_rewind = |cur: &mut usize,
                           tot: &mut usize,
                           pts_vec: &mut Vec<f64>,
                           lens_vec: &mut Vec<u32>|
     -> Result<(), ()> {
        if *cur > 1 {
            if lens_vec.len() >= max_polys {
                return Err(());
            }
            lens_vec.push(*cur as u32);
        } else if *cur == 1 {
            *tot -= 1;
            pts_vec.truncate(*tot * 2);
        }
        *cur = 0;
        Ok(())
    };

    for &ch in instructions {
        match ch {
            b'F' | b'A' | b'B' | b'G' => {
                x += step_len * cos_taylor_f64(angle);
                y += step_len * sin_taylor_f64(angle);
                push_xy(x, y, out_pts, &mut total_pts)?;
                cur_len += 1;
            }
            b'f' => {
                x += step_len * cos_taylor_f64(angle);
                y += step_len * sin_taylor_f64(angle);
                close_or_rewind(&mut cur_len, &mut total_pts, out_pts, out_lens)?;
                push_xy(x, y, out_pts, &mut total_pts)?;
                cur_len = 1;
            }
            b'+' => {
                angle += rad_angle;
            }
            b'-' => {
                angle -= rad_angle;
            }
            b'[' => {
                if stack_depth >= TURTLE_STACK_MAX_DEPTH {
                    return Err(());
                }
                stack[stack_depth] = TurtleState { x, y, angle };
                stack_depth += 1;
            }
            b']' => {
                close_or_rewind(&mut cur_len, &mut total_pts, out_pts, out_lens)?;
                if stack_depth > 0 {
                    stack_depth -= 1;
                    let saved = stack[stack_depth];
                    x = saved.x;
                    y = saved.y;
                    angle = saved.angle;
                }
                push_xy(x, y, out_pts, &mut total_pts)?;
                cur_len = 1;
            }
            _ => {}
        }
    }

    if cur_len > 1 {
        if out_lens.len() >= max_polys {
            return Err(());
        }
        out_lens.push(cur_len as u32);
    } else if cur_len == 1 {
        total_pts -= 1;
        out_pts.truncate(total_pts * 2);
    }

    Ok(out_lens.len())
}
