#!/usr/bin/env python3
"""
Deterministic WebAssembly MVP binary emitter for Mandala Studio Phase 3 (`public/wasm/mandala_symmetry.wasm`).
Emits zero-dependency IEEE-754 f64 linear-memory symmetry kernels + bump-arena allocator + trap test.
"""

from pathlib import Path
import struct

# WASM Opcodes & Types
TYPE_I32 = 0x7F
TYPE_F64 = 0x7C
TYPE_FUNC = 0x60

SEC_TYPE = 1
SEC_FUNCTION = 3
SEC_MEMORY = 5
SEC_GLOBAL = 6
SEC_EXPORT = 7
SEC_CODE = 10

OP_UNREACHABLE = 0x00
OP_BLOCK = 0x02
OP_LOOP = 0x03
OP_IF = 0x04
OP_ELSE = 0x05
OP_END = 0x0B
OP_BR = 0x0C
OP_BR_IF = 0x0D
OP_RETURN = 0x0F
OP_CALL = 0x10
OP_DROP = 0x1A
OP_LOCAL_GET = 0x20
OP_LOCAL_SET = 0x21
OP_LOCAL_TEE = 0x22
OP_GLOBAL_GET = 0x23
OP_GLOBAL_SET = 0x24
OP_I32_LOAD = 0x28
OP_F64_LOAD = 0x2B
OP_I32_LOAD8_U = 0x2D
OP_I32_STORE = 0x36
OP_F64_STORE = 0x39
OP_I32_STORE8 = 0x3A
OP_MEMORY_SIZE = 0x3F
OP_MEMORY_GROW = 0x40

OP_I32_CONST = 0x41
OP_F64_CONST = 0x44
OP_I32_EQZ = 0x45
OP_I32_EQ = 0x46
OP_I32_NE = 0x47
OP_I32_LT_S = 0x48
OP_I32_GT_S = 0x4A
OP_I32_GT_U = 0x4B
OP_I32_LE_S = 0x4C
OP_I32_GE_S = 0x4E
OP_F64_LT = 0x63
OP_F64_GT = 0x64
OP_I32_ADD = 0x6A
OP_I32_SUB = 0x6B
OP_I32_MUL = 0x6C
OP_I32_DIV_U = 0x6E
OP_I32_AND = 0x71
OP_I32_OR = 0x72
OP_I32_SHL = 0x74

OP_F64_NEG = 0x9A
OP_F64_FLOOR = 0x9C
OP_F64_ADD = 0xA0
OP_F64_SUB = 0xA1
OP_F64_MUL = 0xA2
OP_F64_DIV = 0xA3

VOID_BLOCK = 0x40

FN_SIN_F64 = 6


def f64_const(val: float) -> bytes:
    return bytes([OP_F64_CONST]) + struct.pack("<d", val)


def uleb128(val: int) -> bytes:
    out = bytearray()
    while True:
        byte = val & 0x7F
        val >>= 7
        if val != 0:
            byte |= 0x80
        out.append(byte)
        if val == 0:
            break
    return bytes(out)


def sleb128(val: int) -> bytes:
    out = bytearray()
    more = True
    while more:
        byte = val & 0x7F
        val >>= 7
        if (val == 0 and (byte & 0x40) == 0) or (val == -1 and (byte & 0x40) != 0):
            more = False
        else:
            byte |= 0x80
        out.append(byte)
    return bytes(out)


def vec(items: list[bytes]) -> bytes:
    return uleb128(len(items)) + b"".join(items)


def section(sec_id: int, payload: bytes) -> bytes:
    return bytes([sec_id]) + uleb128(len(payload)) + payload


def func_type(params: list[int], results: list[int]) -> bytes:
    return bytes([TYPE_FUNC]) + vec([bytes([p]) for p in params]) + vec([bytes([r]) for r in results])


def encode_body(locals_decl: list[tuple[int, int]], instructions: bytearray) -> bytes:
    loc_bytes = vec([uleb128(count) + bytes([val_type]) for count, val_type in locals_decl])
    body = loc_bytes + bytes(instructions) + bytes([OP_END])
    return uleb128(len(body)) + body


def build_alloc_bytes() -> bytes:
    c = bytearray()
    c += bytes([OP_LOCAL_GET, 0, OP_I32_CONST]) + sleb128(7) + bytes([OP_I32_ADD, OP_I32_CONST]) + sleb128(-8) + bytes([OP_I32_AND, OP_LOCAL_SET, 1])
    c += bytes([OP_LOCAL_GET, 1, OP_I32_CONST, 0, OP_I32_GT_S, OP_IF, VOID_BLOCK])
    c += bytes([OP_ELSE, OP_I32_CONST, 8, OP_LOCAL_SET, 1, OP_END])
    c += bytes([OP_GLOBAL_GET, 0, OP_LOCAL_TEE, 2, OP_LOCAL_GET, 1, OP_I32_ADD, OP_LOCAL_SET, 3])
    c += bytes([OP_MEMORY_SIZE, 0, OP_I32_CONST, 16, OP_I32_SHL, OP_LOCAL_SET, 4])
    c += bytes([OP_LOCAL_GET, 3, OP_LOCAL_GET, 4, OP_I32_GT_U, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 3, OP_LOCAL_GET, 4, OP_I32_SUB, OP_I32_CONST]) + sleb128(65535) + bytes([OP_I32_ADD])
    c += bytes([OP_I32_CONST]) + sleb128(65536) + bytes([OP_I32_DIV_U, OP_LOCAL_SET, 5])
    c += bytes([OP_LOCAL_GET, 5, OP_MEMORY_GROW, 0, OP_I32_CONST]) + sleb128(-1) + bytes([OP_I32_EQ, OP_IF, VOID_BLOCK])
    c += bytes([OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_END])
    c += bytes([OP_LOCAL_GET, 3, OP_GLOBAL_SET, 0, OP_LOCAL_GET, 2])
    return encode_body([(5, TYPE_I32)], c)


def build_reset_arena() -> bytes:
    c = bytearray()
    c += bytes([OP_I32_CONST]) + sleb128(4096) + bytes([OP_GLOBAL_SET, 0])
    return encode_body([], c)


def build_get_heap_ptr() -> bytes:
    c = bytearray([OP_GLOBAL_GET, 0])
    return encode_body([], c)


def build_expand_radial() -> bytes:
    c = bytearray()
    c += bytes([OP_LOCAL_GET, 1, OP_I32_CONST, 1, OP_I32_LT_S, OP_IF, VOID_BLOCK, OP_I32_CONST, 0, OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 2, OP_I32_CONST, 1, OP_I32_LT_S, OP_IF, VOID_BLOCK, OP_I32_CONST, 0, OP_RETURN, OP_END])

    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 7])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 2, OP_I32_GE_S, OP_BR_IF, 1])

    c += bytes([OP_LOCAL_GET, 5, OP_LOCAL_GET, 7, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 9])
    c += bytes([OP_F64_LOAD, 3, 0, OP_LOCAL_SET, 12])
    c += bytes([OP_LOCAL_GET, 9, OP_F64_LOAD, 3, 8, OP_LOCAL_SET, 13])

    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 8])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 8, OP_LOCAL_GET, 1, OP_I32_GE_S, OP_BR_IF, 1])

    c += bytes([OP_LOCAL_GET, 0, OP_LOCAL_GET, 8, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 10])
    c += bytes([OP_F64_LOAD, 3, 0, OP_LOCAL_GET, 3, OP_F64_SUB, OP_LOCAL_SET, 14])
    c += bytes([OP_LOCAL_GET, 10, OP_F64_LOAD, 3, 8, OP_LOCAL_GET, 4, OP_F64_SUB, OP_LOCAL_SET, 15])

    c += bytes([OP_LOCAL_GET, 6, OP_LOCAL_GET, 7, OP_LOCAL_GET, 1, OP_I32_MUL, OP_LOCAL_GET, 8, OP_I32_ADD, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 11])
    c += bytes([OP_LOCAL_GET, 3, OP_LOCAL_GET, 14, OP_LOCAL_GET, 12, OP_F64_MUL, OP_LOCAL_GET, 15, OP_LOCAL_GET, 13, OP_F64_MUL, OP_F64_SUB, OP_F64_ADD, OP_F64_STORE, 3, 0])
    c += bytes([OP_LOCAL_GET, 11, OP_LOCAL_GET, 4, OP_LOCAL_GET, 14, OP_LOCAL_GET, 13, OP_F64_MUL, OP_LOCAL_GET, 15, OP_LOCAL_GET, 12, OP_F64_MUL, OP_F64_ADD, OP_F64_ADD, OP_F64_STORE, 3, 8])

    c += bytes([OP_LOCAL_GET, 8, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 8, OP_BR, 0, OP_END, OP_END])
    c += bytes([OP_LOCAL_GET, 7, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 7, OP_BR, 0, OP_END, OP_END])

    c += bytes([OP_LOCAL_GET, 2, OP_LOCAL_GET, 1, OP_I32_MUL])
    return encode_body([(5, TYPE_I32), (4, TYPE_F64)], c)


def build_expand_mirror_radial() -> bytes:
    c = bytearray()
    c += bytes([OP_LOCAL_GET, 1, OP_I32_CONST, 1, OP_I32_LT_S, OP_IF, VOID_BLOCK, OP_I32_CONST, 0, OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 2, OP_I32_CONST, 1, OP_I32_LT_S, OP_IF, VOID_BLOCK, OP_I32_CONST, 0, OP_RETURN, OP_END])

    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 7])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 2, OP_I32_GE_S, OP_BR_IF, 1])

    c += bytes([OP_LOCAL_GET, 5, OP_LOCAL_GET, 7, OP_I32_CONST, 5, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 9])
    c += bytes([OP_F64_LOAD, 3, 0, OP_LOCAL_SET, 13])
    c += bytes([OP_LOCAL_GET, 9, OP_F64_LOAD, 3, 8, OP_LOCAL_SET, 14])
    c += bytes([OP_LOCAL_GET, 9, OP_F64_LOAD, 3, 16, OP_LOCAL_SET, 15])
    c += bytes([OP_LOCAL_GET, 9, OP_F64_LOAD, 3, 24, OP_LOCAL_SET, 16])

    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 8])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 8, OP_LOCAL_GET, 1, OP_I32_GE_S, OP_BR_IF, 1])

    c += bytes([OP_LOCAL_GET, 0, OP_LOCAL_GET, 8, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 10])
    c += bytes([OP_F64_LOAD, 3, 0, OP_LOCAL_GET, 3, OP_F64_SUB, OP_LOCAL_SET, 17])
    c += bytes([OP_LOCAL_GET, 10, OP_F64_LOAD, 3, 8, OP_LOCAL_GET, 4, OP_F64_SUB, OP_LOCAL_SET, 18])

    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 13, OP_F64_MUL, OP_LOCAL_GET, 18, OP_LOCAL_GET, 14, OP_F64_MUL, OP_F64_SUB, OP_LOCAL_SET, 19])
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 14, OP_F64_MUL, OP_LOCAL_GET, 18, OP_LOCAL_GET, 13, OP_F64_MUL, OP_F64_ADD, OP_LOCAL_SET, 20])

    c += bytes([OP_LOCAL_GET, 6, OP_LOCAL_GET, 7, OP_I32_CONST, 1, OP_I32_SHL, OP_LOCAL_GET, 1, OP_I32_MUL, OP_LOCAL_GET, 8, OP_I32_ADD, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 11])
    c += bytes([OP_LOCAL_GET, 3, OP_LOCAL_GET, 19, OP_F64_ADD, OP_F64_STORE, 3, 0])
    c += bytes([OP_LOCAL_GET, 11, OP_LOCAL_GET, 4, OP_LOCAL_GET, 20, OP_F64_ADD, OP_F64_STORE, 3, 8])

    c += bytes([OP_LOCAL_GET, 11, OP_LOCAL_GET, 1, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 12])
    c += bytes([OP_LOCAL_GET, 3, OP_LOCAL_GET, 19, OP_LOCAL_GET, 15, OP_F64_MUL, OP_LOCAL_GET, 20, OP_LOCAL_GET, 16, OP_F64_MUL, OP_F64_ADD, OP_F64_ADD, OP_F64_STORE, 3, 0])
    c += bytes([OP_LOCAL_GET, 12, OP_LOCAL_GET, 4, OP_LOCAL_GET, 19, OP_LOCAL_GET, 16, OP_F64_MUL, OP_LOCAL_GET, 20, OP_LOCAL_GET, 15, OP_F64_MUL, OP_F64_SUB, OP_F64_ADD, OP_F64_STORE, 3, 8])

    c += bytes([OP_LOCAL_GET, 8, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 8, OP_BR, 0, OP_END, OP_END])
    c += bytes([OP_LOCAL_GET, 7, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 7, OP_BR, 0, OP_END, OP_END])

    c += bytes([OP_LOCAL_GET, 2, OP_I32_CONST, 1, OP_I32_SHL, OP_LOCAL_GET, 1, OP_I32_MUL])
    return encode_body([(6, TYPE_I32), (8, TYPE_F64)], c)


def build_inject_panic() -> bytes:
    return encode_body([], bytearray([OP_UNREACHABLE]))


def build_sin_f64() -> bytes:
    # Param: 0:theta(f64) -> f64
    # Locals f64: 1:x, 2:x2, 3:poly
    PI = 3.141592653589793
    TAU = 6.283185307179586
    HALF_PI = 1.5707963267948966

    c = bytearray()
    # k = floor((theta + PI) / TAU)
    # x = theta - k * TAU
    c += bytes([OP_LOCAL_GET, 0])
    c += f64_const(PI) + bytes([OP_F64_ADD])
    c += f64_const(TAU) + bytes([OP_F64_DIV, OP_F64_FLOOR])
    c += f64_const(TAU) + bytes([OP_F64_MUL])
    c += bytes([OP_LOCAL_GET, 0, OP_LOCAL_SET, 1])  # temp
    c += bytes([OP_LOCAL_SET, 2])  # k * TAU
    c += bytes([OP_LOCAL_GET, 1, OP_LOCAL_GET, 2, OP_F64_SUB, OP_LOCAL_SET, 1])

    # Fold [-PI, PI] -> [-PI/2, PI/2]
    # if x > PI/2: x = PI - x
    c += bytes([OP_LOCAL_GET, 1]) + f64_const(HALF_PI) + bytes([OP_F64_GT, OP_IF, VOID_BLOCK])
    c += f64_const(PI) + bytes([OP_LOCAL_GET, 1, OP_F64_SUB, OP_LOCAL_SET, 1])
    c += bytes([OP_ELSE])
    # else if x < -PI/2: x = -PI - x
    c += bytes([OP_LOCAL_GET, 1]) + f64_const(-HALF_PI) + bytes([OP_F64_LT, OP_IF, VOID_BLOCK])
    c += f64_const(-PI) + bytes([OP_LOCAL_GET, 1, OP_F64_SUB, OP_LOCAL_SET, 1])
    c += bytes([OP_END])
    c += bytes([OP_END])

    # x2 = x * x
    c += bytes([OP_LOCAL_GET, 1, OP_LOCAL_GET, 1, OP_F64_MUL, OP_LOCAL_SET, 2])

    # poly = 1.0 - x2 * (1/506)  (terms up to x^23/23!, error < 2e-16 on [-pi/2, pi/2])
    c += f64_const(1.0) + bytes([OP_LOCAL_GET, 2]) + f64_const(1.0 / 506.0) + bytes([OP_F64_MUL, OP_F64_SUB, OP_LOCAL_SET, 3])
    for denom in (420.0, 342.0, 272.0, 210.0, 156.0, 110.0, 72.0, 42.0, 20.0, 6.0):
        c += (
            f64_const(1.0)
            + bytes([OP_LOCAL_GET, 2])
            + f64_const(1.0 / denom)
            + bytes([OP_F64_MUL, OP_LOCAL_GET, 3, OP_F64_MUL, OP_F64_SUB, OP_LOCAL_SET, 3])
        )

    c += bytes([OP_LOCAL_GET, 1, OP_LOCAL_GET, 3, OP_F64_MUL])
    return encode_body([(3, TYPE_F64)], c)


def build_expand_lsystem_bytes() -> bytes:
    # Params:
    # 0: axiom_ptr(i32), 1: axiom_len(i32), 2: rules_ptr(i32), 3: generations(i32),
    # 4: buf_a(i32), 5: buf_b(i32), 6: max_cap(i32), 7: out_meta_ptr(i32) -> i32
    # Locals i32 (13: 8..20):
    # 8:cur_ptr, 9:next_ptr, 10:cur_len, 11:g, 12:i, 13:ch, 14:slot, 15:r_ptr, 16:r_len, 17:out_len, 18:k, 19:tmp
    c = bytearray()

    # Guard axiom_len <= 0 || axiom_len > max_cap -> return -1
    c += bytes([OP_LOCAL_GET, 1, OP_I32_CONST, 0, OP_I32_LE_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 1, OP_LOCAL_GET, 6, OP_I32_GT_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])

    # Copy axiom into buf_a
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 12])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 12, OP_LOCAL_GET, 1, OP_I32_GE_S, OP_BR_IF, 1])
    c += bytes([OP_LOCAL_GET, 4, OP_LOCAL_GET, 12, OP_I32_ADD])
    c += bytes([OP_LOCAL_GET, 0, OP_LOCAL_GET, 12, OP_I32_ADD, OP_I32_LOAD8_U, 0, 0])
    c += bytes([OP_I32_STORE8, 0, 0])
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 12, OP_BR, 0, OP_END, OP_END])

    c += bytes([OP_LOCAL_GET, 4, OP_LOCAL_SET, 8])   # cur_ptr = buf_a
    c += bytes([OP_LOCAL_GET, 5, OP_LOCAL_SET, 9])   # next_ptr = buf_b
    c += bytes([OP_LOCAL_GET, 1, OP_LOCAL_SET, 10])  # cur_len = axiom_len

    # g = 0 .. generations - 1
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 11])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 11, OP_LOCAL_GET, 3, OP_I32_GE_S, OP_BR_IF, 1])

    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 17])  # out_len = 0
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 12])  # i = 0
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 12, OP_LOCAL_GET, 10, OP_I32_GE_S, OP_BR_IF, 1])

    # ch = cur_ptr[i]
    c += bytes([OP_LOCAL_GET, 8, OP_LOCAL_GET, 12, OP_I32_ADD, OP_I32_LOAD8_U, 0, 0, OP_LOCAL_TEE, 13])
    # slot = rules_ptr + ((ch & 127) << 3)
    c += bytes([OP_I32_CONST]) + sleb128(127) + bytes([OP_I32_AND, OP_I32_CONST, 3, OP_I32_SHL, OP_LOCAL_GET, 2, OP_I32_ADD, OP_LOCAL_TEE, 14])
    c += bytes([OP_I32_LOAD, 2, 0, OP_LOCAL_SET, 15])  # r_ptr
    c += bytes([OP_LOCAL_GET, 14, OP_I32_LOAD, 2, 4, OP_LOCAL_SET, 16])  # r_len

    # if r_ptr == 0 -> copy single char
    c += bytes([OP_LOCAL_GET, 15, OP_I32_EQZ, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 6, OP_I32_GE_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 9, OP_LOCAL_GET, 17, OP_I32_ADD, OP_LOCAL_GET, 13, OP_I32_STORE8, 0, 0])
    c += bytes([OP_LOCAL_GET, 17, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 17])
    c += bytes([OP_ELSE])
    # copy r_len chars from r_ptr
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 16, OP_I32_ADD, OP_LOCAL_GET, 6, OP_I32_GT_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 18])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 18, OP_LOCAL_GET, 16, OP_I32_GE_S, OP_BR_IF, 1])
    c += bytes([OP_LOCAL_GET, 9, OP_LOCAL_GET, 17, OP_I32_ADD, OP_LOCAL_GET, 18, OP_I32_ADD])
    c += bytes([OP_LOCAL_GET, 15, OP_LOCAL_GET, 18, OP_I32_ADD, OP_I32_LOAD8_U, 0, 0, OP_I32_STORE8, 0, 0])
    c += bytes([OP_LOCAL_GET, 18, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 18, OP_BR, 0, OP_END, OP_END])
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 16, OP_I32_ADD, OP_LOCAL_SET, 17])
    c += bytes([OP_END])

    # i++
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 12, OP_BR, 0, OP_END, OP_END])

    # swap cur_ptr and next_ptr; cur_len = out_len
    c += bytes([OP_LOCAL_GET, 8, OP_LOCAL_SET, 19])
    c += bytes([OP_LOCAL_GET, 9, OP_LOCAL_SET, 8])
    c += bytes([OP_LOCAL_GET, 19, OP_LOCAL_SET, 9])
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_SET, 10])

    # g++
    c += bytes([OP_LOCAL_GET, 11, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 11, OP_BR, 0, OP_END, OP_END])

    # Store out_meta[0] = cur_ptr, out_meta[4] = cur_len
    c += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 8, OP_I32_STORE, 2, 0])
    c += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 10, OP_I32_STORE, 2, 4])
    c += bytes([OP_LOCAL_GET, 10])
    return encode_body([(12, TYPE_I32)], c)


def build_interpret_lsystem_turtle() -> bytes:
    # Params (11):
    # 0:instr_ptr(i32), 1:instr_len(i32), 2:step_len(f64), 3:rad_angle(f64),
    # 4:start_x(f64), 5:start_y(f64), 6:stack_ptr(i32), 7:out_pts_ptr(i32),
    # 8:out_lens_ptr(i32), 9:max_pts(i32), 10:max_polys(i32) -> i32 (poly_count)
    # Locals i32 (7: 11..17): 11:i, 12:cmd, 13:total_pts, 14:poly_pts, 15:poly_count, 16:sp, 17:off
    # Locals f64 (4: 18..21): 18:x, 19:y, 20:angle, 21:half_pi
    HALF_PI = 1.5707963267948966

    c = bytearray()
    c += bytes([OP_LOCAL_GET, 9, OP_I32_CONST, 1, OP_I32_LT_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 10, OP_I32_CONST, 1, OP_I32_LT_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])

    c += bytes([OP_LOCAL_GET, 4, OP_LOCAL_SET, 18])  # x = start_x
    c += bytes([OP_LOCAL_GET, 5, OP_LOCAL_SET, 19])  # y = start_y
    c += f64_const(-HALF_PI) + bytes([OP_LOCAL_SET, 20])  # angle = -PI/2
    c += f64_const(HALF_PI) + bytes([OP_LOCAL_SET, 21])   # half_pi = PI/2

    # Push initial point
    c += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 18, OP_F64_STORE, 3, 0])
    c += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 19, OP_F64_STORE, 3, 8])
    c += bytes([OP_I32_CONST, 1, OP_LOCAL_SET, 13])  # total_pts = 1
    c += bytes([OP_I32_CONST, 1, OP_LOCAL_SET, 14])  # poly_pts = 1
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 15])  # poly_count = 0
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 16])  # sp = 0

    def emit_close_or_rewind(inst: bytearray) -> None:
        inst += bytes([OP_LOCAL_GET, 14, OP_I32_CONST, 1, OP_I32_GT_S, OP_IF, VOID_BLOCK])
        inst += bytes([OP_LOCAL_GET, 15, OP_LOCAL_GET, 10, OP_I32_GE_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
        inst += bytes([OP_LOCAL_GET, 8, OP_LOCAL_GET, 15, OP_I32_CONST, 2, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_GET, 14, OP_I32_STORE, 2, 0])
        inst += bytes([OP_LOCAL_GET, 15, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 15])
        inst += bytes([OP_ELSE])
        inst += bytes([OP_LOCAL_GET, 13, OP_I32_CONST, 1, OP_I32_SUB, OP_LOCAL_SET, 13])
        inst += bytes([OP_END])

    def emit_push_xy(inst: bytearray) -> None:
        inst += bytes([OP_LOCAL_GET, 13, OP_LOCAL_GET, 9, OP_I32_GE_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
        inst += bytes([OP_LOCAL_GET, 7, OP_LOCAL_GET, 13, OP_I32_CONST, 4, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_TEE, 17])
        inst += bytes([OP_LOCAL_GET, 18, OP_F64_STORE, 3, 0])
        inst += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 19, OP_F64_STORE, 3, 8])
        inst += bytes([OP_LOCAL_GET, 13, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 13])

    def emit_advance_xy(inst: bytearray) -> None:
        # x += step_len * sin(angle + half_pi)
        inst += bytes([OP_LOCAL_GET, 18, OP_LOCAL_GET, 2])
        inst += bytes([OP_LOCAL_GET, 20, OP_LOCAL_GET, 21, OP_F64_ADD, OP_CALL, FN_SIN_F64])
        inst += bytes([OP_F64_MUL, OP_F64_ADD, OP_LOCAL_SET, 18])
        # y += step_len * sin(angle)
        inst += bytes([OP_LOCAL_GET, 19, OP_LOCAL_GET, 2])
        inst += bytes([OP_LOCAL_GET, 20, OP_CALL, FN_SIN_F64])
        inst += bytes([OP_F64_MUL, OP_F64_ADD, OP_LOCAL_SET, 19])

    # Loop i = 0 .. instr_len - 1
    c += bytes([OP_I32_CONST, 0, OP_LOCAL_SET, 11])
    c += bytes([OP_BLOCK, VOID_BLOCK, OP_LOOP, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 11, OP_LOCAL_GET, 1, OP_I32_GE_S, OP_BR_IF, 1])

    c += bytes([OP_LOCAL_GET, 0, OP_LOCAL_GET, 11, OP_I32_ADD, OP_I32_LOAD8_U, 0, 0, OP_LOCAL_SET, 12])

    # if cmd == 'F'(70) || cmd == 'A'(65) || cmd == 'B'(66) || cmd == 'G'(71)
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(70) + bytes([OP_I32_EQ])
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(65) + bytes([OP_I32_EQ, OP_I32_OR])
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(66) + bytes([OP_I32_EQ, OP_I32_OR])
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(71) + bytes([OP_I32_EQ, OP_I32_OR])
    c += bytes([OP_IF, VOID_BLOCK])
    emit_advance_xy(c)
    emit_push_xy(c)
    c += bytes([OP_LOCAL_GET, 14, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 14])
    c += bytes([OP_ELSE])

    # else if cmd == 'f'(102)
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(102) + bytes([OP_I32_EQ, OP_IF, VOID_BLOCK])
    emit_advance_xy(c)
    emit_close_or_rewind(c)
    emit_push_xy(c)
    c += bytes([OP_I32_CONST, 1, OP_LOCAL_SET, 14])
    c += bytes([OP_ELSE])

    # else if cmd == '+'(43)
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(43) + bytes([OP_I32_EQ, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 20, OP_LOCAL_GET, 3, OP_F64_ADD, OP_LOCAL_SET, 20])
    c += bytes([OP_ELSE])

    # else if cmd == '-'(45)
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(45) + bytes([OP_I32_EQ, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 20, OP_LOCAL_GET, 3, OP_F64_SUB, OP_LOCAL_SET, 20])
    c += bytes([OP_ELSE])

    # else if cmd == '['(91)
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(91) + bytes([OP_I32_EQ, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 16, OP_I32_CONST]) + sleb128(256) + bytes([OP_I32_GE_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 6, OP_LOCAL_GET, 16, OP_I32_CONST, 24, OP_I32_MUL, OP_I32_ADD, OP_LOCAL_TEE, 17])
    c += bytes([OP_LOCAL_GET, 18, OP_F64_STORE, 3, 0])
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 19, OP_F64_STORE, 3, 8])
    c += bytes([OP_LOCAL_GET, 17, OP_LOCAL_GET, 20, OP_F64_STORE, 3, 16])
    c += bytes([OP_LOCAL_GET, 16, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 16])
    c += bytes([OP_ELSE])

    # else if cmd == ']'(93)
    c += bytes([OP_LOCAL_GET, 12, OP_I32_CONST]) + sleb128(93) + bytes([OP_I32_EQ, OP_IF, VOID_BLOCK])
    emit_close_or_rewind(c)
    c += bytes([OP_LOCAL_GET, 16, OP_I32_CONST, 0, OP_I32_GT_S, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 16, OP_I32_CONST, 1, OP_I32_SUB, OP_LOCAL_TEE, 16])
    c += bytes([OP_I32_CONST, 24, OP_I32_MUL, OP_LOCAL_GET, 6, OP_I32_ADD, OP_LOCAL_TEE, 17])
    c += bytes([OP_F64_LOAD, 3, 0, OP_LOCAL_SET, 18])
    c += bytes([OP_LOCAL_GET, 17, OP_F64_LOAD, 3, 8, OP_LOCAL_SET, 19])
    c += bytes([OP_LOCAL_GET, 17, OP_F64_LOAD, 3, 16, OP_LOCAL_SET, 20])
    c += bytes([OP_END])
    emit_push_xy(c)
    c += bytes([OP_I32_CONST, 1, OP_LOCAL_SET, 14])
    c += bytes([OP_END])  # end if ]
    c += bytes([OP_END])  # end if [
    c += bytes([OP_END])  # end if -
    c += bytes([OP_END])  # end if +
    c += bytes([OP_END])  # end if f
    c += bytes([OP_END])  # end if FABG

    # i++
    c += bytes([OP_LOCAL_GET, 11, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 11, OP_BR, 0, OP_END, OP_END])

    # Trailing polyline
    c += bytes([OP_LOCAL_GET, 14, OP_I32_CONST, 1, OP_I32_GT_S, OP_IF, VOID_BLOCK])
    c += bytes([OP_LOCAL_GET, 15, OP_LOCAL_GET, 10, OP_I32_GE_S, OP_IF, VOID_BLOCK, OP_I32_CONST]) + sleb128(-1) + bytes([OP_RETURN, OP_END])
    c += bytes([OP_LOCAL_GET, 8, OP_LOCAL_GET, 15, OP_I32_CONST, 2, OP_I32_SHL, OP_I32_ADD, OP_LOCAL_GET, 14, OP_I32_STORE, 2, 0])
    c += bytes([OP_LOCAL_GET, 15, OP_I32_CONST, 1, OP_I32_ADD, OP_LOCAL_SET, 15])
    c += bytes([OP_END])

    c += bytes([OP_LOCAL_GET, 15])
    return encode_body([(7, TYPE_I32), (4, TYPE_F64)], c)


def build_wasm_module() -> bytes:
    types = [
        func_type([TYPE_I32], [TYPE_I32]),                                                              # 0: alloc_bytes
        func_type([], []),                                                                              # 1: void -> void
        func_type([], [TYPE_I32]),                                                                      # 2: () -> i32
        func_type([TYPE_I32, TYPE_I32, TYPE_I32, TYPE_F64, TYPE_F64, TYPE_I32, TYPE_I32], [TYPE_I32]),  # 3: expand kernels
        func_type([TYPE_F64], [TYPE_F64]),                                                              # 4: sin_f64
        func_type([TYPE_I32] * 8, [TYPE_I32]),                                                          # 5: expand_lsystem_bytes
        func_type(                                                                                      # 6: interpret_lsystem_turtle_f64
            [TYPE_I32, TYPE_I32, TYPE_F64, TYPE_F64, TYPE_F64, TYPE_F64, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32, TYPE_I32],
            [TYPE_I32],
        ),
    ]
    func_type_indices = [
        uleb128(0),  # 0: alloc_bytes
        uleb128(1),  # 1: reset_arena
        uleb128(2),  # 2: get_heap_ptr
        uleb128(3),  # 3: expand_radial_f64
        uleb128(3),  # 4: expand_mirror_radial_f64
        uleb128(1),  # 5: inject_panic_test
        uleb128(4),  # 6: sin_f64
        uleb128(5),  # 7: expand_lsystem_bytes
        uleb128(6),  # 8: interpret_lsystem_turtle_f64
    ]

    # Memory: flags=1 (has max), initial=32 (2 MiB), max=512 (32 MiB) for large L-System Gen6 arenas
    mem_sec = vec([bytes([0x01]) + uleb128(32) + uleb128(512)])

    # Global 0: mut i32 = 4096
    global_sec = vec([bytes([TYPE_I32, 0x01, OP_I32_CONST]) + sleb128(4096) + bytes([OP_END])])

    def exp(name: str, kind: int, idx: int) -> bytes:
        nb = name.encode("utf-8")
        return uleb128(len(nb)) + nb + bytes([kind]) + uleb128(idx)

    export_sec = vec([
        exp("memory", 0x02, 0),
        exp("alloc_bytes", 0x00, 0),
        exp("reset_arena", 0x00, 1),
        exp("get_heap_ptr", 0x00, 2),
        exp("expand_radial_f64", 0x00, 3),
        exp("expand_mirror_radial_f64", 0x00, 4),
        exp("inject_panic_test", 0x00, 5),
        exp("sin_f64", 0x00, 6),
        exp("expand_lsystem_bytes", 0x00, 7),
        exp("interpret_lsystem_turtle_f64", 0x00, 8),
    ])

    code_sec = vec([
        build_alloc_bytes(),
        build_reset_arena(),
        build_get_heap_ptr(),
        build_expand_radial(),
        build_expand_mirror_radial(),
        build_inject_panic(),
        build_sin_f64(),
        build_expand_lsystem_bytes(),
        build_interpret_lsystem_turtle(),
    ])

    return (
        b"\x00asm"
        + struct.pack("<I", 1)
        + section(SEC_TYPE, vec(types))
        + section(SEC_FUNCTION, vec(func_type_indices))
        + section(SEC_MEMORY, mem_sec)
        + section(SEC_GLOBAL, global_sec)
        + section(SEC_EXPORT, export_sec)
        + section(SEC_CODE, code_sec)
    )


if __name__ == "__main__":
    out_path = Path(__file__).resolve().parent.parent / "public" / "wasm" / "mandala_symmetry.wasm"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wasm_bytes = build_wasm_module()
    out_path.write_bytes(wasm_bytes)
    print(f"Generated {out_path} ({len(wasm_bytes)} bytes)")
