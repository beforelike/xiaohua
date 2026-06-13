import argparse
import json
import sys
from io import BytesIO

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove


def reject_multiple_subjects(alpha: np.ndarray) -> None:
    binary = (alpha > 32).astype(np.uint8)
    separated = cv2.morphologyEx(
        binary, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)
    )
    count, _, stats, _ = cv2.connectedComponentsWithStats(separated, 8)
    image_area = alpha.shape[0] * alpha.shape[1]
    major_components = [
        int(stats[index, cv2.CC_STAT_AREA])
        for index in range(1, count)
        if int(stats[index, cv2.CC_STAT_AREA]) >= image_area * 0.025
    ]
    if len(major_components) > 1:
        raise ValueError(
            f"MULTIPLE_MAJOR_SUBJECTS:{len(major_components)}"
        )


def select_components(alpha: np.ndarray) -> np.ndarray:
    binary = (alpha > 24).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        binary, 8
    )
    if count <= 1:
        raise ValueError("NO_FOREGROUND_COMPONENT")

    height, width = alpha.shape
    image_area = height * width
    ranked = []
    for index in range(1, count):
        area = int(stats[index, cv2.CC_STAT_AREA])
        if area < image_area * 0.0005:
            continue
        center_x, center_y = centroids[index]
        distance = max(
            abs(center_x - width / 2) / (width / 2),
            abs(center_y - height / 2) / (height / 2),
        )
        ranked.append((area * (1.0 - min(distance, 1.0) * 0.45), index, area))

    if not ranked:
        raise ValueError("NO_FOREGROUND_COMPONENT")

    ranked.sort(reverse=True)
    primary_index = ranked[0][1]
    primary = (labels == primary_index).astype(np.uint8)
    expanded = cv2.dilate(primary, np.ones((15, 15), np.uint8))
    kept = primary.copy()

    for _, index, area in ranked[1:]:
        component = (labels == index).astype(np.uint8)
        if area >= image_area * 0.002 and np.any(component & expanded):
            kept |= component

    kept = cv2.morphologyEx(
        kept, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)
    )
    kept = cv2.morphologyEx(
        kept, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)
    )
    softened = cv2.GaussianBlur((kept * 255).astype(np.uint8), (0, 0), 1.1)
    return np.minimum(alpha, softened)


def validate_mask(alpha: np.ndarray) -> dict[str, float]:
    foreground = alpha > 24
    height, width = alpha.shape
    foreground_ratio = float(np.mean(foreground))
    if foreground_ratio < 0.025:
        raise ValueError("FOREGROUND_TOO_SMALL")
    if foreground_ratio > 0.68:
        raise ValueError("FOREGROUND_TOO_LARGE")

    contours, _ = cv2.findContours(
        foreground.astype(np.uint8),
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    if contours:
        largest = max(contours, key=cv2.contourArea)
        contour_area = float(cv2.contourArea(largest))
        perimeter = float(cv2.arcLength(largest, True))
        circularity = (
            4.0 * np.pi * contour_area / (perimeter * perimeter)
            if perimeter > 0
            else 0.0
        )
        if foreground_ratio > 0.48 and circularity > 0.72:
            raise ValueError("FOREGROUND_BADGE_OR_FRAME")

    y_values, x_values = np.where(foreground)
    box_width_ratio = float((x_values.max() - x_values.min() + 1) / width)
    box_height_ratio = float((y_values.max() - y_values.min() + 1) / height)
    if box_width_ratio > 0.96 and box_height_ratio > 0.92:
        raise ValueError("FOREGROUND_FRAME_ARTIFACT")

    border = np.concatenate(
        (foreground[0], foreground[-1], foreground[:, 0], foreground[:, -1])
    )
    border_ratio = float(np.mean(border))
    if border_ratio > 0.08:
        raise ValueError("FOREGROUND_TOUCHES_BORDER")

    return {
        "foregroundRatio": foreground_ratio,
        "boxWidthRatio": box_width_ratio,
        "boxHeightRatio": box_height_ratio,
        "borderRatio": border_ratio,
        "circularity": circularity if contours else 0.0,
    }

def validate_identity(
    rgba: np.ndarray,
    reference_path: str,
    preserve_colors: bool,
    preserve_shape: bool,
) -> dict[str, float]:
    reference = cv2.imread(reference_path, cv2.IMREAD_UNCHANGED)
    if reference is None:
        raise ValueError("REFERENCE_IMAGE_MISSING")

    def foreground_hsv(image: np.ndarray) -> np.ndarray:
        if image.ndim != 3:
            raise ValueError("INVALID_REFERENCE_IMAGE")
        if image.shape[2] == 4:
            mask = image[:, :, 3] > 32
            bgr = image[:, :, :3]
        else:
            mask = np.ones(image.shape[:2], dtype=bool)
            bgr = image[:, :, :3]
        if int(np.count_nonzero(mask)) < 100:
            raise ValueError("REFERENCE_FOREGROUND_TOO_SMALL")
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[mask]

    current_foreground = rgba[:, :, 3] > 32
    reference_foreground = (
        reference[:, :, 3] > 32
        if reference.shape[2] == 4
        else np.ones(reference.shape[:2], dtype=bool)
    )
    current_ratio = float(np.mean(current_foreground))
    reference_ratio = float(np.mean(reference_foreground))
    area_scale = current_ratio / max(reference_ratio, 0.0001)
    if preserve_shape and area_scale > 1.75:
        raise ValueError(f"IDENTITY_SHAPE_DRIFT:{area_scale:.3f}")

    if not preserve_colors:
        return {"identityAreaScale": area_scale}

    current_hsv = foreground_hsv(rgba)
    reference_hsv = foreground_hsv(reference)
    histogram_size = [24, 8]
    histogram_range = [0, 180, 0, 256]
    current_histogram = cv2.calcHist(
        [current_hsv.reshape(-1, 1, 3)],
        [0, 1],
        None,
        histogram_size,
        histogram_range,
    )
    reference_histogram = cv2.calcHist(
        [reference_hsv.reshape(-1, 1, 3)],
        [0, 1],
        None,
        histogram_size,
        histogram_range,
    )
    cv2.normalize(current_histogram, current_histogram)
    cv2.normalize(reference_histogram, reference_histogram)
    color_distance = float(
        cv2.compareHist(
            current_histogram,
            reference_histogram,
            cv2.HISTCMP_BHATTACHARYYA,
        )
    )
    if color_distance > 0.60:
        raise ValueError(f"IDENTITY_COLOR_DRIFT:{color_distance:.3f}")
    return {
        "identityColorDistance": color_distance,
        "identityAreaScale": area_scale,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference")
    parser.add_argument("--preserve-colors", action="store_true")
    parser.add_argument("--preserve-shape", action="store_true")
    args = parser.parse_args()
    source = sys.stdin.buffer.read()
    if not source:
        raise ValueError("EMPTY_IMAGE")

    image = Image.open(BytesIO(source)).convert("RGB")
    rgb_buffer = BytesIO()
    image.save(rgb_buffer, format="PNG")

    session = new_session("isnet-general-use")
    segmented = remove(
        rgb_buffer.getvalue(),
        session=session,
        post_process_mask=True,
    )
    rgba = cv2.imdecode(
        np.frombuffer(segmented, dtype=np.uint8), cv2.IMREAD_UNCHANGED
    )
    if rgba is None or rgba.ndim != 3 or rgba.shape[2] != 4:
        raise ValueError("INVALID_SEGMENTATION_OUTPUT")

    reject_multiple_subjects(rgba[:, :, 3])
    rgba[:, :, 3] = select_components(rgba[:, :, 3])
    metrics = validate_mask(rgba[:, :, 3])
    if args.reference:
        metrics.update(
            validate_identity(
                rgba,
                args.reference,
                args.preserve_colors,
                args.preserve_shape,
            )
        )
    success, encoded = cv2.imencode(".png", rgba)
    if not success:
        raise ValueError("PNG_ENCODE_FAILED")

    sys.stderr.write(json.dumps(metrics))
    sys.stdout.buffer.write(encoded.tobytes())


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(str(error))
        sys.exit(2)
