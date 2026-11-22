#!/usr/bin/env python3
"""Deterministic WebAssembly MVP binary emitter for Mandala Studio.

Generates ``public/wasm/mandala_symmetry.wasm`` containing zero-dependency
IEEE-754 ``f64`` linear-memory symmetry kernels, bump-arena allocator,
L-System byte expander, turtle graphics interpreter, and panic-trap test.
The binary ABI constants are kept in strict parity with ``WASM_ABI_SPEC`` in
``src/features/mandala/model/constants.ts``.
"""

from __future__ import annotations

import argparse
import contextlib
import logging
import math
import os
import struct
from dataclasses import dataclass
from enum import IntEnum
from pathlib import Path
from typing import Final, Iterator, Protocol, Sequence

LOGGER: Final[logging.Logger] = logging.getLogger("mandala.build_wasm")

WASM_MAGIC_HEADER: Final[bytes] = b"\x00asm"
WASM_BINARY_VERSION: Final[int] = 1
VOID_BLOCK_TYPE: Final[int] = 0x40
FN_SIN_F64_INDEX: Final[int] = 6
SIN_TAYLOR_DENOMINATORS: Final[tuple[float, ...]] = (
    420.0,
    342.0,
    272.0,
    210.0,
    156.0,
    110.0,
    72.0,
    42.0,
    20.0,
    6.0,
)
SIN_TAYLOR_LAST_DENOMINATOR: Final[float] = 506.0


class WasmValType(IntEnum):
    """WebAssembly MVP value and function type encodings."""

    I32 = 0x7F
    F64 = 0x7C
    FUNC = 0x60


class WasmSectionId(IntEnum):
    """Standard WebAssembly binary section identifiers."""

    TYPE = 1
    FUNCTION = 3
    MEMORY = 5
    GLOBAL = 6
    EXPORT = 7
    CODE = 10


class WasmExportKind(IntEnum):
    """WebAssembly export descriptor tags."""

    FUNC = 0x00
    MEMORY = 0x02


class WasmOpcode(IntEnum):
    """Subset of WebAssembly MVP opcodes used by Mandala symmetry kernels."""

    UNREACHABLE = 0x00
    BLOCK = 0x02
    LOOP = 0x03
    IF = 0x04
    ELSE = 0x05
    END = 0x0B
    BR = 0x0C
    BR_IF = 0x0D
    RETURN = 0x0F
    CALL = 0x10
    LOCAL_GET = 0x20
    LOCAL_SET = 0x21
    LOCAL_TEE = 0x22
    GLOBAL_GET = 0x23
    GLOBAL_SET = 0x24
    I32_LOAD = 0x28
    F64_LOAD = 0x2B
    I32_LOAD8_U = 0x2D
    I32_STORE = 0x36
    F64_STORE = 0x39
    I32_STORE8 = 0x3A
    MEMORY_SIZE = 0x3F
    MEMORY_GROW = 0x40
    I32_CONST = 0x41
    F64_CONST = 0x44
    I32_EQZ = 0x45
    I32_EQ = 0x46
    I32_LT_S = 0x48
    I32_GT_S = 0x4A
    I32_GT_U = 0x4B
    I32_LE_S = 0x4C
    I32_GE_S = 0x4E
    F64_LT = 0x63
    F64_GT = 0x64
    I32_ADD = 0x6A
    I32_SUB = 0x6B
    I32_MUL = 0x6C
    I32_DIV_U = 0x6E
    I32_AND = 0x71
    I32_OR = 0x72
    I32_SHL = 0x74
    F64_FLOOR = 0x9C
    F64_ADD = 0xA0
    F64_SUB = 0xA1
    F64_MUL = 0xA2
    F64_DIV = 0xA3


@dataclass(frozen=True)
class WasmAbiSpec:
    """Canonical linear-memory ABI constants synchronized with ``WASM_ABI_SPEC``."""

    heap_base_offset_bytes: int = 4096
    initial_memory_pages: int = 32
    max_memory_pages: int = 512
    rules_table_bytes: int = 1024
    rule_entry_stride_bytes: int = 8
    turtle_stack_max_depth: int = 256
    turtle_stack_frame_bytes: int = 24
    out_meta_bytes: int = 16
    point_stride_f64_bytes: int = 16
    poly_length_stride_bytes: int = 4


ABI_SPEC: Final[WasmAbiSpec] = WasmAbiSpec()


class BinarySectionBuilder(Protocol):
    """Protocol for WebAssembly module section generators."""

    def build_bytes(self) -> bytes:
        """Encode the section/body into raw WebAssembly binary bytes."""


def uleb128(value: int) -> bytes:
    """Encode an unsigned non-negative integer as LEB128."""
    if value < 0:
        raise ValueError(f"uleb128 requires a non-negative integer, got {value}")
    out = bytearray()
    remaining = value
    while True:
        byte = remaining & 0x7F
        remaining >>= 7
        if remaining != 0:
            byte |= 0x80
        out.append(byte)
        if remaining == 0:
            break
    return bytes(out)


def sleb128(value: int) -> bytes:
    """Encode a signed 32-bit integer as signed LEB128."""
    if value < -(1 << 31) or value > (1 << 31) - 1:
        raise ValueError(f"sleb128 out of signed 32-bit range: {value}")
    out = bytearray()
    remaining = value
    more = True
    while more:
        byte = remaining & 0x7F
        remaining >>= 7
        if (remaining == 0 and (byte & 0x40) == 0) or (
            remaining == -1 and (byte & 0x40) != 0
        ):
            more = False
        else:
            byte |= 0x80
        out.append(byte)
    return bytes(out)


def encode_vec(items: Sequence[bytes]) -> bytes:
    """Encode a WebAssembly vector prefixed by item count in uleb128."""
    return uleb128(len(items)) + b"".join(items)


def encode_section(section_id: WasmSectionId, payload: bytes) -> bytes:
    """Encode a WebAssembly section with ID, byte length, and payload."""
    return bytes([int(section_id)]) + uleb128(len(payload)) + payload


def encode_func_type(
    params: Sequence[WasmValType], results: Sequence[WasmValType]
) -> bytes:
    """Encode a WebAssembly function type signature."""
    return (
        bytes([int(WasmValType.FUNC)])
        + encode_vec([bytes([int(p)]) for p in params])
        + encode_vec([bytes([int(r)]) for r in results])
    )


def encode_export(name: str, kind: WasmExportKind, index: int) -> bytes:
    """Encode a single WebAssembly export entry."""
    name_bytes = name.encode("utf-8")
    return uleb128(len(name_bytes)) + name_bytes + bytes([int(kind)]) + uleb128(index)


def encode_body(
    locals_decl: Sequence[tuple[int, WasmValType]], instructions: Sequence[int] | bytearray
) -> bytes:
    """Wrap local declarations and instruction bytes into a function code entry."""
    loc_bytes = encode_vec(
        [uleb128(count) + bytes([int(val_type)]) for count, val_type in locals_decl]
    )
    body = loc_bytes + bytes(instructions) + bytes([int(WasmOpcode.END)])
    return uleb128(len(body)) + body


class WasmCodeBuilder:
    """Fluent byte emitter for WebAssembly MVP instruction sequences."""

    def __init__(self) -> None:
        self._buf = bytearray()

    @property
    def buffer(self) -> bytearray:
        """Return the underlying mutable byte buffer."""
        return self._buf

    def raw(self, *values: int | WasmOpcode) -> WasmCodeBuilder:
        """Append raw byte values or opcodes."""
        self._buf.extend(int(v) for v in values)
        return self

    def sleb(self, value: int) -> WasmCodeBuilder:
        """Append a signed LEB128 literal."""
        self._buf.extend(sleb128(value))
        return self

    def f64(self, value: float) -> WasmCodeBuilder:
        """Append an ``f64.const`` opcode and IEEE-754 little-endian payload."""
        self._buf.append(int(WasmOpcode.F64_CONST))
        self._buf.extend(struct.pack("<d", value))
        return self

    def emit_close_or_rewind_turtle(self) -> WasmCodeBuilder:
        """Emit turtle polyline closing or single-point rewind instructions."""
        self.raw(WasmOpcode.LOCAL_GET, 14, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_GT_S, WasmOpcode.IF, VOID_BLOCK_TYPE)
        self.raw(WasmOpcode.LOCAL_GET, 15, WasmOpcode.LOCAL_GET, 10, WasmOpcode.I32_GE_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
        self.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.LOCAL_GET, 15, WasmOpcode.I32_CONST, 2, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_GET, 14, WasmOpcode.I32_STORE, 2, 0)
        self.raw(WasmOpcode.LOCAL_GET, 15, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 15)
        self.raw(WasmOpcode.ELSE)
        self.raw(WasmOpcode.LOCAL_GET, 13, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_SUB, WasmOpcode.LOCAL_SET, 13)
        self.raw(WasmOpcode.END)
        return self

    def emit_push_turtle_xy(self) -> WasmCodeBuilder:
        """Emit bounds-checked store of current turtle ``(x, y)`` into output buffer."""
        self.raw(WasmOpcode.LOCAL_GET, 13, WasmOpcode.LOCAL_GET, 9, WasmOpcode.I32_GE_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
        self.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 13, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 17)
        self.raw(WasmOpcode.LOCAL_GET, 18, WasmOpcode.F64_STORE, 3, 0)
        self.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 19, WasmOpcode.F64_STORE, 3, 8)
        self.raw(WasmOpcode.LOCAL_GET, 13, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 13)
        return self

    def emit_advance_turtle_xy(self) -> WasmCodeBuilder:
        """Advance turtle position ``(x, y)`` using WASM ``sin_f64`` Taylor kernel."""
        self.raw(WasmOpcode.LOCAL_GET, 18, WasmOpcode.LOCAL_GET, 2)
        self.raw(WasmOpcode.LOCAL_GET, 20, WasmOpcode.LOCAL_GET, 21, WasmOpcode.F64_ADD, WasmOpcode.CALL, FN_SIN_F64_INDEX)
        self.raw(WasmOpcode.F64_MUL, WasmOpcode.F64_ADD, WasmOpcode.LOCAL_SET, 18)
        self.raw(WasmOpcode.LOCAL_GET, 19, WasmOpcode.LOCAL_GET, 2)
        self.raw(WasmOpcode.LOCAL_GET, 20, WasmOpcode.CALL, FN_SIN_F64_INDEX)
        self.raw(WasmOpcode.F64_MUL, WasmOpcode.F64_ADD, WasmOpcode.LOCAL_SET, 19)
        return self


def build_alloc_bytes() -> bytes:
    """Build 8-byte aligned bump-allocator body growing linear memory on demand."""
    b = WasmCodeBuilder()
    b.raw(WasmOpcode.LOCAL_GET, 0, WasmOpcode.I32_CONST).sleb(7).raw(WasmOpcode.I32_ADD, WasmOpcode.I32_CONST).sleb(-8).raw(WasmOpcode.I32_AND, WasmOpcode.LOCAL_SET, 1)
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_CONST, 0, WasmOpcode.I32_GT_S, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.ELSE, WasmOpcode.I32_CONST, 8, WasmOpcode.LOCAL_SET, 1, WasmOpcode.END)
    b.raw(WasmOpcode.GLOBAL_GET, 0, WasmOpcode.LOCAL_TEE, 2, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 3)
    b.raw(WasmOpcode.MEMORY_SIZE, 0, WasmOpcode.I32_CONST, 16, WasmOpcode.I32_SHL, WasmOpcode.LOCAL_SET, 4)
    b.raw(WasmOpcode.LOCAL_GET, 3, WasmOpcode.LOCAL_GET, 4, WasmOpcode.I32_GT_U, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 3, WasmOpcode.LOCAL_GET, 4, WasmOpcode.I32_SUB, WasmOpcode.I32_CONST).sleb(65535).raw(WasmOpcode.I32_ADD)
    b.raw(WasmOpcode.I32_CONST).sleb(65536).raw(WasmOpcode.I32_DIV_U, WasmOpcode.LOCAL_SET, 5)
    b.raw(WasmOpcode.LOCAL_GET, 5, WasmOpcode.MEMORY_GROW, 0, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.I32_EQ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 3, WasmOpcode.GLOBAL_SET, 0, WasmOpcode.LOCAL_GET, 2)
    return encode_body([(5, WasmValType.I32)], b.buffer)


def build_reset_arena(abi: WasmAbiSpec) -> bytes:
    """Build ``reset_arena`` body restoring heap pointer to ``heap_base_offset_bytes``."""
    b = WasmCodeBuilder()
    b.raw(WasmOpcode.I32_CONST).sleb(abi.heap_base_offset_bytes).raw(WasmOpcode.GLOBAL_SET, 0)
    return encode_body([], b.buffer)


def build_get_heap_ptr() -> bytes:
    """Build ``get_heap_ptr`` returning current bump allocator pointer."""
    b = WasmCodeBuilder()
    b.raw(WasmOpcode.GLOBAL_GET, 0)
    return encode_body([], b.buffer)


def build_expand_radial() -> bytes:
    """Build IEEE-754 ``expand_radial_f64`` symmetry expansion kernel."""
    b = WasmCodeBuilder()
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_LT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST, 0, WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 2, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_LT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST, 0, WasmOpcode.RETURN, WasmOpcode.END)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 7)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 2, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)

    b.raw(WasmOpcode.LOCAL_GET, 5, WasmOpcode.LOCAL_GET, 7, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 9)
    b.raw(WasmOpcode.F64_LOAD, 3, 0, WasmOpcode.LOCAL_SET, 12)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.F64_LOAD, 3, 8, WasmOpcode.LOCAL_SET, 13)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 8)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)

    b.raw(WasmOpcode.LOCAL_GET, 0, WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 10)
    b.raw(WasmOpcode.F64_LOAD, 3, 0, WasmOpcode.LOCAL_GET, 3, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 14)
    b.raw(WasmOpcode.LOCAL_GET, 10, WasmOpcode.F64_LOAD, 3, 8, WasmOpcode.LOCAL_GET, 4, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 15)

    b.raw(WasmOpcode.LOCAL_GET, 6, WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_MUL, WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_ADD, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 11)
    b.raw(WasmOpcode.LOCAL_GET, 3, WasmOpcode.LOCAL_GET, 14, WasmOpcode.LOCAL_GET, 12, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 15, WasmOpcode.LOCAL_GET, 13, WasmOpcode.F64_MUL, WasmOpcode.F64_SUB, WasmOpcode.F64_ADD, WasmOpcode.F64_STORE, 3, 0)
    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.LOCAL_GET, 4, WasmOpcode.LOCAL_GET, 14, WasmOpcode.LOCAL_GET, 13, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 15, WasmOpcode.LOCAL_GET, 12, WasmOpcode.F64_MUL, WasmOpcode.F64_ADD, WasmOpcode.F64_ADD, WasmOpcode.F64_STORE, 3, 8)

    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 8, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 7, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 2, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_MUL)
    return encode_body([(5, WasmValType.I32), (4, WasmValType.F64)], b.buffer)


def build_expand_mirror_radial() -> bytes:
    """Build IEEE-754 ``expand_mirror_radial_f64`` symmetry expansion kernel."""
    b = WasmCodeBuilder()
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_LT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST, 0, WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 2, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_LT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST, 0, WasmOpcode.RETURN, WasmOpcode.END)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 7)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 2, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)

    b.raw(WasmOpcode.LOCAL_GET, 5, WasmOpcode.LOCAL_GET, 7, WasmOpcode.I32_CONST, 5, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 9)
    b.raw(WasmOpcode.F64_LOAD, 3, 0, WasmOpcode.LOCAL_SET, 13)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.F64_LOAD, 3, 8, WasmOpcode.LOCAL_SET, 14)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.F64_LOAD, 3, 16, WasmOpcode.LOCAL_SET, 15)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.F64_LOAD, 3, 24, WasmOpcode.LOCAL_SET, 16)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 8)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)

    b.raw(WasmOpcode.LOCAL_GET, 0, WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 10)
    b.raw(WasmOpcode.F64_LOAD, 3, 0, WasmOpcode.LOCAL_GET, 3, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 17)
    b.raw(WasmOpcode.LOCAL_GET, 10, WasmOpcode.F64_LOAD, 3, 8, WasmOpcode.LOCAL_GET, 4, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 18)

    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 13, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 18, WasmOpcode.LOCAL_GET, 14, WasmOpcode.F64_MUL, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 19)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 14, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 18, WasmOpcode.LOCAL_GET, 13, WasmOpcode.F64_MUL, WasmOpcode.F64_ADD, WasmOpcode.LOCAL_SET, 20)

    b.raw(WasmOpcode.LOCAL_GET, 6, WasmOpcode.LOCAL_GET, 7, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_SHL, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_MUL, WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_ADD, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 11)
    b.raw(WasmOpcode.LOCAL_GET, 3, WasmOpcode.LOCAL_GET, 19, WasmOpcode.F64_ADD, WasmOpcode.F64_STORE, 3, 0)
    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.LOCAL_GET, 4, WasmOpcode.LOCAL_GET, 20, WasmOpcode.F64_ADD, WasmOpcode.F64_STORE, 3, 8)

    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_CONST, 4, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 12)
    b.raw(WasmOpcode.LOCAL_GET, 3, WasmOpcode.LOCAL_GET, 19, WasmOpcode.LOCAL_GET, 15, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 20, WasmOpcode.LOCAL_GET, 16, WasmOpcode.F64_MUL, WasmOpcode.F64_ADD, WasmOpcode.F64_ADD, WasmOpcode.F64_STORE, 3, 0)
    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.LOCAL_GET, 4, WasmOpcode.LOCAL_GET, 19, WasmOpcode.LOCAL_GET, 16, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 20, WasmOpcode.LOCAL_GET, 15, WasmOpcode.F64_MUL, WasmOpcode.F64_SUB, WasmOpcode.F64_ADD, WasmOpcode.F64_STORE, 3, 8)

    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 8, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 7, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 2, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_SHL, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_MUL)
    return encode_body([(6, WasmValType.I32), (8, WasmValType.F64)], b.buffer)


def build_inject_panic() -> bytes:
    """Build deterministic ``unreachable`` trap function for WASM safety tests."""
    return encode_body([], [int(WasmOpcode.UNREACHABLE)])


def build_sin_f64() -> bytes:
    """Build 23rd-degree Horner Taylor ``sin(theta)`` kernel accurate within 2e-16."""
    pi_val = math.pi
    tau_val = math.tau
    half_pi_val = math.pi / 2.0

    b = WasmCodeBuilder()
    b.raw(WasmOpcode.LOCAL_GET, 0).f64(pi_val).raw(WasmOpcode.F64_ADD)
    b.f64(tau_val).raw(WasmOpcode.F64_DIV, WasmOpcode.F64_FLOOR)
    b.f64(tau_val).raw(WasmOpcode.F64_MUL)
    b.raw(WasmOpcode.LOCAL_GET, 0, WasmOpcode.LOCAL_SET, 1)
    b.raw(WasmOpcode.LOCAL_SET, 2)
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.LOCAL_GET, 2, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 1)

    b.raw(WasmOpcode.LOCAL_GET, 1).f64(half_pi_val).raw(WasmOpcode.F64_GT, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.f64(pi_val).raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 1)
    b.raw(WasmOpcode.ELSE)
    b.raw(WasmOpcode.LOCAL_GET, 1).f64(-half_pi_val).raw(WasmOpcode.F64_LT, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.f64(-pi_val).raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 1)
    b.raw(WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.LOCAL_GET, 1, WasmOpcode.F64_MUL, WasmOpcode.LOCAL_SET, 2)
    b.f64(1.0).raw(WasmOpcode.LOCAL_GET, 2).f64(1.0 / SIN_TAYLOR_LAST_DENOMINATOR)
    b.raw(WasmOpcode.F64_MUL, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 3)

    for denom in SIN_TAYLOR_DENOMINATORS:
        b.f64(1.0).raw(WasmOpcode.LOCAL_GET, 2).f64(1.0 / denom)
        b.raw(WasmOpcode.F64_MUL, WasmOpcode.LOCAL_GET, 3, WasmOpcode.F64_MUL, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 3)

    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.LOCAL_GET, 3, WasmOpcode.F64_MUL)
    return encode_body([(3, WasmValType.F64)], b.buffer)


def build_expand_lsystem_bytes() -> bytes:
    """Build linear-memory L-System grammar rewriting kernel ``expand_lsystem_bytes``."""
    b = WasmCodeBuilder()
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_CONST, 0, WasmOpcode.I32_LE_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.LOCAL_GET, 6, WasmOpcode.I32_GT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 12)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)
    b.raw(WasmOpcode.LOCAL_GET, 4, WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_ADD)
    b.raw(WasmOpcode.LOCAL_GET, 0, WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_ADD, WasmOpcode.I32_LOAD8_U, 0, 0)
    b.raw(WasmOpcode.I32_STORE8, 0, 0)
    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 12, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 4, WasmOpcode.LOCAL_SET, 8)
    b.raw(WasmOpcode.LOCAL_GET, 5, WasmOpcode.LOCAL_SET, 9)
    b.raw(WasmOpcode.LOCAL_GET, 1, WasmOpcode.LOCAL_SET, 10)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 11)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.LOCAL_GET, 3, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 17)
    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 12)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.LOCAL_GET, 10, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)

    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_ADD, WasmOpcode.I32_LOAD8_U, 0, 0, WasmOpcode.LOCAL_TEE, 13)
    b.raw(WasmOpcode.I32_CONST).sleb(127).raw(WasmOpcode.I32_AND, WasmOpcode.I32_CONST, 3, WasmOpcode.I32_SHL, WasmOpcode.LOCAL_GET, 2, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 14)
    b.raw(WasmOpcode.I32_LOAD, 2, 0, WasmOpcode.LOCAL_SET, 15)
    b.raw(WasmOpcode.LOCAL_GET, 14, WasmOpcode.I32_LOAD, 2, 4, WasmOpcode.LOCAL_SET, 16)

    b.raw(WasmOpcode.LOCAL_GET, 15, WasmOpcode.I32_EQZ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 6, WasmOpcode.I32_GE_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.LOCAL_GET, 17, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_GET, 13, WasmOpcode.I32_STORE8, 0, 0)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 17)
    b.raw(WasmOpcode.ELSE)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_GET, 6, WasmOpcode.I32_GT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 18)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 18, WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.LOCAL_GET, 17, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_GET, 18, WasmOpcode.I32_ADD)
    b.raw(WasmOpcode.LOCAL_GET, 15, WasmOpcode.LOCAL_GET, 18, WasmOpcode.I32_ADD, WasmOpcode.I32_LOAD8_U, 0, 0, WasmOpcode.I32_STORE8, 0, 0)
    b.raw(WasmOpcode.LOCAL_GET, 18, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 18, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 17)
    b.raw(WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 12, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.LOCAL_SET, 19)
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.LOCAL_SET, 8)
    b.raw(WasmOpcode.LOCAL_GET, 19, WasmOpcode.LOCAL_SET, 9)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_SET, 10)

    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 11, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 8, WasmOpcode.I32_STORE, 2, 0)
    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 10, WasmOpcode.I32_STORE, 2, 4)
    b.raw(WasmOpcode.LOCAL_GET, 10)
    return encode_body([(12, WasmValType.I32)], b.buffer)


def build_interpret_lsystem_turtle(abi: WasmAbiSpec) -> bytes:
    """Build linear-memory turtle graphics interpreter ``interpret_lsystem_turtle_f64``."""
    half_pi = math.pi / 2.0
    frame_bytes = abi.turtle_stack_frame_bytes
    max_depth = abi.turtle_stack_max_depth

    b = WasmCodeBuilder()
    b.raw(WasmOpcode.LOCAL_GET, 9, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_LT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 10, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_LT_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 4, WasmOpcode.LOCAL_SET, 18)
    b.raw(WasmOpcode.LOCAL_GET, 5, WasmOpcode.LOCAL_SET, 19)
    b.f64(-half_pi).raw(WasmOpcode.LOCAL_SET, 20)
    b.f64(half_pi).raw(WasmOpcode.LOCAL_SET, 21)

    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 18, WasmOpcode.F64_STORE, 3, 0)
    b.raw(WasmOpcode.LOCAL_GET, 7, WasmOpcode.LOCAL_GET, 19, WasmOpcode.F64_STORE, 3, 8)
    b.raw(WasmOpcode.I32_CONST, 1, WasmOpcode.LOCAL_SET, 13)
    b.raw(WasmOpcode.I32_CONST, 1, WasmOpcode.LOCAL_SET, 14)
    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 15)
    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 16)

    b.raw(WasmOpcode.I32_CONST, 0, WasmOpcode.LOCAL_SET, 11)
    b.raw(WasmOpcode.BLOCK, VOID_BLOCK_TYPE, WasmOpcode.LOOP, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.LOCAL_GET, 1, WasmOpcode.I32_GE_S, WasmOpcode.BR_IF, 1)
    b.raw(WasmOpcode.LOCAL_GET, 0, WasmOpcode.LOCAL_GET, 11, WasmOpcode.I32_ADD, WasmOpcode.I32_LOAD8_U, 0, 0, WasmOpcode.LOCAL_SET, 12)

    for idx, ch_code in enumerate((ord("F"), ord("A"), ord("B"), ord("G"))):
        b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST).sleb(ch_code).raw(WasmOpcode.I32_EQ)
        if idx > 0:
            b.raw(WasmOpcode.I32_OR)
    b.raw(WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.emit_advance_turtle_xy().emit_push_turtle_xy()
    b.raw(WasmOpcode.LOCAL_GET, 14, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 14)
    b.raw(WasmOpcode.ELSE)

    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST).sleb(ord("f")).raw(WasmOpcode.I32_EQ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.emit_advance_turtle_xy().emit_close_or_rewind_turtle().emit_push_turtle_xy()
    b.raw(WasmOpcode.I32_CONST, 1, WasmOpcode.LOCAL_SET, 14)
    b.raw(WasmOpcode.ELSE)

    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST).sleb(ord("+")).raw(WasmOpcode.I32_EQ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 20, WasmOpcode.LOCAL_GET, 3, WasmOpcode.F64_ADD, WasmOpcode.LOCAL_SET, 20)
    b.raw(WasmOpcode.ELSE)

    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST).sleb(ord("-")).raw(WasmOpcode.I32_EQ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 20, WasmOpcode.LOCAL_GET, 3, WasmOpcode.F64_SUB, WasmOpcode.LOCAL_SET, 20)
    b.raw(WasmOpcode.ELSE)

    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST).sleb(ord("[")).raw(WasmOpcode.I32_EQ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_CONST).sleb(max_depth).raw(WasmOpcode.I32_GE_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 6, WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_CONST, frame_bytes, WasmOpcode.I32_MUL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 17)
    b.raw(WasmOpcode.LOCAL_GET, 18, WasmOpcode.F64_STORE, 3, 0)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 19, WasmOpcode.F64_STORE, 3, 8)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.LOCAL_GET, 20, WasmOpcode.F64_STORE, 3, 16)
    b.raw(WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 16)
    b.raw(WasmOpcode.ELSE)

    b.raw(WasmOpcode.LOCAL_GET, 12, WasmOpcode.I32_CONST).sleb(ord("]")).raw(WasmOpcode.I32_EQ, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.emit_close_or_rewind_turtle()
    b.raw(WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_CONST, 0, WasmOpcode.I32_GT_S, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 16, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_SUB, WasmOpcode.LOCAL_TEE, 16)
    b.raw(WasmOpcode.I32_CONST, frame_bytes, WasmOpcode.I32_MUL, WasmOpcode.LOCAL_GET, 6, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_TEE, 17)
    b.raw(WasmOpcode.F64_LOAD, 3, 0, WasmOpcode.LOCAL_SET, 18)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.F64_LOAD, 3, 8, WasmOpcode.LOCAL_SET, 19)
    b.raw(WasmOpcode.LOCAL_GET, 17, WasmOpcode.F64_LOAD, 3, 16, WasmOpcode.LOCAL_SET, 20)
    b.raw(WasmOpcode.END)
    b.emit_push_turtle_xy()
    b.raw(WasmOpcode.I32_CONST, 1, WasmOpcode.LOCAL_SET, 14)
    b.raw(WasmOpcode.END, WasmOpcode.END, WasmOpcode.END, WasmOpcode.END, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 11, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 11, WasmOpcode.BR, 0, WasmOpcode.END, WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 14, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_GT_S, WasmOpcode.IF, VOID_BLOCK_TYPE)
    b.raw(WasmOpcode.LOCAL_GET, 15, WasmOpcode.LOCAL_GET, 10, WasmOpcode.I32_GE_S, WasmOpcode.IF, VOID_BLOCK_TYPE, WasmOpcode.I32_CONST).sleb(-1).raw(WasmOpcode.RETURN, WasmOpcode.END)
    b.raw(WasmOpcode.LOCAL_GET, 8, WasmOpcode.LOCAL_GET, 15, WasmOpcode.I32_CONST, 2, WasmOpcode.I32_SHL, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_GET, 14, WasmOpcode.I32_STORE, 2, 0)
    b.raw(WasmOpcode.LOCAL_GET, 15, WasmOpcode.I32_CONST, 1, WasmOpcode.I32_ADD, WasmOpcode.LOCAL_SET, 15)
    b.raw(WasmOpcode.END)

    b.raw(WasmOpcode.LOCAL_GET, 15)
    return encode_body([(7, WasmValType.I32), (4, WasmValType.F64)], b.buffer)


def build_wasm_module(abi: WasmAbiSpec = ABI_SPEC) -> bytes:
    """Assemble all WebAssembly sections into a valid binary module."""
    types = [
        encode_func_type([WasmValType.I32], [WasmValType.I32]),
        encode_func_type([], []),
        encode_func_type([], [WasmValType.I32]),
        encode_func_type(
            [
                WasmValType.I32,
                WasmValType.I32,
                WasmValType.I32,
                WasmValType.F64,
                WasmValType.F64,
                WasmValType.I32,
                WasmValType.I32,
            ],
            [WasmValType.I32],
        ),
        encode_func_type([WasmValType.F64], [WasmValType.F64]),
        encode_func_type([WasmValType.I32] * 8, [WasmValType.I32]),
        encode_func_type(
            [
                WasmValType.I32,
                WasmValType.I32,
                WasmValType.F64,
                WasmValType.F64,
                WasmValType.F64,
                WasmValType.F64,
                WasmValType.I32,
                WasmValType.I32,
                WasmValType.I32,
                WasmValType.I32,
                WasmValType.I32,
            ],
            [WasmValType.I32],
        ),
    ]
    func_type_indices = [
        uleb128(0),
        uleb128(1),
        uleb128(2),
        uleb128(3),
        uleb128(3),
        uleb128(1),
        uleb128(4),
        uleb128(5),
        uleb128(6),
    ]

    mem_sec = encode_vec(
        [
            bytes([0x01])
            + uleb128(abi.initial_memory_pages)
            + uleb128(abi.max_memory_pages)
        ]
    )
    global_sec = encode_vec(
        [
            bytes([int(WasmValType.I32), 0x01, int(WasmOpcode.I32_CONST)])
            + sleb128(abi.heap_base_offset_bytes)
            + bytes([int(WasmOpcode.END)])
        ]
    )

    export_sec = encode_vec(
        [
            encode_export("memory", WasmExportKind.MEMORY, 0),
            encode_export("alloc_bytes", WasmExportKind.FUNC, 0),
            encode_export("reset_arena", WasmExportKind.FUNC, 1),
            encode_export("get_heap_ptr", WasmExportKind.FUNC, 2),
            encode_export("expand_radial_f64", WasmExportKind.FUNC, 3),
            encode_export("expand_mirror_radial_f64", WasmExportKind.FUNC, 4),
            encode_export("inject_panic_test", WasmExportKind.FUNC, 5),
            encode_export("sin_f64", WasmExportKind.FUNC, 6),
            encode_export("expand_lsystem_bytes", WasmExportKind.FUNC, 7),
            encode_export("interpret_lsystem_turtle_f64", WasmExportKind.FUNC, 8),
        ]
    )

    code_sec = encode_vec(
        [
            build_alloc_bytes(),
            build_reset_arena(abi),
            build_get_heap_ptr(),
            build_expand_radial(),
            build_expand_mirror_radial(),
            build_inject_panic(),
            build_sin_f64(),
            build_expand_lsystem_bytes(),
            build_interpret_lsystem_turtle(abi),
        ]
    )

    return (
        WASM_MAGIC_HEADER
        + struct.pack("<I", WASM_BINARY_VERSION)
        + encode_section(WasmSectionId.TYPE, encode_vec(types))
        + encode_section(WasmSectionId.FUNCTION, encode_vec(func_type_indices))
        + encode_section(WasmSectionId.MEMORY, mem_sec)
        + encode_section(WasmSectionId.GLOBAL, global_sec)
        + encode_section(WasmSectionId.EXPORT, export_sec)
        + encode_section(WasmSectionId.CODE, code_sec)
    )


@contextlib.contextmanager
def atomic_binary_writer(target: Path) -> Iterator[Path]:
    """Context manager writing to a staging file and atomically replacing ``target``."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_suffix(f"{target.suffix}.tmp.{os.getpid()}")
    try:
        yield tmp_path
        tmp_path.replace(target)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse CLI options for WASM module generation."""
    default_out = (
        Path(__file__).resolve().parent.parent
        / "public"
        / "wasm"
        / "mandala_symmetry.wasm"
    )
    parser = argparse.ArgumentParser(
        description="Build deterministic WebAssembly symmetry kernels for Mandala Studio."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_out,
        help="Destination path for the compiled .wasm binary.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress informational build log output.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point returning POSIX exit status code."""
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(levelname)s %(message)s",
    )
    wasm_bytes = build_wasm_module()
    with atomic_binary_writer(args.output) as tmp_target:
        tmp_target.write_bytes(wasm_bytes)
    LOGGER.info("Generated %s (%d bytes)", args.output, len(wasm_bytes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
