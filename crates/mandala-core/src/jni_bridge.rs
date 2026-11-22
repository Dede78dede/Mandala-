//! Safe Android JNI bridge exposing `mandala_core::kernel` to `com.mandala.studio.domain.NativeRustKernel`.

use core::f64::consts::TAU;

use jni::objects::{JClass, JDoubleArray, JString};
use jni::sys::{jdoubleArray, jint};
use jni::JNIEnv;

use crate::kernel::{
    cos_taylor_f64, expand_lsystem_bytes_into, expand_mirror_radial_flat_into,
    expand_radial_flat_into, interpret_lsystem_turtle_into, sin_taylor_f64, ByteRule,
};

fn build_empty_double_array(env: &JNIEnv<'_>) -> jdoubleArray {
    env.new_double_array(0)
        .map(|arr| arr.into_raw())
        .unwrap_or(core::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_mandala_studio_domain_NativeRustKernel_nativeExpandRadial<
    'local,
>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    points_xy: JDoubleArray<'local>,
    order: jint,
    cx: f64,
    cy: f64,
) -> jdoubleArray {
    let clamped_order = order.clamp(1, 48) as usize;
    let Ok(in_len) = env.get_array_length(&points_xy) else {
        return build_empty_double_array(&env);
    };
    let mut input = vec![0.0_f64; in_len.max(0) as usize];
    if env.get_double_array_region(&points_xy, 0, &mut input).is_err() {
        return build_empty_double_array(&env);
    }

    let step = TAU / (clamped_order as f64);
    let cos_sin: Vec<(f64, f64)> = (0..clamped_order)
        .map(|i| {
            let theta = (i as f64) * step;
            (cos_taylor_f64(theta), sin_taylor_f64(theta))
        })
        .collect();

    let mut out = Vec::new();
    let total_pts = expand_radial_flat_into(&input, clamped_order, cx, cy, &cos_sin, &mut out);
    if total_pts == 0 {
        return build_empty_double_array(&env);
    }

    let Ok(jarr) = env.new_double_array(out.len() as i32) else {
        return build_empty_double_array(&env);
    };
    if env.set_double_array_region(&jarr, 0, &out).is_err() {
        return build_empty_double_array(&env);
    }
    jarr.into_raw()
}

#[no_mangle]
pub extern "system" fn Java_com_mandala_studio_domain_NativeRustKernel_nativeExpandMirrorRadial<
    'local,
>(
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    points_xy: JDoubleArray<'local>,
    order: jint,
    alternate: bool,
    cx: f64,
    cy: f64,
) -> jdoubleArray {
    let clamped_order = order.clamp(1, 48) as usize;
    let Ok(in_len) = env.get_array_length(&points_xy) else {
        return build_empty_double_array(&env);
    };
    let mut input = vec![0.0_f64; in_len.max(0) as usize];
    if env.get_double_array_region(&points_xy, 0, &mut input).is_err() {
        return build_empty_double_array(&env);
    }

    let step = TAU / (clamped_order as f64);
    let quads: Vec<[f64; 4]> = (0..clamped_order)
        .map(|i| {
            let base = (i as f64) * step;
            let axis = base + if alternate && i % 2 == 1 { step / 4.0 } else { 0.0 };
            [
                cos_taylor_f64(base),
                sin_taylor_f64(base),
                cos_taylor_f64(2.0 * axis),
                sin_taylor_f64(2.0 * axis),
            ]
        })
        .collect();

    let mut out = Vec::new();
    let total_pts =
        expand_mirror_radial_flat_into(&input, clamped_order, cx, cy, &quads, &mut out);
    if total_pts == 0 {
        return build_empty_double_array(&env);
    }

    let Ok(jarr) = env.new_double_array(out.len() as i32) else {
        return build_empty_double_array(&env);
    };
    if env.set_double_array_region(&jarr, 0, &out).is_err() {
        return build_empty_double_array(&env);
    }
    jarr.into_raw()
}

#[no_mangle]
pub extern "system" fn Java_com_mandala_studio_domain_NativeRustKernel_nativeGenerateLSystem<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    axiom: JString<'local>,
    rule_spec: JString<'local>,
    generations: jint,
    step_length: f64,
    angle_deg: f64,
    cx: f64,
    cy: f64,
) -> jdoubleArray {
    let Ok(axiom_str) = env.get_string(&axiom) else {
        return build_empty_double_array(&env);
    };
    let Ok(rules_str) = env.get_string(&rule_spec) else {
        return build_empty_double_array(&env);
    };

    let axiom_string = String::from(axiom_str);
    let rules_string = String::from(rules_str);
    let mut parsed_rules: Vec<(u8, Vec<u8>)> = Vec::new();
    for entry in rules_string.split('\n') {
        if let Some((lhs, rhs)) = entry.split_once('=') {
            if let Some(&sym) = lhs.as_bytes().first() {
                parsed_rules.push((sym, rhs.as_bytes().to_vec()));
            }
        }
    }
    let rule_refs: Vec<ByteRule<'_>> = parsed_rules
        .iter()
        .map(|(sym, rhs)| ByteRule {
            symbol: *sym,
            replacement: rhs.as_slice(),
        })
        .collect();

    let mut buf_a = Vec::new();
    let mut buf_b = Vec::new();
    let max_cap = 262_144;
    let Ok((final_len, in_a)) = expand_lsystem_bytes_into(
        axiom_string.as_bytes(),
        &rule_refs,
        generations.clamp(1, 6) as usize,
        max_cap,
        &mut buf_a,
        &mut buf_b,
    ) else {
        return build_empty_double_array(&env);
    };

    let instructions = if in_a {
        &buf_a[..final_len]
    } else {
        &buf_b[..final_len]
    };

    let mut out_pts = Vec::new();
    let mut out_lens = Vec::new();
    let rad_angle = angle_deg.to_radians();
    if interpret_lsystem_turtle_into(
        instructions,
        step_length,
        rad_angle,
        cx,
        cy,
        120_000,
        16_384,
        &mut out_pts,
        &mut out_lens,
    )
    .is_err()
    {
        return build_empty_double_array(&env);
    }

    // Encode header [polyCount, len0, len1, ..., x0, y0, ...] into a single flat jdoubleArray
    let mut packed = Vec::with_capacity(1 + out_lens.len() + out_pts.len());
    packed.push(out_lens.len() as f64);
    for len in &out_lens {
        packed.push(*len as f64);
    }
    packed.extend_from_slice(&out_pts);

    let Ok(jarr) = env.new_double_array(packed.len() as i32) else {
        return build_empty_double_array(&env);
    };
    if env.set_double_array_region(&jarr, 0, &packed).is_err() {
        return build_empty_double_array(&env);
    }
    jarr.into_raw()
}
