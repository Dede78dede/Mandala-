//! Mandala Studio Shared Core Crate (`wasm32` ABI-compatible + Android NDK JNI + Rust tests).

pub mod kernel;

#[cfg(feature = "android-jni")]
pub mod jni_bridge;

#[cfg(target_arch = "wasm32")]
mod wasm_exports {
    use core::sync::atomic::{AtomicUsize, Ordering};

    use crate::kernel::{
        expand_lsystem_bytes_into, expand_mirror_radial_flat_into, expand_radial_flat_into,
        interpret_lsystem_turtle_into, sin_taylor_f64, ByteRule, HEAP_BASE_OFFSET_BYTES,
        OUT_META_BYTES, RULE_ENTRY_STRIDE_BYTES,
    };

    static HEAP_PTR: AtomicUsize = AtomicUsize::new(HEAP_BASE_OFFSET_BYTES);

    #[no_mangle]
    pub extern "C" fn alloc_bytes(size: i32) -> i32 {
        if size <= 0 {
            return HEAP_PTR.load(Ordering::Relaxed) as i32;
        }
        let aligned = ((size as usize) + 7) & !7;
        let ptr = HEAP_PTR.fetch_add(aligned, Ordering::SeqCst);
        let needed_bytes = ptr.saturating_add(aligned);
        let cur_pages = core::arch::wasm32::memory_size(0);
        let cur_bytes = cur_pages.saturating_mul(65536);
        if needed_bytes > cur_bytes {
            let extra_bytes = needed_bytes - cur_bytes;
            let extra_pages = (extra_bytes + 65535) / 65536;
            if core::arch::wasm32::memory_grow(0, extra_pages) == usize::MAX {
                HEAP_PTR.store(ptr, Ordering::SeqCst);
                return -1;
            }
        }
        ptr as i32
    }

    #[no_mangle]
    pub extern "C" fn reset_arena() {
        HEAP_PTR.store(HEAP_BASE_OFFSET_BYTES, Ordering::SeqCst);
    }

    #[no_mangle]
    pub extern "C" fn get_heap_ptr() -> i32 {
        HEAP_PTR.load(Ordering::SeqCst) as i32
    }

    #[no_mangle]
    pub extern "C" fn sin_f64(theta: f64) -> f64 {
        sin_taylor_f64(theta)
    }

    #[no_mangle]
    pub extern "C" fn inject_panic_test() {
        core::arch::wasm32::unreachable();
    }

    /// Safety: Caller must supply valid linear-memory pointers aligned to `f64` matching `WASM_ABI_SPEC`.
    #[no_mangle]
    pub unsafe extern "C" fn expand_radial_f64(
        in_ptr: i32,
        pt_count: i32,
        order: i32,
        cx: f64,
        cy: f64,
        cos_sin_ptr: i32,
        out_ptr: i32,
    ) -> i32 {
        if pt_count <= 0 || order <= 0 {
            return 0;
        }
        let n_pts = pt_count as usize;
        let n_ord = order as usize;
        let in_slice = core::slice::from_raw_parts(in_ptr as *const f64, n_pts * 2);
        let trig_raw = core::slice::from_raw_parts(cos_sin_ptr as *const f64, n_ord * 2);
        let mut trig = Vec::with_capacity(n_ord);
        for i in 0..n_ord {
            trig.push((trig_raw[i * 2], trig_raw[i * 2 + 1]));
        }
        let mut tmp = Vec::new();
        let written = expand_radial_flat_into(in_slice, n_ord, cx, cy, &trig, &mut tmp);
        let out_slice = core::slice::from_raw_parts_mut(out_ptr as *mut f64, written * 2);
        out_slice.copy_from_slice(&tmp);
        written as i32
    }

    /// Safety: Caller must supply valid linear-memory pointers aligned to `f64` matching `WASM_ABI_SPEC`.
    #[no_mangle]
    pub unsafe extern "C" fn expand_mirror_radial_f64(
        in_ptr: i32,
        pt_count: i32,
        order: i32,
        cx: f64,
        cy: f64,
        angles_ptr: i32,
        out_ptr: i32,
    ) -> i32 {
        if pt_count <= 0 || order <= 0 {
            return 0;
        }
        let n_pts = pt_count as usize;
        let n_ord = order as usize;
        let in_slice = core::slice::from_raw_parts(in_ptr as *const f64, n_pts * 2);
        let quad_raw = core::slice::from_raw_parts(angles_ptr as *const f64, n_ord * 4);
        let mut quads = Vec::with_capacity(n_ord);
        for i in 0..n_ord {
            quads.push([
                quad_raw[i * 4],
                quad_raw[i * 4 + 1],
                quad_raw[i * 4 + 2],
                quad_raw[i * 4 + 3],
            ]);
        }
        let mut tmp = Vec::new();
        let written = expand_mirror_radial_flat_into(in_slice, n_ord, cx, cy, &quads, &mut tmp);
        let out_slice = core::slice::from_raw_parts_mut(out_ptr as *mut f64, written * 2);
        out_slice.copy_from_slice(&tmp);
        written as i32
    }

    /// Safety: Pointers must respect `RULES_TABLE_BYTES` (128 ASCII slots * 8 bytes), `OUT_META_BYTES`, and `max_cap`.
    #[no_mangle]
    pub unsafe extern "C" fn expand_lsystem_bytes(
        axiom_ptr: i32,
        axiom_len: i32,
        rules_ptr: i32,
        generations: i32,
        buf_a: i32,
        buf_b: i32,
        max_cap: i32,
        out_meta_ptr: i32,
    ) -> i32 {
        if axiom_len <= 0 || max_cap <= 0 || rules_ptr <= 0 || out_meta_ptr <= 0 {
            return -1;
        }
        let axiom = core::slice::from_raw_parts(axiom_ptr as *const u8, axiom_len as usize);
        let mut rules: Vec<ByteRule<'_>> = Vec::new();
        let slot_count = crate::kernel::RULES_TABLE_BYTES / RULE_ENTRY_STRIDE_BYTES;
        for sym in 0..slot_count {
            let slot_ptr = (rules_ptr as usize + sym * RULE_ENTRY_STRIDE_BYTES) as *const i32;
            let repl_ptr = *slot_ptr;
            let repl_len = *slot_ptr.add(1);
            if repl_ptr > 0 && repl_len >= 0 {
                rules.push(ByteRule {
                    symbol: sym as u8,
                    replacement: core::slice::from_raw_parts(
                        repl_ptr as usize as *const u8,
                        repl_len as usize,
                    ),
                });
            }
        }

        let mut vec_a = Vec::new();
        let mut vec_b = Vec::new();
        let Ok((final_len, in_a)) = expand_lsystem_bytes_into(
            axiom,
            &rules,
            generations.max(0) as usize,
            max_cap as usize,
            &mut vec_a,
            &mut vec_b,
        ) else {
            return -1;
        };

        let dst_ptr = if in_a { buf_a } else { buf_b } as *mut u8;
        let src = if in_a { &vec_a } else { &vec_b };
        core::slice::from_raw_parts_mut(dst_ptr, final_len).copy_from_slice(&src[..final_len]);
        let meta = core::slice::from_raw_parts_mut(out_meta_ptr as *mut i32, OUT_META_BYTES / 4);
        meta[0] = dst_ptr as i32;
        meta[1] = final_len as i32;
        final_len as i32
    }

    /// Safety: Caller supplies valid linear-memory pointers matching `WASM_ABI_SPEC`.
    #[no_mangle]
    pub unsafe extern "C" fn interpret_lsystem_turtle_f64(
        instr_ptr: i32,
        instr_len: i32,
        step_len: f64,
        rad_angle: f64,
        start_x: f64,
        start_y: f64,
        _stack_ptr: i32,
        out_pts_ptr: i32,
        out_lens_ptr: i32,
        max_pts: i32,
        max_polys: i32,
    ) -> i32 {
        if instr_len <= 0 || max_pts <= 0 || max_polys <= 0 {
            return -1;
        }
        let instructions = core::slice::from_raw_parts(instr_ptr as *const u8, instr_len as usize);
        let mut pts = Vec::new();
        let mut lens = Vec::new();
        let Ok(poly_count) = interpret_lsystem_turtle_into(
            instructions,
            step_len,
            rad_angle,
            start_x,
            start_y,
            max_pts as usize,
            max_polys as usize,
            &mut pts,
            &mut lens,
        ) else {
            return -1;
        };
        let out_pts = core::slice::from_raw_parts_mut(out_pts_ptr as *mut f64, pts.len());
        out_pts.copy_from_slice(&pts);
        let out_lens = core::slice::from_raw_parts_mut(out_lens_ptr as *mut u32, lens.len());
        out_lens.copy_from_slice(&lens);
        poly_count as i32
    }
}

#[cfg(test)]
mod tests {
    use core::f64::consts::{FRAC_PI_3, PI, TAU};

    use crate::kernel::{
        cos_taylor_f64, expand_lsystem_bytes_into, expand_mirror_radial_flat_into,
        expand_radial_flat_into, interpret_lsystem_turtle_into, sin_taylor_f64, ByteRule,
    };

    #[test]
    fn taylor_trig_matches_std_within_1e12() {
        for deg in -720..=720 {
            let rad = (deg as f64).to_radians();
            assert!((sin_taylor_f64(rad) - rad.sin()).abs() < 1e-12);
            assert!((cos_taylor_f64(rad) - rad.cos()).abs() < 1e-12);
        }
    }

    #[test]
    fn radial_n4_matches_exact_quadrants_1e12() {
        let step = TAU / 4.0;
        let trig: Vec<(f64, f64)> = (0..4)
            .map(|i| {
                let th = (i as f64) * step;
                (cos_taylor_f64(th), sin_taylor_f64(th))
            })
            .collect();
        let mut out = Vec::new();
        let count = expand_radial_flat_into(&[410.0, 400.0], 4, 400.0, 400.0, &trig, &mut out);
        assert_eq!(count, 4);
        assert!((out[2] - 400.0).abs() < 1e-12);
        assert!((out[3] - 410.0).abs() < 1e-12);
        assert!((out[4] - 390.0).abs() < 1e-12);
        assert!((out[5] - 400.0).abs() < 1e-12);
    }

    #[test]
    fn mirror_radial_n6_produces_12_strokes() {
        let step = TAU / 6.0;
        let quads: Vec<[f64; 4]> = (0..6)
            .map(|i| {
                let a = (i as f64) * step;
                [
                    cos_taylor_f64(a),
                    sin_taylor_f64(a),
                    cos_taylor_f64(2.0 * a),
                    sin_taylor_f64(2.0 * a),
                ]
            })
            .collect();
        let mut out = Vec::new();
        let pts = expand_mirror_radial_flat_into(&[420.0, 380.0], 6, 400.0, 400.0, &quads, &mut out);
        assert_eq!(pts, 12);
    }

    #[test]
    fn lsystem_rewrite_and_turtle_execute_deterministically() {
        let mut a = Vec::new();
        let mut b = Vec::new();
        let rules = [ByteRule {
            symbol: b'F',
            replacement: b"F+F--F+F",
        }];
        let (len, in_a) = expand_lsystem_bytes_into(b"F", &rules, 2, 4096, &mut a, &mut b).unwrap();
        let instr = if in_a { &a[..len] } else { &b[..len] };
        let mut pts = Vec::new();
        let mut lens = Vec::new();
        let polys = interpret_lsystem_turtle_into(
            instr,
            10.0,
            FRAC_PI_3,
            400.0,
            400.0,
            4096,
            64,
            &mut pts,
            &mut lens,
        )
        .unwrap();
        assert_eq!(polys, 1);
        assert_eq!(lens[0], 17);
        assert!((pts[0] - 400.0).abs() < 1e-12);
        let _ = PI;
    }
}
