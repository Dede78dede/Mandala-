package com.mandala.studio.domain

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator

object CoordinateOriginNames {
    const val LOGICAL_800: String = "logical-800"
    const val CENTERED_ZERO: String = "centered-zero"
}

object LogicalCanvasSpec {
    const val SIZE: Double = 800.0
    const val CENTER_X: Double = 400.0
    const val CENTER_Y: Double = 400.0
    const val DEFAULT_WORLD_RADIUS: Double = 2400.0
}

@Serializable
data class MandalaPointDto(
    val x: Double,
    val y: Double,
    val pressure: Double? = null
)

@Serializable
data class WedgeStrokeDto(
    val id: String,
    val points: List<MandalaPointDto>,
    val stroke: String,
    val strokeWidth: Double,
    val dash: List<Double>? = null,
    val opacity: Double = 1.0
)

@Serializable
data class CameraTransformDto(
    val zoom: Double = 1.0,
    val panX: Double = 0.0,
    val panY: Double = 0.0
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("strategyId")
sealed interface SymmetryParamsDto {
    val order: Int

    @Serializable
    @SerialName("radial")
    data class Radial(
        override val order: Int
    ) : SymmetryParamsDto

    @Serializable
    @SerialName("mirror-radial")
    data class MirrorRadial(
        override val order: Int,
        val mirrorMode: String = "reflect"
    ) : SymmetryParamsDto

    @Serializable
    @SerialName("fractal")
    data class Fractal(
        val preset: String,
        override val order: Int,
        val generations: Int,
        val angle: Double,
        val stepLength: Double
    ) : SymmetryParamsDto
}

@Serializable
data class MandalaDocumentPayload(
    val schemaVersion: Int,
    val title: String,
    val coordinateOrigin: String? = null,
    val worldRadius: Double? = null,
    val camera: CameraTransformDto? = null,
    val symmetryParams: SymmetryParamsDto,
    val wedges: List<WedgeStrokeDto>,
    val paletteId: String,
    val activeColour: String,
    val activeStrokeWidth: Double,
    val activeDash: List<Double>? = null,
    val createdAt: String
) {
    fun toLogical800Wedges(): List<WedgeStrokeDto> {
        val isCenteredZero = schemaVersion == 2 && coordinateOrigin == CoordinateOriginNames.CENTERED_ZERO
        if (!isCenteredZero) return wedges
        return wedges.map { stroke ->
            stroke.copy(
                points = stroke.points.map { pt ->
                    pt.copy(
                        x = pt.x + LogicalCanvasSpec.CENTER_X,
                        y = pt.y + LogicalCanvasSpec.CENTER_Y
                    )
                }
            )
        }
    }

    fun withUpdatedLogicalWedges(logicalWedges: List<WedgeStrokeDto>): MandalaDocumentPayload {
        val isCenteredZero = schemaVersion == 2 && coordinateOrigin == CoordinateOriginNames.CENTERED_ZERO
        val serializedWedges = if (isCenteredZero) {
            logicalWedges.map { stroke ->
                stroke.copy(
                    points = stroke.points.map { pt ->
                        pt.copy(
                            x = pt.x - LogicalCanvasSpec.CENTER_X,
                            y = pt.y - LogicalCanvasSpec.CENTER_Y
                        )
                    }
                )
            }
        } else {
            logicalWedges
        }
        return copy(wedges = serializedWedges)
    }

    companion object {
        val jsonCodec: Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = true
        }

        fun defaultBlank(nowIso: String): MandalaDocumentPayload = MandalaDocumentPayload(
            schemaVersion = 2,
            title = "Mandala Stilo Nativo",
            coordinateOrigin = CoordinateOriginNames.CENTERED_ZERO,
            worldRadius = LogicalCanvasSpec.DEFAULT_WORLD_RADIUS,
            camera = CameraTransformDto(),
            symmetryParams = SymmetryParamsDto.Radial(order = 12),
            wedges = emptyList(),
            paletteId = "okabe-ito",
            activeColour = "#38BDF8",
            activeStrokeWidth = 2.5,
            activeDash = null,
            createdAt = nowIso
        )

        fun decodeOrDefault(rawJson: String, fallbackIso: String): MandalaDocumentPayload {
            if (rawJson.isBlank()) return defaultBlank(fallbackIso)
            return runCatching {
                jsonCodec.decodeFromString<MandalaDocumentPayload>(rawJson)
            }.getOrElse { defaultBlank(fallbackIso) }
        }
    }
}
